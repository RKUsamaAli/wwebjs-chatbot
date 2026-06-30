import { Client, LocalAuth } from 'whatsapp-web.js';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { getIO, emitMessageCreated, emitMessageStatusUpdated } from '../../lib/socketServer';

const AUTH_PATH = path.join(__dirname, '../../../.wwebjs_auth');
const UPLOADS_DIR = path.join(__dirname, '../../../uploads');

export class WhatsappWebManager {
  private static instance: WhatsappWebManager;
  private client: any = null;
  private qrCode: string | null = null;
  private status: 'DISCONNECTED' | 'INITIALIZING' | 'QR_READY' | 'CONNECTED' = 'DISCONNECTED';
  private clientInfo: any = null;

  private constructor() { }

  public static getInstance(): WhatsappWebManager {
    if (!WhatsappWebManager.instance) {
      WhatsappWebManager.instance = new WhatsappWebManager();
    }
    return WhatsappWebManager.instance;
  }

  public getStatus() {
    return {
      status: this.status,
      qr: this.qrCode,
      info: this.clientInfo,
    };
  }

  public getClient(): any {
    if (!this.client) {
      throw new Error('WhatsApp Web client is not initialized');
    }
    return this.client;
  }

  public isConnected(): boolean {
    return this.status === 'CONNECTED' && this.client !== null;
  }

  public isInitializing(): boolean {
    return this.status === 'INITIALIZING';
  }

  /**
   * Auto-initialize the client on server boot if session cache exists.
   */
  public async autoInitialize(): Promise<void> {
    if (fs.existsSync(AUTH_PATH)) {
      logger.info('Existing WhatsApp Web session found. Auto-initializing client...');
      await this.initialize().catch((err) => {
        logger.error(err, 'Failed to auto-initialize WhatsApp Web client');
      });
    } else {
      logger.info('No existing WhatsApp Web session found. Waiting for user to connect.');
    }
  }

