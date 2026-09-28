import Fastify from 'fastify';
import { samplePage, validateDocument } from '@builder/document';
import { checkDatabase, pool } from './db.js';

export const app = Fastify({ logger: true });
app.get('/api/health', async () => ({ ok: true }));
app.get('/api/health/db', async () => ({ ok: await checkDatabase() }));
app.get('/api/sample-page', async () => validateDocument(samplePage));

if (process.env.NODE_ENV !== 'test') {
  try {
    await app.listen({ port: Number(process.env.API_PORT || 3001), host: '127.0.0.1' });
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
  }
}

process.on('SIGTERM', async () => { await app.close(); await pool.end(); });
