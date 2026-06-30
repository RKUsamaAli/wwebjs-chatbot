import { Request, Response } from 'express';
import { whatsappWebManager } from './whatsapp-web.service';
import { sendSuccess, sendError } from '../../utils/apiResponse';

export const connect = async (req: Request, res: Response) => {
  try {
    if (whatsappWebManager.isInitializing() || whatsappWebManager.isConnected()) {
      return sendSuccess(res, whatsappWebManager.getStatus(), 'Client already running or connecting');
    }
    whatsappWebManager.initialize().catch((err) => {
      console.error('Failed to initialize WhatsApp Web JS:', err);
    });
    sendSuccess(res, null, 'WhatsApp Web JS client is initializing...', 202);
  } catch (error: any) {
    sendError(res, error, 'Failed to start WhatsApp Web JS client');
  }
};

export const disconnect = async (req: Request, res: Response) => {
  try {
    await whatsappWebManager.disconnect();
    sendSuccess(res, null, 'WhatsApp Web JS client disconnected');
  } catch (error: any) {
    sendError(res, error, 'Failed to disconnect WhatsApp Web JS client');
  }
};

export const getStatus = async (req: Request, res: Response) => {
  try {
    sendSuccess(res, whatsappWebManager.getStatus(), 'Status retrieved');
  } catch (error: any) {
    sendError(res, error, 'Failed to retrieve connection status');
  }
};