  /**
   * Initializes the WhatsApp Web client, launches Puppeteer, and sets up event listeners.
   */
  public async initialize(): Promise<void> {
    if (this.client) {
      logger.warn('WhatsApp Web client is already initialized.');
      return;
    }

    this.status = 'INITIALIZING';
    this.qrCode = null;
    this.clientInfo = null;
    this.emitStatus();

    logger.info('Initializing WhatsApp Web JS client (Puppeteer)...');

    const puppeteerOpts: any = {
      headless: true,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
        '--lang=en-US',
        '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      ],
    };

    const envExecutable = process.env.PUPPETEER_EXECUTABLE_PATH;
    const localChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const localBrave = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
    if (envExecutable && fs.existsSync(envExecutable)) {
      // Explicit browser path — use this on Linux/VPS, e.g. /usr/bin/chromium.
      puppeteerOpts.executablePath = envExecutable;
      logger.info({ executablePath: envExecutable }, 'Using PUPPETEER_EXECUTABLE_PATH for Puppeteer');
    } else if (fs.existsSync(localChrome)) {
      puppeteerOpts.executablePath = localChrome;
      logger.info({ executablePath: localChrome }, 'Using system Google Chrome for Puppeteer');
    } else if (fs.existsSync(localBrave)) {
      puppeteerOpts.executablePath = localBrave;
      logger.info({ executablePath: localBrave }, 'Using system Brave Browser for Puppeteer');
    } else {
      logger.info('No explicit browser found, using Puppeteer default bundled Chromium');
    }

    const client = new Client({
      authStrategy: new LocalAuth({
        dataPath: AUTH_PATH,
      }),
      puppeteer: puppeteerOpts,
    });

    // ── QR Event ─────────────────────────────────────────────────────────────
    client.on('qr', async (qr: string) => {
      this.status = 'QR_READY';
      logger.info('WhatsApp Web QR code generated');
      try {
        this.qrCode = await QRCode.toDataURL(qr);
        this.emitQR(this.qrCode);
        this.emitStatus();
      } catch (err) {
        logger.error(err, 'Failed to generate QR data URL');
      }
    });

    // ── Ready Event ──────────────────────────────────────────────────────────
    client.on('ready', async () => {
      this.status = 'CONNECTED';
      this.qrCode = null;
      this.clientInfo = {
        pushname: client.info.pushname,
        wid: client.info.wid,
        platform: client.info.platform,
      };

      const myPhone = client.info.wid.user;
      logger.info({ myPhone, pushname: client.info.pushname }, 'WhatsApp Web client is ready!');

      if (myPhone) {
        try {
          // Sync WhatsApp Account Table
          await prisma.whatsappAccount.upsert({
            where: { phoneNumberId: myPhone },
            create: {
              phoneNumberId: myPhone,
              displayPhoneNumber: myPhone,
              verifiedName: client.info.pushname || 'WhatsApp Web',
              status: 'connected',
              isActive: true,
            },
            update: {
              status: 'connected',
              isActive: true,
              verifiedName: client.info.pushname || 'WhatsApp Web',
            },
          });

          // Sync contacts in background
          wwebContactsSync(client).catch((err) => {
            logger.error(err, 'Background contact sync failed');
          });
        } catch (dbErr) {
          logger.error({ err: dbErr }, 'Failed to persist WhatsApp Web account to DB');
        }
      }

      this.emitStatus();
    });

    // ── Auth Failure Event ───────────────────────────────────────────────────
    client.on('auth_failure', (msg: string) => {
      logger.error({ msg }, 'WhatsApp Web authentication failed');
      this.status = 'DISCONNECTED';
      this.client = null;
      this.qrCode = null;
      this.clientInfo = null;
      this.emitStatus();
    });

    // ── Disconnected Event ───────────────────────────────────────────────────
    client.on('disconnected', async (reason: string) => {
      logger.info({ reason }, 'WhatsApp Web client was disconnected');
      await this.cleanupSession(false);
    });

    // ── Incoming Message Event ───────────────────────────────────────────────
    client.on('message', async (msg: any) => {
      try {
        const myPhone = client.info?.wid?.user || 'business';
        const cleanFrom = msg.from.split('@')[0];

        // Do not process messages from status updates or groups
        if (msg.from.endsWith('@g.us') || msg.from === 'status@broadcast') {
          return;
        }

        let actualFrom = cleanFrom;

        // Unify JID/LID/Phone mappings in database
        try {
          let rawPhone = cleanFrom;
          let contactInfo: any = null;

          if (msg.from.endsWith('@lid')) {
            const mapped = await client.getContactLidAndPhone([msg.from]);
            if (mapped && mapped.length > 0 && mapped[0].pn) {
              rawPhone = mapped[0].pn;
            }
          } else {
            contactInfo = await msg.getContact();
            if (contactInfo && contactInfo.number) {
              rawPhone = contactInfo.number;
            }
          }

          if (!contactInfo) {
            try {
              contactInfo = await msg.getContact();
            } catch (e) { }
          }

          // Strip any @c.us or @lid suffix from the resolved phone number
          rawPhone = rawPhone.split('@')[0];

          actualFrom = rawPhone;

          // Migrate all historical messages matching the JID to standard actual phone number
          await prisma.message.updateMany({
            where: { fromDevice: cleanFrom },
            data: { fromDevice: rawPhone }
          });
          await prisma.message.updateMany({
            where: { toDevice: cleanFrom },
            data: { toDevice: rawPhone }
          });

          // Update or create contact with mapping
          const contact = await prisma.contact.findFirst({
            where: {
              OR: [
                { phone: rawPhone },
                { waId: cleanFrom }
              ]
            }
          });

          if (contact) {
            await prisma.contact.update({
              where: { id: contact.id },
              data: { phone: rawPhone, waId: cleanFrom }
            });
            logger.info({ rawPhone, cleanFrom }, 'Linked contact JID to actual phone on inbound message');
          } else {
            await prisma.contact.create({
              data: {
                phone: rawPhone,
                waId: cleanFrom,
                name: (contactInfo && (contactInfo.name || contactInfo.pushname)) || rawPhone
              }
            });
            logger.info({ rawPhone, cleanFrom }, 'Created contact with JID mapping on inbound message');
          }
        } catch (linkErr) {
          logger.warn({ err: linkErr }, 'Failed to link contact JID mapping on incoming message');
        }

        logger.info({ msgId: msg.id.id, from: actualFrom, type: msg.type }, 'Received WhatsApp Web message');

        let modifiedContent: any = {
          id: msg.id.id,
          serializedId: msg.id._serialized,
          from: actualFrom,
          jid: msg.from,
          timestamp: String(msg.timestamp),
          type: msg.type === 'chat' ? 'text' : (msg.type === 'ptt' ? 'audio' : msg.type),
        };

        // Capture quoted-message context when this is a reply
        if (msg.hasQuotedMsg) {
          try {
            const quoted = await msg.getQuotedMessage();
            if (quoted) {
              const quotedType = quoted.type === 'chat' ? 'text' : (quoted.type === 'ptt' ? 'audio' : quoted.type);
              modifiedContent.context = {
                id: quoted.id.id,
                type: quotedType,
                text: quoted.body || `[${quotedType}]`,
                from: quoted.fromMe ? 'me' : actualFrom,
              };
            }
          } catch (quoteErr) {
            logger.warn({ err: quoteErr, msgId: msg.id.id }, 'Failed to resolve quoted message on inbound reply');
          }
        }

        if (msg.type === 'chat') {
          modifiedContent.text = { body: msg.body };
        } else if (['image', 'video', 'audio', 'ptt', 'document', 'sticker'].includes(msg.type) && msg.hasMedia) {
          try {
            const media = await msg.downloadMedia();
            if (media) {
              const localFilename = await this.saveMediaLocally(actualFrom, msg.id.id, media);
              const mediaType = msg.type === 'ptt' ? 'audio' : msg.type;
              modifiedContent[mediaType] = {
                mimetype: media.mimetype,
                caption: msg.body || undefined,
                filename: media.filename || undefined,
                localFilename,
              };
            }
          } catch (mediaErr) {
            logger.error({ err: mediaErr, msgId: msg.id.id }, 'Failed to download incoming Web JS media');
          }
        }

        // Upsert message in the DB
        const savedMessage = await prisma.message.upsert({
          where: { otherMessageId: msg.id.id },
          update: {},
          create: {
            otherMessageId: msg.id.id,
            direction: 'INBOUND',
            fromDevice: actualFrom,
            toDevice: myPhone,
            type: msg.type === 'chat' ? 'text' : (msg.type === 'ptt' ? 'audio' : msg.type),
            content: JSON.stringify(modifiedContent),
            status: 'SENT',
          },
        });

        // Emit message to frontend via Socket.io
        emitMessageCreated({
          ...savedMessage,
          content: modifiedContent,
          createdAt: savedMessage.createdAt.toISOString(),
          updatedAt: savedMessage.updatedAt.toISOString(),
        });
      } catch (err) {
        logger.error(err, 'Error processing incoming WhatsApp Web message');
      }
    });

    // ── Message Status Acknowledgement Event ──────────────────────────────────
    client.on('message_ack', async (msg: any, ack: any) => {
      try {
        const statusMap: Record<number | string, 'SENT' | 'DELIVERED' | 'READ' | 'PLAYED'> = {
          1: 'SENT',
          2: 'DELIVERED',
          3: 'READ',
          4: 'PLAYED',
        };
        const prismaStatus = statusMap[ack];

        if (!prismaStatus) return;

        const dbMsg = await prisma.message.findUnique({
          where: { otherMessageId: msg.id.id },
        });

        if (dbMsg) {
          const updateData: any = { status: prismaStatus };
          const now = new Date();
          if (prismaStatus === 'SENT') updateData.sentAt = now;
          else if (prismaStatus === 'DELIVERED') updateData.deliveredAt = now;
          else if (prismaStatus === 'READ') updateData.seenAt = now;
          else if (prismaStatus === 'PLAYED') updateData.playedAt = now;

          const updatedMessage = await prisma.message.update({
            where: { id: dbMsg.id },
            data: updateData,
          });

          emitMessageStatusUpdated({
            messageId: updatedMessage.id,
            otherMessageId: updatedMessage.otherMessageId || '',
            status: updatedMessage.status,
            sentAt: updatedMessage.sentAt?.toISOString() || null,
            deliveredAt: updatedMessage.deliveredAt?.toISOString() || null,
            seenAt: updatedMessage.seenAt?.toISOString() || null,
            playedAt: updatedMessage.playedAt?.toISOString() || null,
            phone: updatedMessage.direction === 'OUTBOUND' ? updatedMessage.toDevice : updatedMessage.fromDevice,
          });
        }
      } catch (err) {
        logger.error(err, 'Error processing message status ack');
      }
    });

    this.client = client;
    await client.initialize();
  }

