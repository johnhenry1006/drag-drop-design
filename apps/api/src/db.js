import pg from 'pg';

const connectionString = process.env.DATABASE_URL || 'postgres://builder:builder@127.0.0.1:15432/builder';
export const pool = new pg.Pool({ connectionString });

export async function checkDatabase() {
  const result = await pool.query('SELECT 1 AS ready');
  return result.rows[0].ready === 1;
}
