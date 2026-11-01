import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  apiSecret: process.env.API_SECRET || '',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  environment: process.env.NODE_ENV || 'development',
  proxyTimeoutMs: parseInt(process.env.PROXY_TIMEOUT_MS || '30000', 10),
};
