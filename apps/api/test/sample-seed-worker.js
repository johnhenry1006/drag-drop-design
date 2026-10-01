import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { updateNode } from '@builder/document';
import { app } from '../src/server.js';
import { pool } from '../src/db.js';
import { deletePage, deleteProject, getPage, getProject, listPages, migrate, samplePageId, sampleProjectId } from '../src/store.js';
import { showcaseAssetId, showcasePageId } from '../src/system-samples.js';

const send = (method, url, payload) => app.inject({ method, url, payload, headers: { 'content-type': 'application/json' } });

try {
  assert.match((await pool.query('SELECT current_schema() AS schema')).rows[0].schema, /^sample_seed_test_/);
  if (process.argv[2] === 'legacy-missing') {
    await pool.query('CREATE TABLE schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const [index, name] of ['001_baseline', '002_accounts_storage', '003_asset_bucket', '004_project_management', '005_page_hierarchy'].entries()) {
      await pool.query(await readFile(new URL(`../src/migrations/${name}.sql`, import.meta.url), 'utf8'));
      await pool.query('INSERT INTO schema_migrations(version) VALUES($1)', [index + 1]);
    }
    await migrate();
    assert.equal(await getProject(sampleProjectId), null);
    assert.equal(await getPage(samplePageId), null);
    assert.equal((await pool.query('SELECT status FROM sample_seed_state WHERE sample_page_id=$1', [samplePageId])).rows[0].status, 'absent');
    await migrate();
    assert.equal(await getPage(samplePageId), null);
    console.log('legacy missing sample was not invented or recreated');
  } else {
    await Promise.all([migrate(), migrate()]);
    const project = await getProject(sampleProjectId);
    const original = await getPage(samplePageId);
    const showcase = await getPage(showcasePageId);
    assert.equal(project.systemKey, 'reference-templates');
    assert.equal(original.sampleKey, 'northstar-studio');
    assert.equal(showcase.sampleKey, 'responsive-showcase');
    assert.equal(showcase.fixtureVersion, 1);
    assert.deepEqual((await listPages(sampleProjectId)).map(page => page.id), [samplePageId, showcasePageId]);
    assert.equal((await pool.query('SELECT count(*)::integer AS count FROM assets WHERE id=$1 AND project_id=$2', [showcaseAssetId, sampleProjectId])).rows[0].count, 1);
    assert.equal((await send('GET', `/api/assets/${showcaseAssetId}/content`)).statusCode, 200);
    assert.ok(showcase.document.regions.main.some(node => JSON.stringify(node).includes(showcaseAssetId)));
    assert.equal(showcase.document.regions.header.length > 0 && showcase.document.regions.main.length > 0 && showcase.document.regions.footer.length > 0, true);
    const edited = updateNode(original.document, 'hero_title', { props: { text: 'Reviewed fixture maintenance' } });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('builder.sample_maintenance','on',true)");
      await client.query('UPDATE pages SET document=$2::jsonb,revision=2,fixture_version=2 WHERE id=$1', [samplePageId, JSON.stringify(edited)]);
      await client.query('INSERT INTO page_revisions(page_id,revision,document) VALUES($1,2,$2::jsonb)', [samplePageId, JSON.stringify(edited)]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    await migrate();
    await migrate();
    assert.equal((await listPages(sampleProjectId)).length, 2);
    assert.deepEqual((await getPage(samplePageId)).document, edited);
    assert.equal((await getPage(samplePageId)).fixtureVersion, 2);
    assert.equal((await getPage(samplePageId)).revision, 2);
    assert.equal((await pool.query('SELECT count(*)::integer AS count FROM page_revisions WHERE page_id=$1', [samplePageId])).rows[0].count, 2);

    assert.equal((await send('DELETE', `/api/pages/${samplePageId}`, { expectedRevision: 2, mode: 'subtree', confirmedPageIds: [samplePageId] })).statusCode, 409);
    assert.equal((await send('DELETE', `/api/pages/${samplePageId}`, { expectedRevision: 2, mode: 'reparent', destinationParentPageId: null, confirmedPageIds: [samplePageId] })).statusCode, 409);
    assert.equal((await send('DELETE', `/api/pages/${showcasePageId}`, { expectedRevision: 1, mode: 'subtree', confirmedPageIds: [showcasePageId] })).statusCode, 409);
    assert.equal((await send('DELETE', `/api/projects/${sampleProjectId}`, { name: project.name, expectedVersion: project.version, expectedCounts: { pageCount: 2, revisionCount: 3, assetCount: 1 } })).statusCode, 409);
    assert.equal((await send('PUT', `/api/pages/${samplePageId}`, { expectedRevision: 2, document: original.document })).statusCode, 409);
    assert.equal((await send('PATCH', `/api/pages/${samplePageId}`, { expectedRevision: 2, name: 'Changed' })).statusCode, 409);
    assert.equal((await send('POST', `/api/pages/${showcasePageId}/move`, { expectedRevision: 1, parentPageId: samplePageId, index: 0 })).statusCode, 409);
    assert.equal((await send('POST', `/api/projects/${sampleProjectId}/pages`, { name: 'Injected', document: original.document, sampleKey: 'fake' })).statusCode, 409);
    assert.equal((await send('PATCH', `/api/projects/${sampleProjectId}`, { name: 'Changed', expectedVersion: project.version })).statusCode, 409);
    await assert.rejects(pool.query('DELETE FROM pages WHERE id=ANY($1::uuid[])', [[samplePageId, showcasePageId]]), /cannot be deleted/);
    await assert.rejects(pool.query('DELETE FROM projects WHERE id=$1', [sampleProjectId]), /cannot be deleted/);
    await assert.rejects(pool.query('UPDATE pages SET name=$2 WHERE id=$1', [samplePageId, 'Changed']), /cannot be changed/);
    await assert.rejects(pool.query('DELETE FROM assets WHERE id=$1', [showcaseAssetId]), /cannot be changed or deleted/);
    assert.equal((await listPages(sampleProjectId)).length, 2);
    assert.equal((await getPage(samplePageId)).revision, 2);
    assert.equal((await pool.query('SELECT count(*)::integer AS count FROM assets WHERE id=$1', [showcaseAssetId])).rows[0].count, 1);

    // A legacy hierarchy can put a canonical page under an ordinary ancestor.
    // Deleting that ancestor must fail as one atomic operation as well.
    const ancestorId = '00000000-0000-4000-8000-000000000005';
    const client2 = await pool.connect();
    try {
      await client2.query('BEGIN');
      await client2.query("SELECT set_config('builder.sample_maintenance','on',true)");
      await client2.query('INSERT INTO pages(id,project_id,name,path,document,slug,sort_order) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)', [ancestorId, sampleProjectId, 'Legacy group', '/legacy-group', JSON.stringify(original.document), 'legacy-group', 2]);
      await client2.query('INSERT INTO page_revisions(page_id,revision,document) VALUES($1,1,$2::jsonb)', [ancestorId, JSON.stringify(original.document)]);
      await client2.query('UPDATE pages SET parent_page_id=$2,sort_order=0 WHERE id=$1', [showcasePageId, ancestorId]);
      await client2.query('COMMIT');
    } catch (error) { await client2.query('ROLLBACK'); throw error; }
    finally { client2.release(); }
    const subtreeAttempt = await send('DELETE', `/api/pages/${ancestorId}`, { expectedRevision: 1, mode: 'subtree', confirmedPageIds: [ancestorId, showcasePageId] });
    assert.equal(subtreeAttempt.statusCode, 409);
    assert.match(subtreeAttempt.json().error, /System sample pages cannot be deleted/);
    assert.equal((await getPage(ancestorId)).id, ancestorId);
    assert.equal((await getPage(showcasePageId)).parentPageId, ancestorId);
    assert.equal((await pool.query('SELECT count(*)::integer AS count FROM page_revisions WHERE page_id=$1', [showcasePageId])).rows[0].count, 1);

    const ordinary = (await send('POST', '/api/projects', { name: 'Ordinary project', systemKey: 'reference-templates' })).json().project;
    assert.equal(ordinary.systemKey, null);
    const page = (await send('POST', `/api/projects/${ordinary.id}/pages`, { name: 'Ordinary page', document: original.document, path: '/', sampleKey: 'fake', fixtureVersion: 999 })).json().page;
    assert.equal(page.sampleKey, null);
    assert.equal((await send('PATCH', `/api/pages/${page.id}`, { expectedRevision: 1, sampleKey: 'fake', name: 'Still ordinary' })).statusCode, 200);
    assert.equal((await getPage(page.id)).sampleKey, null);
    assert.deepEqual((await deletePage(page.id, 2, 'subtree', undefined, [page.id])).deletedPageIds, [page.id]);
    const current = await getProject(ordinary.id);
    assert.equal((await deleteProject(ordinary.id, current.name, current.version, { pageCount: 0, revisionCount: 0, assetCount: 0 })).deleted, true);
    console.log('concurrent seed, maintenance preservation, protected deletion and ordinary CRUD passed');
  }
} finally { await app.close(); await pool.end(); }
