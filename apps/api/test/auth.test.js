import assert from 'node:assert/strict';
import test from 'node:test';
import { samplePage } from '@builder/document';
process.env.AUTH_MODE = 'local';
process.env.PUBLIC_ORIGIN = 'http://localhost';
const { app } = await import('../src/server.js');
const { createUser } = await import('../src/auth.js');
const { pool } = await import('../src/db.js');
const { migrate, samplePageId, sampleProjectId } = await import('../src/store.js');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lqkAAAAASUVORK5CYII=', 'base64');
const send = (method, url, payload, cookie) => app.inject({ method, url, payload, headers: { origin: 'http://localhost', ...(cookie ? { cookie } : {}), ...(Buffer.isBuffer(payload) ? { 'content-type': 'image/png', 'x-file-name': 'photo.png' } : { 'content-type': 'application/json' }) } });

test('sessions and project ownership cover pages, revisions, assets and exports', async () => {
  await migrate();
  const suffix = Date.now();
  const first = await createUser(`owner${suffix}@example.test`, 'correct horse battery staple');
  const second = await createUser(`other${suffix}@example.test`, 'correct horse battery staple');
  try {
    const anonymous = await send('GET', '/api/projects');
    assert.equal(anonymous.statusCode, 401);
    assert.equal(anonymous.headers['x-content-type-options'], 'nosniff');
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: first.email, password: 'correct horse battery staple' }, headers: { origin: 'https://wrong.example', 'content-type': 'application/json' } })).statusCode, 403);
    assert.equal((await send('POST', '/api/auth/login', { email: first.email, password: 'incorrect password' })).statusCode, 401);
    const login = await send('POST', '/api/auth/login', { email: first.email, password: 'correct horse battery staple' });
    assert.equal(login.statusCode, 200);
    assert.match(login.headers['set-cookie'], /HttpOnly/);
    const one = login.headers['set-cookie'].split(';')[0];
    const two = (await send('POST', '/api/auth/login', { email: second.email, password: 'correct horse battery staple' })).headers['set-cookie'].split(';')[0];
    assert.equal((await send('GET', '/api/projects', undefined, two)).json().projects.find(item => item.id === sampleProjectId)?.access, 'System template');
    assert.equal((await send('GET', `/api/pages/${samplePageId}`, undefined, two)).statusCode, 200);
    const protectedDelete = await send('DELETE', `/api/pages/${samplePageId}`, { expectedRevision: 1, mode: 'subtree', confirmedPageIds: [samplePageId] }, two);
    assert.equal(protectedDelete.statusCode, 409);
    assert.match(protectedDelete.json().error, /System sample pages cannot be deleted/);
    const project = (await send('POST', '/api/projects', { name: 'Private project' }, one)).json().project;
    const copyRequest = { pages: [{ samplePageId: '00000000-0000-4000-8000-000000000003', name: 'Private template copy', path: '/template-copy' }] };
    assert.equal((await send('POST', `/api/projects/${project.id}/templates/copy`, copyRequest, two)).statusCode, 404);
    assert.equal((await send('POST', `/api/projects/${sampleProjectId}/templates/copy`, copyRequest, one)).statusCode, 404);
    const copied = (await send('POST', `/api/projects/${project.id}/templates/copy`, copyRequest, one)).json().pages[0];
    assert.equal(copied.sampleKey, null);
    assert.equal((await send('GET', `/api/pages/${copied.id}`, undefined, two)).statusCode, 404);
    const page = (await send('POST', `/api/projects/${project.id}/pages`, { name: 'Private page', document: samplePage }, one)).json().page;
    const badImage = Buffer.from(png); badImage.writeUInt32BE(8193, 16);
    assert.equal((await send('POST', `/api/projects/${project.id}/assets`, badImage, one)).statusCode, 400);
    const asset = (await send('POST', `/api/projects/${project.id}/assets`, png, one)).json().asset;
    assert.equal((await send('GET', '/api/projects', undefined, two)).json().projects.some(item => item.id === project.id), false);
    for (const url of [`/api/projects/${project.id}`, `/api/projects/${project.id}/pages`, `/api/pages/${page.id}`, `/api/pages/${page.id}/revisions`, `/api/assets/${asset.id}`, asset.url, `/api/projects/${project.id}/exports/html/check`, `/api/projects/${project.id}/exports/html.zip`]) {
      assert.equal((await send('GET', url, undefined, two)).statusCode, 404, url);
    }
    assert.equal((await send('PUT', `/api/pages/${page.id}`, { expectedRevision: 1, document: samplePage }, two)).statusCode, 404);
    assert.equal((await send('PATCH', `/api/pages/${page.id}`, { expectedRevision: 1, name: 'Stolen' }, two)).statusCode, 404);
    assert.equal((await send('POST', `/api/pages/${page.id}/move`, { expectedRevision: 1, parentPageId: null, index: 0 }, two)).statusCode, 404);
    assert.equal((await send('DELETE', `/api/pages/${page.id}`, { expectedRevision: 1, mode: 'subtree', confirmedPageIds: [page.id] }, two)).statusCode, 404);
    const encodedPage = `/api/pages/%${page.id.charCodeAt(0).toString(16)}${page.id.slice(1)}`;
    assert.equal((await send('GET', encodedPage, undefined, one)).statusCode, 200);
    assert.equal((await send('GET', encodedPage, undefined, two)).statusCode, 404);
    assert.equal((await send('GET', `/api/pages/${page.id}`, undefined, one)).statusCode, 200);
    assert.equal((await send('GET', '/api/pages/not-a-uuid', undefined, one)).statusCode, 400);
    assert.equal((await send('POST', '/api/auth/logout', {}, one)).statusCode, 200);
    assert.equal((await send('GET', `/api/pages/${page.id}`, undefined, one)).statusCode, 401);
  } finally {
    await pool.query('DELETE FROM projects WHERE owner_id=ANY($1::uuid[])', [[first.id, second.id]]);
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [[first.id, second.id]]);
    await app.close(); await pool.end();
  }
});
