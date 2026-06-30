import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

export const env = {
  PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:4200',
  DATABASE_URL: process.env.DATABASE_URL || 'file:./dev.db',
};
