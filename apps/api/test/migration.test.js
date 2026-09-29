import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { addNode, samplePage } from '@builder/document';
import { app } from '../src/server.js';
import { pool } from '../src/db.js';
import { assetContents, getAsset, migrate } from '../src/store.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lqkAAAAASUVORK5CYII=', 'base64');

test('legacy bytes migrate resumably without changing page or revision asset references', { skip: process.env.ASSET_STORE !== 's3' }, async () => {
  await migrate();
  let projectId;
  try {
    projectId = (await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Migration test' } })).json().project.id;
    const assetId = randomUUID();
    await pool.query('INSERT INTO assets(id,project_id,filename,media_type,byte_length,sha256,contents) VALUES($1,$2,$3,$4,$5,$6,$7)', [assetId, projectId, 'legacy.png', 'image/png', png.length, createHash('sha256').update(png).digest('hex'), png]);
    const source = `/api/assets/${assetId}/content`;
    const document = addNode(structuredClone(samplePage), 'header', 0, { id: 'migration_image', type: 'Image', props: { src: source, alt: 'Legacy image' }, styles: { desktop: {}, tablet: {}, mobile: {} } });
    const page = (await app.inject({ method: 'POST', url: `/api/projects/${projectId}/pages`, payload: { name: 'Legacy page', document } })).json().page;
    const before = (await pool.query('SELECT revision, document FROM page_revisions WHERE page_id=$1 ORDER BY revision', [page.id])).rows;
    const run = action => JSON.parse(execFileSync(process.execPath, ['apps/api/src/backfill-assets.js', action], { cwd: new URL('../../../', import.meta.url), env: process.env, encoding: 'utf8' }).trim());
    assert.equal(run('--dry-run').changes, 0);
    const migrated = run('--migrate');
    assert.ok(migrated.copied >= 1);
    assert.equal(run('--migrate').copied, 0);
    assert.ok(run('--verify').verifiedApiReads >= 1);
    const stored = await getAsset(assetId);
    assert.equal(stored.id, assetId);
    assert.deepEqual(stored.contents, png);
    assert.equal(stored.objectBucket, process.env.S3_BUCKET);
    assert.deepEqual(await assetContents(stored), png);
    assert.deepEqual((await app.inject({ method: 'GET', url: source })).rawPayload, png);
    assert.deepEqual((await pool.query('SELECT revision, document FROM page_revisions WHERE page_id=$1 ORDER BY revision', [page.id])).rows, before);
    assert.deepEqual((await app.inject({ method: 'GET', url: `/api/pages/${page.id}` })).json().page.document, document);
  } finally {
    if (projectId) await pool.query('DELETE FROM projects WHERE id=$1', [projectId]);
    await app.close(); await pool.end();
  }
});
