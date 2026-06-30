import { MessageMedia } from 'whatsapp-web.js';
import path from 'path';
import fs from 'fs';
import os from 'os';
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffmpegPath = ffmpegInstaller.path || ffmpegInstaller.default?.path || (ffmpegInstaller as any).default?.default?.path;
ffmpeg.setFfmpegPath(ffmpegPath);

import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { whatsappWebManager } from '../whatsapp-web/whatsapp-web.service';
import { emitMessageCreated, emitMessageStatusUpdated } from '../../lib/socketServer';

const UPLOADS_DIR = path.join(__dirname, '../../../uploads');

// `window` only exists inside pupPage.evaluate (browser context); declared here
// so the evaluate callbacks type-check in this Node module.
declare const window: any;

/**
 * Transcodes any incoming audio to audio/ogg (Opus) for WhatsApp voice note compatibility
 */
const convertAudioToOgg = (inputBuffer: Buffer, extension: string): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    const safeExt = extension.startsWith('.') ? extension : `.${extension}`;
    const tmpInput = path.join(os.tmpdir(), `input-${Date.now()}${safeExt}`);
    const tmpOutput = path.join(os.tmpdir(), `output-${Date.now()}.ogg`);

    fs.writeFileSync(tmpInput, inputBuffer);

    logger.info({ ffmpegPath, tmpInput, tmpOutput }, 'Starting audio transcoding with FFmpeg path');

    ffmpeg(tmpInput)
      .audioCodec('libopus')
      .audioBitrate('32k')
      .audioFrequency(48000)
      .audioChannels(1)
      .audioFilters('aresample=async=1:first_pts=0')
      .format('ogg')
      .on('end', () => {
        const outBuffer = fs.readFileSync(tmpOutput);
        fs.unlinkSync(tmpInput);
        fs.unlinkSync(tmpOutput);
        resolve(outBuffer);
      })
      .on('error', (err: any) => {
        logger.warn({ err }, 'Transcoding with libopus failed, trying opus');
        ffmpeg(tmpInput)
          .audioCodec('opus')
          .audioBitrate('32k')
          .audioFrequency(48000)
          .audioChannels(1)
          .audioFilters('aresample=async=1:first_pts=0')
          .format('ogg')
          .on('end', () => {
            const outBuffer = fs.readFileSync(tmpOutput);
            fs.unlinkSync(tmpInput);
            fs.unlinkSync(tmpOutput);
            resolve(outBuffer);
          })
          .on('error', (err2: any) => {
            logger.warn({ err: err2 }, 'Transcoding with opus failed, trying generic ogg');
            ffmpeg(tmpInput)
              .audioFilters('aresample=async=1:first_pts=0')
              .format('ogg')
              .on('end', () => {
                const outBuffer = fs.readFileSync(tmpOutput);
                fs.unlinkSync(tmpInput);
                fs.unlinkSync(tmpOutput);
                resolve(outBuffer);
              })
              .on('error', (err3: any) => {
                if (fs.existsSync(tmpInput)) fs.unlinkSync(tmpInput);
                if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput);
                reject(err3);
              })
              .save(tmpOutput);
          })
          .save(tmpOutput);
      })
      .save(tmpOutput);
  });
};

/**
 * Resolves a clean phone number into a serialized JID or LID using DB history and fallback lookups.
 */
async function resolveWaId(phone: string, client: any): Promise<string> {
  const cleanPhone = phone.replace(/[+\s-]/g, '');
  if (cleanPhone.includes('@')) {
    return cleanPhone;
  }

  // 1. Try to find the JID from mapped Contacts in the database
  try {
    const contact = await prisma.contact.findFirst({
      where: {
        OR: [
          { phone: cleanPhone },
          { waId: cleanPhone }
        ]
      }
    });

    if (contact && contact.waId) {
      if (contact.waId.includes('@')) {
        return contact.waId;
      }
      const suffix = (contact.waId.length >= 15 || contact.waId.startsWith('15')) ? '@lid' : '@c.us';
      return `${contact.waId}${suffix}`;
    }
  } catch (e) {
    logger.warn({ err: e, phone: cleanPhone }, 'Failed to resolve JID from Contact DB mapping');
  }

  // 2. Try to find the JID from database messages cache
  try {
    const lastMsg = await prisma.message.findFirst({
      where: {
        OR: [
          { fromDevice: cleanPhone },
          { toDevice: cleanPhone },
        ]
      },
      orderBy: { createdAt: 'desc' },
    });

    if (lastMsg) {
      try {
        const content = JSON.parse(lastMsg.content);
        if (content.jid) {
          return content.jid;
        }
      } catch (e) { }

      // Fallback regex match on raw content string
      const match = lastMsg.content.match(new RegExp(`"${cleanPhone}@(c\\.us|lid)"`));
      if (match) {
        return `${cleanPhone}@${match[1]}`;
      }
    }
  } catch (e) {
    logger.warn({ err: e, phone: cleanPhone }, 'Failed to resolve JID from database cache');
  }

  // 3. Fallback: ask WhatsApp Web client to resolve the JID
  try {
    const resolved = await client.getNumberId(cleanPhone);
    if (resolved && resolved._serialized) {
      return resolved._serialized;
    }
  } catch (e) {
    logger.warn({ err: e, phone: cleanPhone }, 'Failed to resolve JID via getNumberId');
  }

  // 4. Last fallback: default to @c.us
  return `${cleanPhone}@c.us`;
}

