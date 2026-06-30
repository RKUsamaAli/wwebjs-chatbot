import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { logger } from './logger';

let io: SocketIOServer | null = null;

export const initSocketServer = (httpServer: HttpServer, corsOrigin: string): SocketIOServer => {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: corsOrigin,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  io.on('connection', (socket: Socket) => {
    logger.info({ socketId: socket.id }, 'Socket.io client connected');

    socket.on('disconnect', (reason) => {
      logger.info({ socketId: socket.id, reason }, 'Socket.io client disconnected');
    });
  });

  return io;
};

export const getIO = (): SocketIOServer => {
  if (!io) {
    throw new Error('Socket.io server has not been initialised');
  }
  return io;
};

export const emitMessageCreated = (message: any): void => {
  try {
    getIO().emit('message:created', message);
    logger.info({ messageId: message.id }, 'Emitted message:created via Socket.io');
  } catch (err) {
    logger.warn('Socket.io server not ready — could not emit message:created');
  }
};

export const emitMessageStatusUpdated = (payload: {
  messageId: string;
  otherMessageId: string;
  status: string;
  sentAt: string | null;
  deliveredAt: string | null;
  seenAt: string | null;
  playedAt?: string | null;
  phone: string;
}): void => {
  try {
    getIO().emit('message:status_updated', payload);
    logger.info({ messageId: payload.messageId, status: payload.status }, 'Emitted message:status_updated via Socket.io');
  } catch (err) {
    logger.warn('Socket.io server not ready — could not emit message:status_updated');
  }
};
