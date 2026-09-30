import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { updateNode } from '@builder/document';
import { pool } from '../src/db.js';
import { deletePage, deleteProject, getPage, getProject, listPages, migrate, samplePageId, sampleProjectId, savePage } from '../src/store.js';

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
    await migrate();
    const original = await getPage(samplePageId);
    assert.equal(original.projectId, sampleProjectId);
    assert.equal((await listPages(sampleProjectId)).length, 1);
    const edited = updateNode(original.document, 'hero_title', { props: { text: 'Saved sample edit' } });
    const saved = await savePage(samplePageId, original.revision, edited);
    assert.equal(saved.page.revision, 2);
    await migrate();
    await migrate();
    assert.equal((await listPages(sampleProjectId)).length, 1);
    assert.deepEqual((await getPage(samplePageId)).document, edited);
    assert.equal((await getPage(samplePageId)).revision, 2);
    assert.equal((await pool.query('SELECT count(*)::integer AS count FROM page_revisions WHERE page_id=$1', [samplePageId])).rows[0].count, 2);

    const deleted = await deletePage(samplePageId, 2, 'subtree', undefined, [samplePageId]);
    assert.deepEqual(deleted.deletedPageIds, [samplePageId]);
    await migrate();
    assert.equal(await getPage(samplePageId), null);
    assert.equal((await pool.query('SELECT status FROM sample_seed_state WHERE sample_page_id=$1', [samplePageId])).rows[0].status, 'deleted');

    const project = await getProject(sampleProjectId);
    const removed = await deleteProject(sampleProjectId, project.name, project.version, { pageCount: 0, revisionCount: 0, assetCount: 0 });
    assert.equal(removed.deleted, true);
    await migrate();
    assert.equal(await getProject(sampleProjectId), null);
    assert.equal(await getPage(samplePageId), null);
    console.log('isolated sample seed, saved edit, page deletion, and project deletion passed');
  }
} finally { await pool.end(); }