/**
 * Finds all potential DB keys/phone numbers associated with a contact (LID, JID, raw phone).
 */
async function getPhoneCandidates(phone: string): Promise<string[]> {
  const cleanPhone = phone.replace(/[+\s-]/g, '');
  const candidates = new Set<string>([cleanPhone]);

  try {
    const relatedMessages = await prisma.message.findMany({
      where: {
        OR: [
          { fromDevice: cleanPhone },
          { toDevice: cleanPhone }
        ]
      },
      select: {
        fromDevice: true,
        toDevice: true,
        content: true
      },
      take: 50
    });

    for (const msg of relatedMessages) {
      candidates.add(msg.fromDevice);
      candidates.add(msg.toDevice);

      try {
        const content = JSON.parse(msg.content);
        if (content.jid) {
          const jidUser = content.jid.split('@')[0];
          if (jidUser) candidates.add(jidUser);
        }
        if (content.to) {
          candidates.add(content.to);
        }
        if (content.from) {
          candidates.add(content.from);
        }
      } catch (e) { }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to resolve phone candidates');
  }

  candidates.delete('business');
  candidates.delete('me');

  return Array.from(candidates);
}

/**
 * Maps a contact's manually entered phone number to their active resolved WhatsApp JID user ID.
 */
async function linkContactAndGetPhone(cleanTo: string, waId: string): Promise<string> {
  const targetPhone = waId.split('@')[0];
  if (!targetPhone) return cleanTo;

  let actualPhone = cleanTo;
  if (waId.endsWith('@lid')) {
    try {
      const client = whatsappWebManager.getClient();
      const mapped = await client.getContactLidAndPhone([waId]);
      if (mapped && mapped.length > 0 && mapped[0].pn) {
        actualPhone = mapped[0].pn;
      }
    } catch (err) {
      logger.warn({ err, waId }, 'Failed to resolve LID phone in linkContactAndGetPhone');
    }
  }

  try {
    const contact = await prisma.contact.findFirst({
      where: {
        OR: [
          { phone: actualPhone },
          { waId: targetPhone }
        ]
      }
    });

    if (contact) {
      await prisma.contact.update({
        where: { id: contact.id },
        data: {
          phone: actualPhone,
          waId: targetPhone
        }
      });
      logger.info({ actualPhone, targetPhone }, 'Linked contact JID waId to actual phone');
    } else {
      await prisma.contact.create({
        data: {
          phone: actualPhone,
          waId: targetPhone,
          name: actualPhone
        }
      });
      logger.info({ actualPhone, targetPhone }, 'Created contact with linked JID waId');
    }

    // Migrate any historical messages where JID user ID was incorrectly stored in fromDevice/toDevice
    // back to standard actual phone number (actualPhone)
    await prisma.message.updateMany({
      where: { fromDevice: targetPhone },
      data: { fromDevice: actualPhone }
    });
    await prisma.message.updateMany({
      where: { toDevice: targetPhone },
      data: { toDevice: actualPhone }
    });
  } catch (err) {
    logger.warn({ err }, 'Failed to link contact phone mapping');
  }

  return cleanTo;
}

/**
 * Resolves a DB message that is being replied to into:
 *  - `liveMsg`: the live whatsapp-web.js Message object (so we can call .reply(),
 *    which guarantees the quoted id + chat are consistent — critical for LID chats).
 *  - `context`: a lightweight preview persisted for our own UI rendering.
 */
async function resolveQuoted(
  quotedMessageId: string,
  waId: string,
  client: any
): Promise<{ serializedId: string | null; chatId: string | null; context: any } | null> {
  const quoted = await prisma.message.findFirst({
    where: {
      OR: [{ id: quotedMessageId }, { otherMessageId: quotedMessageId }],
    },
  });

  if (!quoted) {
    logger.warn({ quotedMessageId }, 'Quoted message not found, sending without reply context');
    return null;
  }

  let content: any = {};
  try {
    content = JSON.parse(quoted.content);
  } catch (e) { }

  // Short text preview of the quoted message for rendering the reply snippet.
  let preview = '';
  if (quoted.type === 'text') {
    preview = content.text?.body || '';
  } else {
    preview = content[quoted.type]?.caption || `[${quoted.type}]`;
  }

  const context = {
    id: quoted.otherMessageId,
    type: quoted.type,
    text: preview,
    from: quoted.direction === 'OUTBOUND' ? 'me' : quoted.fromDevice,
  };

  // To make WhatsApp render the quote on the recipient's side we must:
  //   (a) reference the REAL serialized id of the quoted message, and
  //   (b) send into the SAME chat that message belongs to.
  // For LID contacts the quoted message lives in the `@lid` chat, which differs
  // from the phone-based `@c.us` chat that resolveWaId may return — sending into
  // the wrong chat silently drops the quote. So we derive the chat from the live
  // message itself (fromMe ? to : from).
  const fromMe = quoted.direction === 'OUTBOUND';
  let serializedId: string | null = null;
  let chatId: string | null = null;
  try {
    let liveMsg: any = null;

    // Build candidate serialized ids and load the live message directly.
    // `content.jid` is the exact chat (LID or c.us) the message belongs to, so
    // it yields the correct id even for older messages with no stored serializedId.
    const candidates: string[] = [];
    if (content.serializedId) candidates.push(content.serializedId);
    if (content.jid && quoted.otherMessageId) {
      candidates.push(`${fromMe}_${content.jid}_${quoted.otherMessageId}`);
    }
    for (const cand of candidates) {
      liveMsg = await client.getMessageById(cand).catch(() => null);
      if (liveMsg) break;
    }

    // Last resort: scan the message's own chat history by message id.
    if (!liveMsg && content.jid) {
      try {
        const chat = await client.getChatById(content.jid);
        const recent = await chat.fetchMessages({ limit: 50 });
        liveMsg = recent.find((m: any) => m.id?.id === quoted.otherMessageId) || null;
      } catch (e) { }
    }

    if (liveMsg) {
      serializedId = liveMsg.id?._serialized || content.serializedId || null;
      chatId = (liveMsg.fromMe ? liveMsg.to : liveMsg.from) || content.jid || null;
    } else {
      // Even without the live object, hand WhatsApp the best-guess id so its own
      // internal lookup can still attach the quote (ignoreQuoteErrors covers misses).
      serializedId = content.serializedId || candidates[candidates.length - 1] || null;
      chatId = content.jid || null;
    }
    // Probe the browser context: is the message in WhatsApp's store and does it
    // pass canReplyMsg? If not, the library silently sends a plain message.
    let probe: any = null;
    if (serializedId && client.pupPage) {
      probe = await client.pupPage.evaluate(async (id: string) => {
        try {
          const Msg = window.require('WAWebCollections').Msg;
          let m = Msg.get(id);
          if (!m) {
            const res = await Msg.getMessagesById([id]);
            m = res?.messages?.[0];
          }
          if (!m) return { found: false };
          let canReply: any = null;
          try {
            const R = window.require('WAWebMsgReply');
            canReply = R ? R.canReplyMsg(m.unsafe ? m.unsafe() : m) : (m.canReply ? m.canReply() : null);
          } catch (e: any) { canReply = 'err:' + (e?.message || e); }
          return { found: true, canReply, type: m.type };
        } catch (e: any) {
          return { error: String(e?.message || e) };
        }
      }, serializedId).catch((e: any) => ({ probeError: String(e?.message || e) }));
    }
    logger.info({ quotedMessageId, found: !!liveMsg, candidates, serializedId, chatId, waId, probe }, 'Resolved quoted message for reply');
  } catch (err) {
    logger.warn({ err, quotedMessageId }, 'Failed to locate live quoted message; sending without WhatsApp-side quote');
    serializedId = content.serializedId || null;
    chatId = content.jid || null;
  }

  return { serializedId, chatId, context };
}

/**
 * Sends a text message via WhatsApp Web and registers it in the DB.
 */
export async function sendText(to: string, body: string, quotedMessageId?: string): Promise<any> {
  if (!whatsappWebManager.isConnected()) {
    throw new Error('WhatsApp Web client is not connected');
  }

  const client = whatsappWebManager.getClient();
  const myPhone = client.info.wid.user;
  const cleanTo = to.replace(/[+\s-]/g, '');
  const waId = await resolveWaId(cleanTo, client);

  const sendOptions: any = {};
  let quotedContext: any = null;
  // Send into the phone (@c.us) chat so WhatsApp builds the quote with
  // phone-number addressing the recipient can resolve. Sending into the @lid
  // chat produces a LID-addressed quote the recipient's app ignores.
  const sendChatId = waId;
  if (quotedMessageId) {
    const resolved = await resolveQuoted(quotedMessageId, waId, client);
    if (resolved) {
      quotedContext = resolved.context;
      if (resolved.serializedId) {
        sendOptions.quotedMessageId = resolved.serializedId;
        sendOptions.ignoreQuoteErrors = true;
      }
    }
  }

  logger.info({ sendChatId, waId, body, quotedMessageId, quoted: !!sendOptions.quotedMessageId }, 'Sending text message via WhatsApp Web...');
  const wwebMsg = await client.sendMessage(sendChatId, body, sendOptions);
  const targetPhone = await linkContactAndGetPhone(cleanTo, waId);

  const modifiedContent: any = {
    id: wwebMsg.id.id,
    serializedId: wwebMsg.id._serialized,
    from: myPhone,
    to: targetPhone,
    jid: waId,
    timestamp: String(Math.floor(Date.now() / 1000)),
    type: 'text',
    text: { body },
    ...(quotedContext ? { context: quotedContext } : {}),
  };

  const savedMsg = await prisma.message.create({
    data: {
      otherMessageId: wwebMsg.id.id,
      direction: 'OUTBOUND',
      fromDevice: myPhone,
      toDevice: targetPhone,
      type: 'text',
      content: JSON.stringify(modifiedContent),
      status: 'SENT',
      sentAt: new Date(),
    },
  });

  emitMessageCreated({
    ...savedMsg,
    content: modifiedContent,
    createdAt: savedMsg.createdAt.toISOString(),
    updatedAt: savedMsg.updatedAt.toISOString(),
  });

  return savedMsg;
}

/**
 * Sends a media attachment via WhatsApp Web and registers it in the DB.
 */
export async function sendMedia(
  to: string,
  type: 'image' | 'audio' | 'video' | 'document' | 'sticker',
  fileBuffer: Buffer,
  mimeType: string,
  filename?: string,
  caption?: string,
  quotedMessageId?: string
): Promise<any> {
  if (!whatsappWebManager.isConnected()) {
    throw new Error('WhatsApp Web client is not connected');
  }

  const client = whatsappWebManager.getClient();
  const myPhone = client.info.wid.user;
  const cleanTo = to.replace(/[+\s-]/g, '');
  const waId = await resolveWaId(cleanTo, client);

  let quotedContext: any = null;
  let quotedSerializedId: string | null = null;
  // Send into the phone (@c.us) chat so the quote uses phone-number addressing.
  const sendChatId = waId;
  if (quotedMessageId) {
    const resolved = await resolveQuoted(quotedMessageId, waId, client);
    if (resolved) {
      quotedSerializedId = resolved.serializedId;
      quotedContext = resolved.context;
    }
  }

  // Generate unique filename and write to uploads
  const targetDir = path.join(UPLOADS_DIR, cleanTo);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const tempId = `out_${Date.now()}`;

  let uploadBuffer = fileBuffer;
  let uploadMimeType = mimeType;
  let uploadFilename = filename || `media-${tempId}.bin`;

  if (type === 'audio') {
    logger.info({ mimeType }, 'Transcoding audio to audio/ogg (Opus) for WhatsApp voice note compatibility');
    try {
      const audioExt = filename ? path.extname(filename) : '.webm';
      uploadBuffer = await convertAudioToOgg(fileBuffer, audioExt);
      const baseName = filename && filename.includes('.')
        ? filename.substring(0, filename.lastIndexOf('.'))
        : `audio-${Date.now()}`;
      uploadFilename = `${baseName}.ogg`;
      uploadMimeType = 'audio/ogg; codecs=opus';
    } catch (err) {
      logger.error({ err }, 'Transcoding to ogg failed, sending original audio file');
    }
  }

  const uniqueFilename = `${tempId}_${uploadFilename}`;
  const filePath = path.join(targetDir, uniqueFilename);

  fs.writeFileSync(filePath, uploadBuffer);

  logger.info({ sendChatId, waId, filePath }, `Sending ${type} media via WhatsApp Web...`);
  const media = MessageMedia.fromFilePath(filePath);
  const mediaOptions: any = { caption, sendAudioAsVoice: type === 'audio' };
  if (quotedSerializedId) {
    mediaOptions.quotedMessageId = quotedSerializedId;
    mediaOptions.ignoreQuoteErrors = true;
  }
  const wwebMsg = await client.sendMessage(sendChatId, media, mediaOptions);

  const targetPhone = await linkContactAndGetPhone(cleanTo, waId);

  const modifiedContent: any = {
    id: wwebMsg.id.id,
    serializedId: wwebMsg.id._serialized,
    from: myPhone,
    to: targetPhone,
    jid: waId,
    timestamp: String(Math.floor(Date.now() / 1000)),
    type,
    [type]: {
      mimetype: uploadMimeType,
      caption: caption || undefined,
      filename: uploadFilename,
      localFilename: uniqueFilename,
    },
    ...(quotedContext ? { context: quotedContext } : {}),
  };

  const savedMsg = await prisma.message.create({
    data: {
      otherMessageId: wwebMsg.id.id,
      direction: 'OUTBOUND',
      fromDevice: myPhone,
      toDevice: targetPhone,
      type,
      content: JSON.stringify(modifiedContent),
      status: 'SENT',
      sentAt: new Date(),
    },
  });

  emitMessageCreated({
    ...savedMsg,
    content: modifiedContent,
    createdAt: savedMsg.createdAt.toISOString(),
    updatedAt: savedMsg.updatedAt.toISOString(),
  });

  return savedMsg;
}

/**
 * Marks a message as read in WhatsApp Web.
 */
export async function markAsRead(messageId: string): Promise<any> {
  const message = await prisma.message.findFirst({
    where: {
      OR: [
        { id: messageId },
        { otherMessageId: messageId }
      ]
    }
  });

  if (message && whatsappWebManager.isConnected()) {
    const client = whatsappWebManager.getClient();
    const cleanPhone = message.direction === 'OUTBOUND' ? message.toDevice : message.fromDevice;
    const waId = await resolveWaId(cleanPhone, client);

    try {
      const chat = await client.getChatById(waId);
      await chat.sendSeen();

      const updatedMsg = await prisma.message.update({
        where: { id: message.id },
        data: { status: 'READ', seenAt: new Date() },
      });

      emitMessageStatusUpdated({
        messageId: updatedMsg.id,
        otherMessageId: updatedMsg.otherMessageId || '',
        status: updatedMsg.status,
        sentAt: updatedMsg.sentAt?.toISOString() || null,
        deliveredAt: updatedMsg.deliveredAt?.toISOString() || null,
        seenAt: updatedMsg.seenAt?.toISOString() || null,
        phone: cleanPhone,
      });
    } catch (err) {
      logger.warn({ err }, 'Failed to mark message as read via WhatsApp Web JS');
    }
  }

  return { success: true };
}

/**
 * Deletes all messages of a conversation (by phone) from the local DB.
 */
export async function clearConversation(phone: string): Promise<{ deleted: number }> {
  const cleanPhone = phone.replace(/[+\s-]/g, '');
  const candidates = await getPhoneCandidates(cleanPhone);

  const result = await prisma.message.deleteMany({
    where: {
      OR: [
        { fromDevice: { in: candidates } },
        { toDevice: { in: candidates } },
      ],
    },
  });

  logger.info({ phone: cleanPhone, deleted: result.count }, 'Cleared conversation messages');
  return { deleted: result.count };
}

/**
 * Retrieves paginated list of messages from DB.
 */
export async function getMessages(
  page: number,
  limit: number,
  direction?: 'INBOUND' | 'OUTBOUND',
  phone?: string
): Promise<any> {
  const skip = (page - 1) * limit;

  const where: any = {};
  if (direction) {
    where.direction = direction;
  }
  if (phone) {
    const cleanPhone = phone.replace(/[+\s-]/g, '');
    const candidates = await getPhoneCandidates(cleanPhone);
    where.OR = [
      { fromDevice: { in: candidates } },
      { toDevice: { in: candidates } },
    ];
  }

  const [messages, total] = await Promise.all([
    prisma.message.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.message.count({ where }),
  ]);

  // Map messages to include parsed JSON content
  const parsedMessages = messages.map((msg: any) => {
    let contentObj = {};
    try {
      contentObj = JSON.parse(msg.content);
    } catch (e) {
      logger.warn(e, 'Failed to parse JSON content of message');
    }
    return {
      ...msg,
      content: contentObj,
    };
  });

  return {
    messages: parsedMessages,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
}
