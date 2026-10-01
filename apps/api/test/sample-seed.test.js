import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { pool } from '../src/db.js';

test('system samples initialize once, reject deletion, and preserve legacy absence', async () => {
  const run = async mode => {
    const schema = `sample_seed_test_${randomUUID().replaceAll('-', '')}`;
    await pool.query(`CREATE SCHEMA ${schema}`);
    try {
      const url = new URL(process.env.DATABASE_URL || 'postgres://builder:builder@127.0.0.1:15432/builder');
      url.searchParams.set('options', `-csearch_path=${schema}`);
      const output = execFileSync(process.execPath, ['test/sample-seed-worker.js', mode], {
        cwd: new URL('..', import.meta.url),
        env: { ...process.env, DATABASE_URL: url.toString(), NODE_ENV: 'test' },
        encoding: 'utf8'
      });
      assert.match(output, mode === 'legacy-missing' ? /legacy missing sample was not invented or recreated/ : /concurrent seed, maintenance preservation, protected deletion and ordinary CRUD passed/);
    } finally {
      await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    }
  };
  try { await run('fresh'); await run('legacy-missing'); }
  finally { await pool.end(); }
});
