import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { normalizePagePath, samplePage, validateDocument } from '@builder/document';
import { pool } from './db.js';
import { assetBucket, assetStorageMode, deleteObject, getObject, putObject } from './object-store.js';

const migrations = ['001_baseline', '002_accounts_storage', '003_asset_bucket', '004_project_management'].map((name, index) => ({ version: index + 1, path: fileURLToPath(new URL(`./migrations/${name}.sql`, import.meta.url)) }));
export const assetUrl = id => `/api/assets/${id}/content`;

export const sampleProjectId = '00000000-0000-4000-8000-000000000001';
export const samplePageId = '00000000-0000-4000-8000-000000000002';

export async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(83140721)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const latest = (await client.query('SELECT max(version) AS version FROM schema_migrations')).rows[0].version;
    if (latest > migrations.at(-1).version) throw new Error(`Database schema version ${latest} is newer than this API`);
    for (const migration of migrations) {
      if ((await client.query('SELECT 1 FROM schema_migrations WHERE version=$1', [migration.version])).rowCount) continue;
      await client.query('BEGIN');
      try {
        await client.query(await readFile(migration.path, 'utf8'));
        await client.query('INSERT INTO schema_migrations(version) VALUES($1)', [migration.version]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
    if (process.env.NODE_ENV !== 'production') {
      await client.query('INSERT INTO projects(id,name) VALUES($1,$2) ON CONFLICT(id) DO NOTHING', [sampleProjectId, 'Sample project']);
      await client.query('INSERT INTO pages(id,project_id,name,path,document) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(id) DO NOTHING', [samplePageId, sampleProjectId, 'Sample page', '/', JSON.stringify(samplePage)]);
      await client.query('INSERT INTO page_revisions(page_id,revision,document) VALUES($1,1,$2::jsonb) ON CONFLICT(page_id,revision) DO NOTHING', [samplePageId, JSON.stringify(samplePage)]);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(83140721)');
    client.release();
  }
}

export function validName(value, label = 'Name') {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 120) throw Object.assign(new Error(`${label} must be 1–120 characters`), { statusCode: 400 });
  return value.trim();
}

export function validDocument(value) {
  try { return validateDocument(value); }
  catch (error) { throw Object.assign(new Error(`Invalid Page document: ${error.message}`), { statusCode: 400 }); }
}
function validPath(value) {
  try { return normalizePagePath(value); }
  catch (error) { throw Object.assign(error, { statusCode: 400 }); }
}

const projectColumns = 'p.id, p.name, p.version, p.created_at AS "createdAt", p.updated_at AS "updatedAt", GREATEST(p.updated_at, COALESCE(pg.last_updated, p.updated_at), COALESCE(a.last_updated, p.updated_at)) AS "lastUpdatedAt", COALESCE(pg.page_count, 0)::integer AS "pageCount", COALESCE(pg.revision_count, 0)::integer AS "revisionCount", COALESCE(a.asset_count, 0)::integer AS "assetCount"';
const projectFrom = `FROM projects p LEFT JOIN LATERAL (SELECT COUNT(*) AS page_count, MAX(updated_at) AS last_updated, (SELECT COUNT(*) FROM page_revisions pr JOIN pages rp ON rp.id=pr.page_id WHERE rp.project_id=p.id) AS revision_count FROM pages WHERE project_id=p.id) pg ON true LEFT JOIN LATERAL (SELECT COUNT(*) AS asset_count, MAX(created_at) AS last_updated FROM assets WHERE project_id=p.id) a ON true`;
const pageColumns = 'id, project_id AS "projectId", name, path, document, revision, created_at AS "createdAt", updated_at AS "updatedAt"';
const assetColumns = 'id, project_id AS "projectId", filename, media_type AS "mediaType", byte_length AS "byteLength", sha256, created_at AS "createdAt"';

export async function listProjects(ownerId = null) { return (await pool.query(`SELECT ${projectColumns} ${projectFrom} WHERE ($1::uuid IS NULL OR p.owner_id=$1) ORDER BY p.created_at, p.id`, [ownerId])).rows; }
export async function getProject(id) { return (await pool.query(`SELECT ${projectColumns} ${projectFrom} WHERE p.id=$1`, [id])).rows[0] || null; }
export async function createProject(name, ownerId = null) {
  const id = randomUUID();
  await pool.query('INSERT INTO projects(id,name,owner_id) VALUES($1,$2,$3)', [id, validName(name, 'Project name'), ownerId]);
  return getProject(id);
}
export async function updateProject(id, name, expectedVersion) {
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw Object.assign(new Error('expectedVersion must be a positive integer'), { statusCode: 400 });
  const result = await pool.query('UPDATE projects SET name=$2, version=version+1, updated_at=now() WHERE id=$1 AND version=$3 RETURNING id', [id, validName(name, 'Project name'), expectedVersion]);
  return result.rowCount ? { project: await getProject(id) } : { project: null, current: await getProject(id) };
}

export async function deleteProject(id, name, expectedVersion, expectedCounts) {
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw Object.assign(new Error('expectedVersion must be a positive integer'), { statusCode: 400 });
  if (typeof name !== 'string' || !name.trim() || name.length > 120) throw Object.assign(new Error('Confirmed project name is required'), { statusCode: 400 });
  if (!expectedCounts || ['pageCount', 'revisionCount', 'assetCount'].some(key => !Number.isInteger(expectedCounts[key]) || expectedCounts[key] < 0)) throw Object.assign(new Error('Expected project counts are required'), { statusCode: 400 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = (await client.query('SELECT id, name, version FROM projects WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!locked) { await client.query('ROLLBACK'); return { missing: true }; }
    const counts = (await client.query(`SELECT (SELECT count(*) FROM pages WHERE project_id=$1)::integer AS "pageCount", (SELECT count(*) FROM page_revisions pr JOIN pages pg ON pg.id=pr.page_id WHERE pg.project_id=$1)::integer AS "revisionCount", (SELECT count(*) FROM assets WHERE project_id=$1)::integer AS "assetCount"`, [id])).rows[0];
    if (locked.name !== name || locked.version !== expectedVersion || Object.keys(counts).some(key => counts[key] !== expectedCounts[key])) { await client.query('ROLLBACK'); return { conflict: true }; }
    const objects = (await client.query('SELECT DISTINCT object_bucket AS bucket, object_key AS key FROM assets WHERE project_id=$1 AND object_key IS NOT NULL', [id])).rows;
    for (const object of objects) {
      if (!object.bucket) throw Object.assign(new Error('Asset object bucket is missing; deletion stopped'), { statusCode: 409 });
      const shared = await client.query('SELECT 1 FROM assets WHERE project_id<>$1 AND object_bucket=$2 AND object_key=$3 LIMIT 1', [id, object.bucket, object.key]);
      if (!shared.rowCount) await client.query('INSERT INTO asset_object_deletions(object_bucket,object_key) VALUES($1,$2) ON CONFLICT DO NOTHING', [object.bucket, object.key]);
    }
    await client.query('DELETE FROM projects WHERE id=$1', [id]);
    await client.query('COMMIT');
    return { deleted: true, counts };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function drainAssetObjectDeletions() {
  const jobs = (await pool.query('SELECT id, object_bucket AS bucket, object_key AS key FROM asset_object_deletions ORDER BY id LIMIT 100')).rows;
  for (const job of jobs) {
    const shared = await pool.query('SELECT 1 FROM assets WHERE object_bucket=$1 AND object_key=$2 LIMIT 1', [job.bucket, job.key]);
    if (!shared.rowCount) {
      try { await deleteObject(job.key, job.bucket); }
      catch { continue; }
    }
    await pool.query('DELETE FROM asset_object_deletions WHERE id=$1', [job.id]);
  }
  return jobs.length;
}

export async function listPages(projectId) {
  return (await pool.query('SELECT id, project_id AS "projectId", name, path, revision, created_at AS "createdAt", updated_at AS "updatedAt" FROM pages WHERE project_id=$1 ORDER BY created_at, id', [projectId])).rows;
}
export async function getPage(id) { return (await pool.query(`SELECT ${pageColumns} FROM pages WHERE id=$1`, [id])).rows[0] || null; }

export async function createPage(projectId, name, document, path = '/') {
  const pageName = validName(name, 'Page name');
  const pagePath = validPath(path);
  const pageDocument = validDocument(document);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`INSERT INTO pages(id,project_id,name,path,document) VALUES($1,$2,$3,$4,$5::jsonb) RETURNING ${pageColumns}`, [randomUUID(), projectId, pageName, pagePath, JSON.stringify(pageDocument)]);
    const page = result.rows[0];
    await client.query('INSERT INTO page_revisions(page_id,revision,document) VALUES($1,1,$2::jsonb)', [page.id, JSON.stringify(pageDocument)]);
    await client.query('COMMIT');
    return page;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function savePage(id, expectedRevision, document, name, path) {
  const pageDocument = validDocument(document);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw Object.assign(new Error('expectedRevision must be a positive integer'), { statusCode: 400 });
  const pageName = name === undefined ? undefined : validName(name, 'Page name');
  const pagePath = path === undefined ? undefined : validPath(path);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`UPDATE pages SET document=$3::jsonb, name=COALESCE($4,name), path=COALESCE($5,path), revision=revision+1, updated_at=now() WHERE id=$1 AND revision=$2 RETURNING ${pageColumns}`, [id, expectedRevision, JSON.stringify(pageDocument), pageName ?? null, pagePath ?? null]);
    if (!result.rowCount) { await client.query('ROLLBACK'); return { page: null, current: await getPage(id) }; }
    const page = result.rows[0];
    await client.query('INSERT INTO page_revisions(page_id,revision,document) VALUES($1,$2,$3::jsonb)', [id, page.revision, JSON.stringify(pageDocument)]);
    await client.query('COMMIT');
    return { page };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function listRevisions(pageId) {
  return (await pool.query('SELECT revision, created_at AS "createdAt" FROM page_revisions WHERE page_id=$1 ORDER BY revision DESC', [pageId])).rows;
}
export async function getRevision(pageId, revision) {
  return (await pool.query('SELECT revision, document, created_at AS "createdAt" FROM page_revisions WHERE page_id=$1 AND revision=$2', [pageId, revision])).rows[0] || null;
}
export async function restorePage(id, revision, expectedRevision) {
  const previous = await getRevision(id, revision);
  if (!previous) return { missingRevision: true };
  return savePage(id, expectedRevision, previous.document);
}

export async function listAssets(projectId) {
  return (await pool.query(`SELECT ${assetColumns} FROM assets WHERE project_id=$1 ORDER BY created_at DESC, id`, [projectId])).rows.map(asset => ({ ...asset, url: assetUrl(asset.id) }));
}
export async function createAsset(projectId, filename, mediaType, contents) {
  const id = randomUUID();
  const sha256 = createHash('sha256').update(contents).digest('hex');
  const objectBucket = assetStorageMode() === 's3' ? assetBucket() : null;
  const objectKey = objectBucket ? `assets/${randomUUID()}` : null;
  if (objectKey) await putObject(objectKey, contents, mediaType, objectBucket);
  try {
    const result = await pool.query(`INSERT INTO assets(id,project_id,filename,media_type,byte_length,sha256,contents,object_key,object_bucket) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${assetColumns}`, [id, projectId, filename, mediaType, contents.length, sha256, objectKey ? null : contents, objectKey, objectBucket]);
    return { ...result.rows[0], url: assetUrl(id) };
  } catch (error) {
    if (objectKey) await deleteObject(objectKey, objectBucket).catch(() => {});
    throw error;
  }
}
export async function getAsset(id) {
  return (await pool.query(`SELECT ${assetColumns}, contents, object_key AS "objectKey", object_bucket AS "objectBucket" FROM assets WHERE id=$1`, [id])).rows[0] || null;
}
export async function assetContents(asset) {
  if (asset.objectKey && assetStorageMode() === 's3') return getObject(asset.objectKey, asset.objectBucket || assetBucket());
  if (asset.contents) return asset.contents;
  if (asset.objectKey) return getObject(asset.objectKey, asset.objectBucket || assetBucket());
  return null;
}

export async function projectExportData(projectId) {
  const [pages, assets] = await Promise.all([
    pool.query('SELECT id, name, path, document FROM pages WHERE project_id=$1 ORDER BY path, id', [projectId]),
    pool.query(`SELECT ${assetColumns} FROM assets WHERE project_id=$1`, [projectId])
  ]);
  if (pages.rows.length > 100) throw Object.assign(new Error('Export exceeds the page limit'), { statusCode: 413 });
  return { pages: pages.rows, assets: assets.rows };
}

export async function projectExportAssets(projectId, assetIds) {
  if (!assetIds.length) return [];
  const rows = (await pool.query(`SELECT ${assetColumns}, contents, object_key AS "objectKey", object_bucket AS "objectBucket" FROM assets WHERE project_id=$1 AND id=ANY($2::uuid[])`, [projectId, assetIds])).rows;
  const byId = new Map(rows.map(asset => [asset.id, asset]));
  const totalBytes = rows.reduce((sum, asset) => sum + asset.byteLength, 0);
  if (totalBytes > 100 * 1024 * 1024) throw Object.assign(new Error('Referenced assets exceed the 100 MB export limit'), { statusCode: 413 });
  return Promise.all(assetIds.map(async id => {
    const asset = byId.get(id);
    if (!asset) throw Object.assign(new Error(`Referenced asset ${id} is missing`), { statusCode: 422 });
    let contents;
    try { contents = await assetContents(asset); }
    catch { throw Object.assign(new Error(`Referenced asset ${id} cannot be read from storage`), { statusCode: 422 }); }
    if (!contents || contents.length !== asset.byteLength || createHash('sha256').update(contents).digest('hex') !== asset.sha256) throw Object.assign(new Error(`Referenced asset ${id} failed integrity verification`), { statusCode: 422 });
    return { ...asset, contents };
  }));
}
