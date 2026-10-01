import { pool } from './db.js';
import { migrate, sampleProjectId } from './store.js';

try {
  await migrate();
  const pages = (await pool.query('SELECT id,sample_key AS "sampleKey",fixture_version AS "fixtureVersion",revision FROM pages WHERE project_id=$1 AND sample_key IS NOT NULL ORDER BY sort_order,id', [sampleProjectId])).rows;
  console.log(JSON.stringify({ systemProjectId: sampleProjectId, pages }));
} finally { await pool.end(); }
