import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { samplePage } from '@builder/document';
process.env.AUTH_MODE = 'local';
process.env.PUBLIC_ORIGIN = 'http://localhost';
const { app } = await import('../src/server.js');
const { createUser } = await import('../src/auth.js');
const { pool } = await import('../src/db.js');
const { migrate } = await import('../src/store.js');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lqkAAAAASUVORK5CYII=', 'base64');
const send = (method, url, payload, cookie) => app.inject({ method, url, payload, headers: { origin: 'http://localhost', ...(cookie ? { cookie } : {}), ...(Buffer.isBuffer(payload) ? { 'content-type': 'image/png', 'x-file-name': 'project.png' } : { 'content-type': 'application/json' }) } });

test('owner manages two projects with counted deletion and cannot access another owner', async () => {
  await migrate();
  const suffix = crypto.randomUUID();
  const first = await createUser(`manage-${suffix}@example.test`, 'correct horse battery staple');
  const second = await createUser(`other-${suffix}@example.test`, 'correct horse battery staple');
  const one = (await send('POST', '/api/auth/login', { email: first.email, password: 'correct horse battery staple' })).headers['set-cookie'].split(';')[0];
  const two = (await send('POST', '/api/auth/login', { email: second.email, password: 'correct horse battery staple' })).headers['set-cookie'].split(';')[0];
  try {
    const alpha = (await send('POST', '/api/projects', { name: 'Alpha' }, one)).json().project;
    const beta = (await send('POST', '/api/projects', { name: 'Beta' }, one)).json().project;
    const page1 = (await send('POST', `/api/projects/${alpha.id}/pages`, { name: 'Home', path: '/', document: samplePage }, one)).json().page;
    await send('POST', `/api/projects/${alpha.id}/pages`, { name: 'About', path: '/about', document: samplePage }, one);
    const page2 = (await send('POST', `/api/projects/${beta.id}/pages`, { name: 'Home', path: '/', document: samplePage }, one)).json().page;
    const asset = (await send('POST', `/api/projects/${alpha.id}/assets`, png, one)).json().asset;
    const sharedKey = `shared-${randomUUID()}`;
    const sharedIds = [randomUUID(), randomUUID()];
    for (const [index, project] of [alpha, beta].entries()) await pool.query('INSERT INTO assets(id,project_id,filename,media_type,byte_length,sha256,contents,object_key,object_bucket) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [sharedIds[index], project.id, 'shared.png', 'image/png', png.length, createHash('sha256').update(png).digest('hex'), png, sharedKey, 'shared-test-bucket']);
    const listed = (await send('GET', '/api/projects', undefined, one)).json().projects;
    const detailed = listed.find(project => project.id === alpha.id);
    assert.equal(detailed.pageCount, 2);
    assert.equal(detailed.revisionCount, 2);
    assert.equal(detailed.assetCount, 2);
    assert.equal(detailed.access, 'Owner');
    assert.ok(Date.parse(detailed.lastUpdatedAt) >= Date.parse(detailed.createdAt));
    assert.equal(listed.find(project => project.id === beta.id).pageCount, 1);
    assert.equal((await send('GET', '/api/projects', undefined, two)).json().projects.some(project => project.id === alpha.id), false);
    for (const method of ['GET', 'PATCH', 'DELETE']) {
      const response = await send(method, `/api/projects/${alpha.id}`, method === 'PATCH' ? { name: 'Stolen', expectedVersion: detailed.version } : method === 'DELETE' ? { name: 'Alpha', expectedVersion: detailed.version, expectedCounts: { pageCount: 2, revisionCount: 2, assetCount: 2 } } : undefined, two);
      assert.equal(response.statusCode, 404);
    }
    assert.equal((await send('PATCH', `/api/projects/${alpha.id}`, { name: ' ', expectedVersion: detailed.version }, one)).statusCode, 400);
    const renamed = (await send('PATCH', `/api/projects/${alpha.id}`, { name: 'Alpha renamed', expectedVersion: detailed.version }, one)).json().project;
    assert.equal(renamed.version, detailed.version + 1);
    assert.equal((await send('PATCH', `/api/projects/${alpha.id}`, { name: 'Stale', expectedVersion: detailed.version }, one)).statusCode, 409);
    assert.equal((await send('DELETE', `/api/projects/${alpha.id}`, { name: 'Alpha renamed', expectedVersion: renamed.version, expectedCounts: { pageCount: 1, revisionCount: 2, assetCount: 2 } }, one)).statusCode, 409);
    const removed = await send('DELETE', `/api/projects/${alpha.id}`, { name: 'Alpha renamed', expectedVersion: renamed.version, expectedCounts: { pageCount: 2, revisionCount: 2, assetCount: 2 } }, one);
    assert.equal(removed.statusCode, 200);
    assert.deepEqual(removed.json().affected, { pageCount: 2, revisionCount: 2, assetCount: 2 });
    assert.equal((await send('GET', `/api/pages/${page1.id}`, undefined, one)).statusCode, 404);
    assert.equal((await send('GET', `/api/assets/${asset.id}`, undefined, one)).statusCode, 404);
    assert.equal((await pool.query('SELECT count(*)::integer AS count FROM page_revisions WHERE page_id=$1', [page1.id])).rows[0].count, 0);
    assert.equal((await send('GET', `/api/pages/${page2.id}`, undefined, one)).statusCode, 200);
    assert.equal((await send('GET', `/api/assets/${sharedIds[1]}`, undefined, one)).statusCode, 200);
    assert.equal((await pool.query('SELECT count(*)::integer AS count FROM asset_object_deletions WHERE object_key=$1', [sharedKey])).rows[0].count, 0);
    assert.equal((await send('GET', '/api/projects', undefined, one)).json().projects.some(project => project.id === beta.id), true);
  } finally {
    await pool.query('DELETE FROM projects WHERE owner_id=ANY($1::uuid[])', [[first.id, second.id]]);
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [[first.id, second.id]]);
    await app.close(); await pool.end();
  }
});