  /**
   * Disconnects the client, destroys it, and wipes session folders.
   */
  public async disconnect(): Promise<void> {
    if (!this.client) {
      logger.warn('WhatsApp Web client is not initialized, nothing to disconnect');
      return;
    }

    try {
      logger.info('Logging out and destroying WhatsApp Web client...');
      await this.client.logout().catch(() => { });
      await this.client.destroy().catch(() => { });
    } catch (err) {
      logger.error(err, 'Error during WhatsApp Web client destruction');
    }

    await this.cleanupSession(true);
  }

  /**
   * Helper to clean up cache folders, set statuses, and deactivate the account.
   */
  private async cleanupSession(wipeFiles: boolean): Promise<void> {
    const myPhone = this.clientInfo?.wid?.user || this.client?.info?.wid?.user;

    this.status = 'DISCONNECTED';
    this.client = null;
    this.qrCode = null;
    this.clientInfo = null;

    if (myPhone) {
      try {
        await prisma.whatsappAccount.updateMany({
          where: { phoneNumberId: myPhone },
          data: { status: 'disconnected', isActive: false },
        });
        logger.info({ myPhone }, 'WhatsApp Web account set to disconnected in DB');
      } catch (dbErr) {
        logger.error(dbErr, 'Failed to update disconnected state in DB');
      }
    }

    if (wipeFiles && fs.existsSync(AUTH_PATH)) {
      try {
        fs.rmSync(AUTH_PATH, { recursive: true, force: true });
        logger.info('Wiped local authentication directory .wwebjs_auth');
      } catch (rmErr) {
        logger.error(rmErr, 'Failed to delete .wwebjs_auth cache folder');
      }
    }

    this.emitStatus();
  }

