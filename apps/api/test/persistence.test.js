import assert from 'node:assert/strict';
import test from 'node:test';
import { addNode, removeNode, samplePage, updateNode } from '@builder/document';
import { app } from '../src/server.js';
import { pool } from '../src/db.js';
import { migrate } from '../src/store.js';
import { headObject } from '../src/object-store.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lqkAAAAASUVORK5CYII=', 'base64');
const send = (method, url, payload) => app.inject({ method, url, payload, headers: { 'content-type': 'application/json' } });

test('JSONB pages, revisions, conflicts, restoration, and assets survive a reload', async () => {
  await migrate();
  let projectId;
  try {
    const project = (await send('POST', '/api/projects', { name: 'Persistence test' })).json().project;
    projectId = project.id;
    const list = (await send('GET', '/api/projects')).json().projects;
    assert.ok(list.some(item => item.id === projectId));

    let document = structuredClone(samplePage);
    const inner = document.regions.main[0].children[0];
    const nested = { id: 'persist_nested', type: 'Container', props: { label: 'Saved nested' }, styles: { desktop: { padding: '12px' }, tablet: {}, mobile: { padding: '4px' } }, children: [] };
    document = addNode(document, inner.id, inner.children.length, nested);
    document = updateNode(document, nested.id, { advancedCss: { mobile: 'letter-spacing:.1em' } });
    const invalid = structuredClone(document);
    invalid.regions.main[0].children[0].children[0].styles.mobile.backgroundColor = 'red;body{display:none}';
    assert.equal((await send('POST', `/api/projects/${projectId}/pages`, { name: 'Bad', document: invalid })).statusCode, 400);

    const created = await send('POST', `/api/projects/${projectId}/pages`, { name: 'Nested page', document });
    assert.equal(created.statusCode, 201);
    const page = created.json().page;
    assert.equal(page.revision, 1);
    assert.deepEqual((await send('GET', `/api/pages/${page.id}`)).json().page.document, document);
    assert.equal((await send('GET', `/api/projects/${projectId}/pages`)).json().pages[0].id, page.id);

    const modified = updateNode(document, nested.id, { props: { label: 'Edited nested' }, styles: { mobile: { padding: '8px' } } });
    const saved = await send('PUT', `/api/pages/${page.id}`, { expectedRevision: 1, document: modified });
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.json().page.revision, 2);
    assert.equal((await send('PUT', `/api/pages/${page.id}`, { expectedRevision: 1, document })).statusCode, 409);
    assert.equal((await send('GET', `/api/pages/${page.id}`)).json().page.document.regions.main[0].children[0].children.at(-1).props.label, 'Edited nested');
    assert.deepEqual((await send('GET', `/api/pages/${page.id}/revisions`)).json().revisions.map(item => item.revision), [2, 1]);

    const upload = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/assets`, payload: png, headers: { 'content-type': 'image/png', 'x-file-name': encodeURIComponent('saved.png') } });
    assert.equal(upload.statusCode, 201);
    const asset = upload.json().asset;
    assert.equal(asset.url, `/api/assets/${asset.id}/content`);
    const stored = (await pool.query('SELECT contents, object_bucket, object_key FROM assets WHERE id=$1', [asset.id])).rows[0];
    if (process.env.ASSET_STORE === 's3') {
      assert.equal(stored.contents, null);
      assert.equal(stored.object_bucket, process.env.S3_BUCKET);
      assert.match(stored.object_key, /^assets\/[0-9a-f-]{36}$/);
      assert.equal(stored.object_key.includes(asset.id), false);
      assert.equal((await headObject(stored.object_key, stored.object_bucket)).ContentLength, png.length);
    } else {
      assert.deepEqual(stored.contents, png);
      assert.equal(stored.object_key, null);
    }
    const metadata = (await send('GET', `/api/assets/${asset.id}`)).json().asset;
    assert.equal(metadata.sha256, asset.sha256);
    assert.equal('contents' in metadata, false);
    assert.equal('objectKey' in metadata, false);
    assert.equal('objectBucket' in metadata, false);
    const invalidUpload = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/assets`, payload: Buffer.from('not an image'), headers: { 'content-type': 'image/png', 'x-file-name': 'invalid.png' } });
    assert.equal(invalidUpload.statusCode, 400);
    const imageNode = { id: 'persist_image', type: 'Image', props: { src: asset.url, alt: 'Uploaded' }, styles: { desktop: {}, tablet: {}, mobile: {} } };
    const withImage = addNode(modified, nested.id, 0, imageNode);
    const withTwoImages = addNode(withImage, nested.id, 1, { ...imageNode, id: 'persist_image_reused' });
    assert.equal((await send('PUT', `/api/pages/${page.id}`, { expectedRevision: 2, document: withTwoImages })).statusCode, 200);
    const loaded = (await send('GET', `/api/pages/${page.id}`)).json().page.document;
    assert.equal(loaded.regions.main[0].children[0].children.at(-1).children[0].props.src, asset.url);
    const bytes = await app.inject({ method: 'GET', url: asset.url });
    assert.equal(bytes.statusCode, 200);
    assert.deepEqual(bytes.rawPayload, png);

    const afterRemoval = removeNode(withTwoImages, imageNode.id);
    assert.equal((await send('PUT', `/api/pages/${page.id}`, { expectedRevision: 3, document: afterRemoval })).statusCode, 200);
    assert.equal((await send('GET', `/api/pages/${page.id}`)).json().page.document.regions.main[0].children[0].children.at(-1).children[0].props.src, asset.url);
    assert.equal((await app.inject({ method: 'GET', url: asset.url })).statusCode, 200);

    const restored = await send('POST', `/api/pages/${page.id}/restore`, { revision: 1, expectedRevision: 4 });
    assert.equal(restored.statusCode, 200);
    assert.equal(restored.json().page.revision, 5);
    assert.deepEqual(restored.json().page.document, document);
    assert.equal((await app.inject({ method: 'GET', url: asset.url })).statusCode, 200);
    assert.ok((await send('GET', `/api/projects/${projectId}/assets`)).json().assets.some(item => item.id === asset.id));
  } finally {
    if (projectId) await pool.query('DELETE FROM projects WHERE id=$1', [projectId]);
    await app.close();
    await pool.end();
  }
});
