import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { env } from './config/env';
import wwebRoutes from './modules/whatsapp-web/whatsapp-web.routes';
import messageRoutes from './modules/messages/messages.routes';
import contactRoutes from './modules/contacts/contacts.routes';

const app = express();

app.use(cors({
  origin: env.CORS_ORIGIN,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve local media uploads
const UPLOADS_ROOT = path.join(__dirname, '../uploads');
app.use('/uploads', express.static(UPLOADS_ROOT));

// Fallback resolver: older media was saved under the originally-typed phone/JID
// directory, but device columns were later normalized. If the file isn't found
// in the requested directory, search the other upload folders by filename.
app.get('/uploads/:phone/:filename', (req: Request, res: Response) => {
  const filename = String(req.params.filename);
  try {
    const dirs = fs.readdirSync(UPLOADS_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory());
    for (const d of dirs) {
      const candidate = path.join(UPLOADS_ROOT, d.name, filename);
      if (fs.existsSync(candidate)) {
        return res.sendFile(candidate);
      }
    }
  } catch (e) {
    // fall through to 404
  }
  res.status(404).end();
});

// API Routes
app.use('/api/v1/whatsapp-web', wwebRoutes);
app.use('/api/v1/messages', messageRoutes);
app.use('/api/v1/contacts', contactRoutes);

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

// ── Serve the built Angular frontend (single-origin deployment) ──────────────
// Build output of @angular/build:application lives in frontend/dist/frontend/browser.
const FRONTEND_DIST =
  process.env.FRONTEND_DIST || path.join(__dirname, '../../frontend/dist/frontend/browser');

if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));

  // SPA fallback: any non-API GET that isn't a real file returns index.html so
  // Angular's client-side router can handle the route.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET') return next();
    if (
      req.path.startsWith('/api') ||
      req.path.startsWith('/uploads') ||
      req.path.startsWith('/socket.io') ||
      req.path === '/health'
    ) {
      return next();
    }
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  });
}

// Global Error Handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled Server Error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
    error: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });
});

export default app;