  /**
   * Helper to save base64 media downloaded from Puppeteer to the local uploads directory.
   */
  private async saveMediaLocally(phone: string, msgId: string, media: any): Promise<string> {
    const chatDir = path.join(UPLOADS_DIR, phone);
    if (!fs.existsSync(chatDir)) {
      fs.mkdirSync(chatDir, { recursive: true });
    }

    const ext = media.mimetype.split('/')[1]?.split(';')[0] || 'bin';
    const filename = media.filename || `${msgId}.${ext}`;
    const uniqueFilename = `${msgId}_${filename}`;
    const filePath = path.join(chatDir, uniqueFilename);

    const buffer = Buffer.from(media.data, 'base64');
    fs.writeFileSync(filePath, buffer);

    logger.info({ phone, filePath }, 'Saved Web JS media file locally');
    return uniqueFilename;
  }

  private emitStatus(): void {
    try {
      getIO().emit('wweb:status', {
        status: this.status,
        info: this.clientInfo,
      });
    } catch (err) {
      logger.warn('Socket.io server not ready — could not emit wweb:status');
    }
  }

  private emitQR(qr: string): void {
    try {
      getIO().emit('wweb:qr', { qr });
    } catch (err) {
      logger.warn('Socket.io server not ready — could not emit wweb:qr');
    }
  }
}

/**
 * Background contacts sync task
 */
