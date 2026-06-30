import { Request, Response } from 'express';
import * as service from './whatsapp-messages.service';
import { sendSuccess, sendError } from '../../utils/apiResponse';

export const sendText = async (req: Request, res: Response) => {
  try {
    const { to, body, quotedMessageId } = req.body as { to: string; body: string; quotedMessageId?: string };
    if (!to || !body) {
      return sendError(res, new Error('Missing "to" or "body" parameters'), 'Invalid Request', 400);
    }
    const result = await service.sendText(to, body, quotedMessageId);
    sendSuccess(res, result, 'Text message sent', 201);
  } catch (error: any) {
    sendError(res, error, 'Failed to send text message');
  }
};

export const sendMedia = async (req: Request, res: Response) => {
  try {
    const { to, type, caption, quotedMessageId } = req.body as {
      to: string;
      type: 'image' | 'audio' | 'video' | 'document' | 'sticker';
      caption?: string;
      quotedMessageId?: string;
    };

    const file = req.file;

    if (!to || !type || !file) {
      return sendError(res, new Error('Missing "to", "type", or "file" upload parameters'), 'Invalid Request', 400);
    }

    const result = await service.sendMedia(
      to,
      type,
      file.buffer,
      file.mimetype,
      file.originalname,
      caption,
      quotedMessageId
    );

    sendSuccess(res, result, 'Media message sent', 201);
  } catch (error: any) {
    sendError(res, error, 'Failed to send media message');
  }
};

export const markAsRead = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const result = await service.markAsRead(id);
    sendSuccess(res, result, 'Message marked as read');
  } catch (error: any) {
    sendError(res, error, 'Failed to mark message as read');
  }
};

export const clearConversation = async (req: Request, res: Response) => {
  try {
    const phone = String(req.query.phone || '');
    if (!phone) {
      return sendError(res, new Error('Missing "phone" parameter'), 'Invalid Request', 400);
    }
    const result = await service.clearConversation(phone);
    sendSuccess(res, result, 'Conversation cleared');
  } catch (error: any) {
    sendError(res, error, 'Failed to clear conversation');
  }
};

export const getMessages = async (req: Request, res: Response) => {
  try {
    const { page = '1', limit = '30', direction, phone } = req.query as {
      page?: string;
      limit?: string;
      direction?: 'INBOUND' | 'OUTBOUND';
      phone?: string;
    };
    const result = await service.getMessages(+page, +limit, direction, phone);
    sendSuccess(res, result.messages, 'Messages retrieved', 200, result.meta);
  } catch (error: any) {
    sendError(res, error, 'Failed to retrieve messages');
  }
};
