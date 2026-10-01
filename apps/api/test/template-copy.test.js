import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { unzipSync } from 'fflate';
import { app } from '../src/server.js';
import { pool } from '../src/db.js';
import { migrate } from '../src/store.js';
import { northstarPageId, showcaseAssetId, showcasePageId } from '../src/system-samples.js';

const send = (method, url, payload) => app.inject({ method, url, payload, headers: { 'content-type': 'application/json' } });
const imageId = document => {
  const walk = node => node.type === 'Image' && node.props.src.includes('/api/assets/') ? node.props.src.match(/\/api\/assets\/([^/]+)\/content/)[1] : node.children?.map(walk).find(Boolean);
  return Object.values(document.regions).flat().map(walk).find(Boolean);
};
const nodeIds = document => {
  const ids = [document.id];
  const walk = node => { ids.push(node.id); node.children?.forEach(walk); };
  Object.values(document.regions).flat().forEach(walk);
  return new Set(ids);
};

test('template copies are independent editable pages with private assets and working exports', async () => {
  await migrate();
  const original = (await send('GET', `/api/pages/${showcasePageId}`)).json().page;
  const originalAsset = (await send('GET', `/api/assets/${showcaseAssetId}`)).json().asset;
  const project = (await send('POST', '/api/projects', { name: `Template copies ${randomUUID()}` })).json().project;
  try {
    const templates = (await send('GET', '/api/templates')).json().templates;
    assert.equal(templates.find(item => item.id === showcasePageId)?.sampleKey, 'responsive-showcase');
    const invalid = await send('POST', `/api/projects/${project.id}/templates/copy`, { pages: [{ samplePageId: randomUUID(), name: 'Fake', path: '/fake' }] });
    assert.equal(invalid.statusCode, 400);
    assert.equal((await send('GET', `/api/projects/${project.id}/pages`)).json().pages.length, 0);
    const copy = async (name, path) => {
      const response = await send('POST', `/api/projects/${project.id}/templates/copy`, { pages: [{ samplePageId: showcasePageId, name, path }] });
      assert.equal(response.statusCode, 201, response.body);
      return response.json().pages[0];
    };
    const first = await copy('First copy', '/first-copy');
    const second = await copy('Second copy', '/second-copy');
    assert.notEqual(first.id, second.id);
    assert.equal(first.sampleKey, null);
    assert.equal(first.fixtureVersion, null);
    assert.equal(first.projectId, project.id);
    assert.deepEqual([...nodeIds(first.document)].filter(id => nodeIds(original.document).has(id)), []);
    assert.deepEqual([...nodeIds(first.document)].filter(id => nodeIds(second.document).has(id)), []);
    const firstAssetId = imageId(first.document);
    const secondAssetId = imageId(second.document);
    assert.notEqual(firstAssetId, showcaseAssetId);
    assert.notEqual(secondAssetId, showcaseAssetId);
    assert.notEqual(firstAssetId, secondAssetId);
    assert.equal((await send('GET', `/api/assets/${firstAssetId}`)).json().asset.projectId, project.id);
    assert.equal((await send('GET', `/api/projects/${project.id}/assets`)).json().assets.length, 2);
    assert.deepEqual((await send('GET', `/api/assets/${firstAssetId}/content`)).rawPayload, (await send('GET', `/api/assets/${showcaseAssetId}/content`)).rawPayload);
    assert.equal(first.document.regions.main[0].styles?.mobile?.gridTemplateColumns, original.document.regions.main[0].styles?.mobile?.gridTemplateColumns);

    const edited = structuredClone(first.document);
    edited.props.title = 'Edited copy';
    assert.equal((await send('PUT', `/api/pages/${first.id}`, { expectedRevision: 1, document: edited })).statusCode, 200);
    assert.equal((await send('PATCH', `/api/pages/${first.id}`, { expectedRevision: 2, name: 'Renamed copy' })).statusCode, 200);
    assert.equal((await send('POST', `/api/pages/${first.id}/move`, { expectedRevision: 3, parentPageId: second.id, index: 0 })).statusCode, 200);
    assert.equal((await send('GET', `/api/pages/${first.id}`)).json().page.document.props.title, 'Edited copy');
    for (const target of ['html', 'react', 'vue']) {
      const check = await send('GET', `/api/projects/${project.id}/exports/${target}/check`);
      assert.deepEqual(check.json().issues, []);
      const zip = await send('GET', `/api/projects/${project.id}/exports/${target}.zip`);
      assert.equal(zip.statusCode, 200, zip.body.slice(0, 300));
      const files = unzipSync(zip.rawPayload);
      const assetPath = target === 'html' ? `assets/${firstAssetId}.png` : `public/assets/${firstAssetId}.png`;
      assert.ok(files[assetPath], `${target} bundles the copied asset`);
      const pageSource = Buffer.from(files[target === 'html' ? 'first-copy/index.html' : target === 'react' ? 'src/pages.jsx' : 'src/pages.js']).toString('utf8');
      assert.match(pageSource, new RegExp(`assets/${firstAssetId}\\.png`));
      assert.doesNotMatch(pageSource, new RegExp(showcaseAssetId));
      const css = Buffer.from(files[target === 'html' ? 'styles.css' : 'src/styles.css']).toString('utf8');
      assert.match(css, /@media \(max-width: 600px\)/);
      assert.ok(Object.keys(files).some(path => path.includes('first-copy')) || target !== 'html');
    }
    const deleteResult = await send('DELETE', `/api/pages/${first.id}`, { expectedRevision: 4, mode: 'subtree', confirmedPageIds: [first.id] });
    assert.equal(deleteResult.statusCode, 200, deleteResult.body);
    const setCopy = await send('POST', `/api/projects/${project.id}/templates/copy`, { pages: [
      { samplePageId: northstarPageId, name: 'Set home', path: '/set-home' },
      { samplePageId: showcasePageId, name: 'Set showcase', path: '/set-showcase' }
    ] });
    assert.equal(setCopy.statusCode, 201, setCopy.body);
    assert.deepEqual(new Set(setCopy.json().pages.map(page => page.path)), new Set(['/set-home', '/set-showcase']));
    assert.equal((await send('GET', `/api/pages/${showcasePageId}`)).json().page.revision, original.revision);
    assert.equal((await send('GET', `/api/assets/${showcaseAssetId}`)).json().asset.sha256, originalAsset.sha256);
    assert.equal((await send('GET', `/api/assets/${showcaseAssetId}/content`)).statusCode, 200);
    assert.equal((await send('GET', `/api/pages/${second.id}`)).statusCode, 200);
    assert.equal((await send('DELETE', `/api/pages/${showcasePageId}`, { expectedRevision: original.revision, mode: 'subtree', confirmedPageIds: [showcasePageId] })).statusCode, 409);
  } finally {
    const current = (await send('GET', `/api/projects/${project.id}`)).json().project;
    await send('DELETE', `/api/projects/${project.id}`, { name: current.name, expectedVersion: current.version, expectedCounts: { pageCount: current.pageCount, revisionCount: current.revisionCount, assetCount: current.assetCount } });
    await app.close(); await pool.end();
  }
});