async function wwebContactsSync(client: any): Promise<void> {
  try {
    logger.info('Starting WhatsApp Web contacts synchronization...');
    const wwebContacts = await client.getContacts();
    logger.info(`Syncing ${wwebContacts.length} contacts from WhatsApp Web into DB...`);

    let count = 0;
    for (const c of wwebContacts) {
      if (c.isGroup || !c.id || !c.id.user) {
        continue;
      }

      const waId = c.id.user;
      let phone = c.number || waId;

      if (c.id.server === 'lid') {
        try {
          const mapped = await client.getContactLidAndPhone([c.id._serialized]);
          if (mapped && mapped.length > 0 && mapped[0].pn) {
            phone = mapped[0].pn;
          }
        } catch (lidErr) {
          logger.warn({ err: lidErr }, 'Failed to resolve phone for contact LID');
        }
      }

      const name = c.name || c.pushname || phone;

      const matchWaId = waId ? await prisma.contact.findUnique({ where: { waId } }) : null;
      const matchPhone = await prisma.contact.findUnique({ where: { phone } });

      if (matchWaId && matchPhone) {
        if (matchWaId.id === matchPhone.id) {
          await prisma.contact.update({
            where: { id: matchWaId.id },
            data: { name }
          });
        } else {
          await prisma.contact.delete({
            where: { id: matchPhone.id }
          });
          await prisma.contact.update({
            where: { id: matchWaId.id },
            data: { name, phone }
          });
        }
      } else if (matchWaId) {
        await prisma.contact.update({
          where: { id: matchWaId.id },
          data: { name, phone }
        });
      } else if (matchPhone) {
        await prisma.contact.update({
          where: { id: matchPhone.id },
          data: { name, waId }
        });
      } else {
        await prisma.contact.create({
          data: { phone, waId, name }
        });
      }
      count++;
    }
    logger.info(`WhatsApp Web contacts synchronization completed successfully. Synced ${count} contacts.`);

    // Auto-backfill: migrate any messages using raw JID to use mapped actual phone number
    try {
      const mappedContacts = await prisma.contact.findMany({
        where: {
          waId: { not: null }
        }
      });
      logger.info(`Running database backfill migration for ${mappedContacts.length} mapped contacts...`);
      for (const contact of mappedContacts) {
        if (contact.waId && contact.phone && contact.waId !== contact.phone) {
          const fromUpdated = await prisma.message.updateMany({
            where: { fromDevice: contact.waId },
            data: { fromDevice: contact.phone }
          });
          const toUpdated = await prisma.message.updateMany({
            where: { toDevice: contact.waId },
            data: { toDevice: contact.phone }
          });
          if (fromUpdated.count > 0 || toUpdated.count > 0) {
            logger.info({ phone: contact.phone, waId: contact.waId }, `Migrated historical messages for contact`);
          }
        }
      }
      // Also strip any @c.us or @lid suffixes from fromDevice/toDevice
      const suffixMessages = await prisma.$executeRawUnsafe(
        `UPDATE Message SET fromDevice = REPLACE(REPLACE(fromDevice, '@c.us', ''), '@lid', '') WHERE fromDevice LIKE '%@c.us' OR fromDevice LIKE '%@lid'`
      );
      const suffixMessages2 = await prisma.$executeRawUnsafe(
        `UPDATE Message SET toDevice = REPLACE(REPLACE(toDevice, '@c.us', ''), '@lid', '') WHERE toDevice LIKE '%@c.us' OR toDevice LIKE '%@lid'`
      );
      // Also clean contact phone fields
      await prisma.$executeRawUnsafe(
        `DELETE FROM Contact WHERE phone LIKE '%@c.us' OR phone LIKE '%@lid'`
      );

      logger.info('Database backfill migration completed.');
    } catch (migErr) {
      logger.warn({ err: migErr }, 'Failed to run database backfill migration');
    }
  } catch (err) {
    logger.error(err, 'Failed to sync WhatsApp Web contacts to DB');
  }
}

export const whatsappWebManager = WhatsappWebManager.getInstance();
