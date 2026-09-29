import assert from 'node:assert/strict';
import test from 'node:test';
import { unzipSync, strFromU8 } from 'fflate';
import { addNode, samplePage, updateNode } from '@builder/document';
import { app } from '../src/server.js';
import { pool } from '../src/db.js';
import { migrate } from '../src/store.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lqkAAAAASUVORK5CYII=', 'base64');
const send = (method, url, payload) => app.inject({ method, url, payload, headers: { 'content-type': 'application/json' } });

test('ZIP exports include saved paths, responsive CSS, bundled assets, and exact support reports', async () => {
  await migrate();
  let projectId;
  try {
    projectId = (await send('POST', '/api/projects', { name: 'Export integration' })).json().project.id;
    const uploaded = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/assets`, payload: png, headers: { 'content-type': 'image/png', 'x-file-name': 'logo.png' } });
    const asset = uploaded.json().asset;
    const unused = (await app.inject({ method: 'POST', url: `/api/projects/${projectId}/assets`, payload: png, headers: { 'content-type': 'image/png', 'x-file-name': 'unused.png' } })).json().asset;
    if (process.env.ASSET_STORE === 's3') await pool.query('UPDATE assets SET object_key=$2 WHERE id=$1', [unused.id, 'assets/missing-unused']);
    else await pool.query('UPDATE assets SET contents=$2 WHERE id=$1', [unused.id, Buffer.from('unavailable')]);
    let home = structuredClone(samplePage);
    home = updateNode(home, 'nav_about', { props: { href: '/about' } });
    home = updateNode(home, 'hero_inner', { styles: { mobile: { gridTemplateColumns: '1fr', gap: '12px' } } });
    home = addNode(home, 'header', 0, { id: 'uploaded_logo', type: 'Image', props: { src: asset.url, alt: 'Uploaded logo' }, styles: { desktop: { width: '80px' }, tablet: {}, mobile: { width: '48px' } } });
    home = addNode(home, 'main', 0, { id: 'uploaded_logo_main', type: 'Image', props: { src: asset.url, alt: 'Uploaded logo in main' }, styles: { desktop: {}, tablet: {}, mobile: {} } });
    home = addNode(home, 'footer', 0, { id: 'uploaded_logo_footer', type: 'Image', props: { src: asset.url, alt: 'Uploaded logo in footer' }, styles: { desktop: {}, tablet: {}, mobile: {} } });
    let about = structuredClone(samplePage);
    about.props.title = 'About & Contact';
    about = updateNode(about, 'nav_work', { props: { href: '/' } });
    const homePage = (await send('POST', `/api/projects/${projectId}/pages`, { name: 'Home', path: '/', document: home })).json().page;
    const aboutPage = (await send('POST', `/api/projects/${projectId}/pages`, { name: 'About', path: '/about', document: about })).json().page;
    assert.equal(aboutPage.path, '/about');
    assert.equal((await send('POST', `/api/projects/${projectId}/pages`, { name: 'Duplicate', path: '/about', document: about })).statusCode, 409);

    const unsupported = updateNode(home, 'hero', { styles: { mobile: { filter: 'blur(2px)' } } });
    assert.equal((await send('PUT', `/api/pages/${homePage.id}`, { expectedRevision: 1, document: unsupported })).statusCode, 200);
    const check = (await send('GET', `/api/projects/${projectId}/exports/react/check`)).json();
    assert.deepEqual(check.issues, [{ pagePath: '/', nodeId: 'hero', property: 'mobile.filter', message: 'react cannot export filter' }]);
    const blocked = await send('GET', `/api/projects/${projectId}/exports/react.zip`);
    assert.equal(blocked.statusCode, 422);
    assert.deepEqual(blocked.json().issues, check.issues);
    assert.equal((await send('PUT', `/api/pages/${homePage.id}`, { expectedRevision: 2, document: home })).statusCode, 200);

    for (const target of ['html', 'react', 'vue']) {
      const report = (await send('GET', `/api/projects/${projectId}/exports/${target}/check`)).json();
      assert.deepEqual(report.issues, []);
      assert.deepEqual(report.pages.map(page => page.path), ['/', '/about']);
      const response = await send('GET', `/api/projects/${projectId}/exports/${target}.zip`);
      assert.equal(response.statusCode, 200, `${target}: ${response.body}`);
      assert.match(response.headers['content-type'], /application\/zip/);
      const files = unzipSync(new Uint8Array(response.rawPayload));
      assert.ok(files['README.md']);
      assert.ok(files['package.json']);
      const assetName = `${target === 'html' ? '' : 'public/'}assets/${asset.id}.png`;
      assert.deepEqual(Buffer.from(files[assetName]), png);
      assert.equal(Object.keys(files).filter(name => name.endsWith(`/assets/${asset.id}.png`) || name === `assets/${asset.id}.png`).length, 1);
      assert.equal(Object.keys(files).some(name => name.includes(unused.id)), false);
      assert.equal(Object.entries(files).filter(([name]) => name.endsWith('.html') || name === 'src/pages.jsx' || name === 'src/pages.js').some(([, bytes]) => /\/api\/assets\/|localhost|s3-ninja/.test(strFromU8(bytes))), false);
      const css = strFromU8(files[target === 'html' ? 'styles.css' : 'src/styles.css']);
      assert.match(css, /@media \(max-width: 900px\)/);
      assert.match(css, /@media \(max-width: 600px\)/);
      assert.match(css, /gap:12px;grid-template-columns:1fr/);
      if (target === 'html') {
        assert.match(strFromU8(files['index.html']), /href="\.\/about\/"/);
        assert.match(strFromU8(files['about/index.html']), /About &amp; Contact/);
        assert.match(strFromU8(files['about/index.html']), /href="\.\.\/"/);
        assert.match(strFromU8(files['index.html']), new RegExp(`assets/${asset.id}\\.png`));
      } else {
        const pageSource = strFromU8(files[target === 'react' ? 'src/pages.jsx' : 'src/pages.js']);
        assert.match(pageSource, /\/about/);
        assert.match(pageSource, new RegExp(`assets/${asset.id}\\.png`));
      }
    }
    const missingDocument = updateNode(home, 'uploaded_logo', { props: { src: '/api/assets/00000000-0000-4000-8000-000000000099/content' } });
    await send('PUT', `/api/pages/${homePage.id}`, { expectedRevision: 3, document: missingDocument });
    const missing = await send('GET', `/api/projects/${projectId}/exports/html.zip`);
    assert.equal(missing.statusCode, 422);
    assert.match(missing.json().issues[0].message, /missing/);
    await send('PUT', `/api/pages/${homePage.id}`, { expectedRevision: 4, document: home });
    if (process.env.ASSET_STORE === 's3') {
      const original = (await pool.query('SELECT object_key FROM assets WHERE id=$1', [asset.id])).rows[0].object_key;
      await pool.query('UPDATE assets SET object_key=$2 WHERE id=$1', [asset.id, 'assets/missing-referenced']);
      try {
        const unavailable = await send('GET', `/api/projects/${projectId}/exports/html.zip`);
        assert.equal(unavailable.statusCode, 422);
        assert.match(unavailable.json().error, new RegExp(`Referenced asset ${asset.id} cannot be read`));
      } finally { await pool.query('UPDATE assets SET object_key=$2 WHERE id=$1', [asset.id, original]); }
    }
  } finally {
    if (projectId) await pool.query('DELETE FROM projects WHERE id=$1', [projectId]);
    await app.close(); await pool.end();
  }
});
