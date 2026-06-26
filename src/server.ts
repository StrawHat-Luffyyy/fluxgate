import { serve } from '@hono/node-server';
import app from './app.js';
import { env } from './config/env.js';

console.log(`FluxGate Edge Router starting on port ${env.PORT} in ${env.NODE_ENV} mode...`);

serve({
  fetch: app.fetch,
  port: env.PORT
});