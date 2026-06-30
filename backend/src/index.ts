import http from 'http';
import app from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { initSocketServer } from './lib/socketServer';
import { whatsappWebManager } from './modules/whatsapp-web/whatsapp-web.service';

const server = http.createServer(app);

// Initialise Socket.io
initSocketServer(server, env.CORS_ORIGIN);
logger.info('Socket.io server initialised');

// Start Server
server.listen(env.PORT, () => {
  logger.info(`🚀 Standalone Backend running on http://localhost:${env.PORT}`);

  // Auto-initialize WhatsApp Web JS if session exists
  whatsappWebManager.autoInitialize().catch((err) => {
    logger.error(err, 'Failed to auto-initialize WhatsApp Web client during startup');
  });
});
