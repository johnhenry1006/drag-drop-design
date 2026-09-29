import pg from 'pg';

if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) throw new Error('DATABASE_URL is required in production');
const connectionString = process.env.DATABASE_URL || 'postgres://builder:builder@127.0.0.1:15432/builder';
export const pool = new pg.Pool({ connectionString, max: Number(process.env.DB_POOL_MAX || 10), connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, statement_timeout: 30000 });
pool.on('error', error => { console.error(JSON.stringify({ level: 'error', event: 'database_idle_client_error', message: error.message })); });

export async function checkDatabase() {
  const result = await pool.query('SELECT 1 AS ready');
  return result.rows[0].ready === 1;
}
