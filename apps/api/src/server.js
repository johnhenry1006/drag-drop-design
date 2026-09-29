import Fastify from 'fastify';
import { zipSync, strToU8 } from 'fflate';
import { imageSize } from 'image-size';
import { samplePage } from '@builder/document';
import { analyzeProjectExport, buildProjectFiles, referencedAssetIds } from '@builder/exporters/project';
import { checkDatabase, pool } from './db.js';
import { assetContents } from './store.js';
import { checkObjectStore } from './object-store.js';
import { authMode, clearCookie, cookie, currentUser, ownsAsset, ownsPage, ownsProject, sessionToken, signIn, signOut } from './auth.js';
import { createAsset, createPage, createProject, deleteProject, drainAssetObjectDeletions, getAsset, getPage, getProject, getRevision, listAssets, listPages, listProjects, listRevisions, migrate, projectExportAssets, projectExportData, restorePage, savePage, updateProject, validDocument } from './store.js';

export const app = Fastify({ logger: process.env.NODE_ENV !== 'test', bodyLimit: 2 * 1024 * 1024, requestTimeout: 30000, trustProxy: process.env.TRUST_PROXY === 'true' });
const missing = (reply, kind) => reply.code(404).send({ error: `${kind} not found` });
const uuid = value => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw Object.assign(new Error('Invalid ID'), { statusCode: 400 });
  return value;
};
const revision = value => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw Object.assign(new Error('Invalid revision'), { statusCode: 400 });
  return number;
};
const imageTypes = {
  'image/png': bytes => bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  'image/jpeg': bytes => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  'image/gif': bytes => ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6)),
  'image/webp': bytes => bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
};

app.setErrorHandler((error, request, reply) => {
  const status = error.statusCode || (error.code === '23503' ? 404 : error.code === '23505' ? 409 : 500);
  if (status >= 500) request.log.error(error);
  reply.code(status).send({ error: status >= 500 ? 'Internal server error' : error.code === '23505' ? 'Page path already exists in this project' : error.message });
});
const rateBuckets = new Map();
app.addHook('onRequest', async (request, reply) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  const origin = process.env.PUBLIC_ORIGIN;
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) && origin && request.headers.origin !== origin) return reply.code(403).send({ error: 'Invalid request origin' });
  const now = Date.now();
  const key = `${request.ip}:${path === '/api/auth/login' ? 'login' : 'api'}`;
  const limit = path === '/api/auth/login' ? 5 : 240;
  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.start > 60000) rateBuckets.set(key, { start: now, count: 1 });
  else if (++bucket.count > limit) return reply.code(429).header('Retry-After', '60').send({ error: 'Rate limit exceeded' });
  if (rateBuckets.size > 10000) for (const [bucketKey, value] of rateBuckets) if (now - value.start > 60000) rateBuckets.delete(bucketKey);
  if (authMode !== 'local' || path.startsWith('/api/health') || path === '/api/auth/login') return;
  const user = await currentUser(sessionToken(request));
  if (!user) return reply.code(401).send({ error: 'Sign in required' });
  request.user = user;
  const { projectId, pageId, assetId } = request.params || {};
  if ((projectId && !await ownsProject(user.id, uuid(projectId))) || (pageId && !await ownsPage(user.id, uuid(pageId))) || (assetId && !await ownsAsset(user.id, uuid(assetId)))) return reply.code(404).send({ error: 'Resource not found' });
});
app.addHook('onSend', async (request, reply, payload) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  reply.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  reply.header('Cache-Control', reply.getHeader('Cache-Control') || 'no-store');
  if (process.env.NODE_ENV === 'production') reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  return payload;
});
app.addContentTypeParser(/^image\/(png|jpeg|gif|webp)$/, { parseAs: 'buffer', bodyLimit: 10 * 1024 * 1024 }, (request, body, done) => done(null, body));

app.get('/api/health', async () => ({ ok: true }));
app.get('/api/health/ready', async (request, reply) => {
  try { await Promise.all([checkDatabase(), checkObjectStore()]); return { ok: true }; }
  catch (error) { request.log.error(error); return reply.code(503).send({ ok: false }); }
});
app.get('/api/auth/me', async request => ({ enabled: authMode === 'local', user: request.user || null }));
app.post('/api/auth/login', async (request, reply) => {
  if (authMode !== 'local') return reply.code(404).send({ error: 'Sign in is disabled' });
  const result = await signIn(request.body?.email, request.body?.password);
  if (!result) return reply.code(401).send({ error: 'Invalid credentials' });
  return reply.header('Set-Cookie', cookie(result.token)).send({ enabled: true, user: result.user });
});
app.post('/api/auth/logout', async (request, reply) => {
  await signOut(sessionToken(request));
  return reply.header('Set-Cookie', clearCookie()).send({ ok: true });
});
app.get('/api/health/db', async () => ({ ok: await checkDatabase() }));
app.get('/api/sample-page', async () => validDocument(samplePage));

const withAccess = (project, request) => ({ ...project, access: request.user ? 'Owner' : 'Local access' });
app.get('/api/projects', async request => ({ projects: (await listProjects(request.user?.id || null)).map(project => withAccess(project, request)) }));
app.post('/api/projects', async (request, reply) => reply.code(201).send({ project: withAccess(await createProject(request.body?.name, request.user?.id || null), request) }));
app.get('/api/projects/:projectId', async (request, reply) => {
  const project = await getProject(uuid(request.params.projectId));
  return project ? { project: withAccess(project, request) } : missing(reply, 'Project');
});
app.patch('/api/projects/:projectId', async (request, reply) => {
  const result = await updateProject(uuid(request.params.projectId), request.body?.name, request.body?.expectedVersion);
  if (result.project) return { project: withAccess(result.project, request) };
  if (!result.current) return missing(reply, 'Project');
  return reply.code(409).send({ error: 'Project changed. Reload and try again.', currentVersion: result.current.version });
});
app.delete('/api/projects/:projectId', async (request, reply) => {
  const result = await deleteProject(uuid(request.params.projectId), request.body?.name, request.body?.expectedVersion, request.body?.expectedCounts);
  if (result.missing) return missing(reply, 'Project');
  if (result.conflict) return reply.code(409).send({ error: 'Project name or contents changed. Reload its details before deleting.' });
  await drainAssetObjectDeletions().catch(error => request.log.error(error));
  return { deleted: true, affected: result.counts };
});
app.get('/api/projects/:projectId/pages', async (request, reply) => {
  const id = uuid(request.params.projectId);
  if (!await getProject(id)) return missing(reply, 'Project');
  return { pages: await listPages(id) };
});
app.post('/api/projects/:projectId/pages', async (request, reply) => {
  const id = uuid(request.params.projectId);
  if (!await getProject(id)) return missing(reply, 'Project');
  return reply.code(201).send({ page: await createPage(id, request.body?.name, request.body?.document, request.body?.path) });
});
app.get('/api/pages/:pageId', async (request, reply) => {
  const page = await getPage(uuid(request.params.pageId));
  return page ? { page } : missing(reply, 'Page');
});
app.put('/api/pages/:pageId', async (request, reply) => {
  const result = await savePage(uuid(request.params.pageId), request.body?.expectedRevision, request.body?.document, request.body?.name, request.body?.path);
  if (result.page) return { page: result.page };
  if (!result.current) return missing(reply, 'Page');
  return reply.code(409).send({ error: 'Page revision conflict', currentRevision: result.current.revision });
});
app.get('/api/pages/:pageId/revisions', async (request, reply) => {
  const id = uuid(request.params.pageId);
  if (!await getPage(id)) return missing(reply, 'Page');
  return { revisions: await listRevisions(id) };
});
app.get('/api/pages/:pageId/revisions/:revision', async (request, reply) => {
  const record = await getRevision(uuid(request.params.pageId), revision(request.params.revision));
  return record ? { revision: record } : missing(reply, 'Revision');
});
app.post('/api/pages/:pageId/restore', async (request, reply) => {
  const result = await restorePage(uuid(request.params.pageId), revision(request.body?.revision), request.body?.expectedRevision);
  if (result.missingRevision) return missing(reply, 'Revision');
  if (result.page) return { page: result.page };
  if (!result.current) return missing(reply, 'Page');
  return reply.code(409).send({ error: 'Page revision conflict', currentRevision: result.current.revision });
});

app.get('/api/projects/:projectId/assets', async (request, reply) => {
  const id = uuid(request.params.projectId);
  if (!await getProject(id)) return missing(reply, 'Project');
  return { assets: await listAssets(id) };
});
app.post('/api/projects/:projectId/assets', { bodyLimit: 10 * 1024 * 1024 }, async (request, reply) => {
  const id = uuid(request.params.projectId);
  if (!await getProject(id)) return missing(reply, 'Project');
  const mediaType = request.headers['content-type']?.toLowerCase();
  const contents = request.body;
  if (!imageTypes[mediaType] || !Buffer.isBuffer(contents) || !contents.length || !imageTypes[mediaType](contents)) {
    return reply.code(400).send({ error: 'Upload a valid PNG, JPEG, GIF, or WebP image' });
  }
  try {
    const dimensions = imageSize(contents);
    const expected = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }[mediaType];
    if (dimensions.type !== expected || !dimensions.width || !dimensions.height || dimensions.width > 8192 || dimensions.height > 8192 || dimensions.width * dimensions.height > 32000000) throw new Error('Invalid dimensions');
  } catch { return reply.code(400).send({ error: 'Image is malformed or exceeds 8192 pixels per side / 32 megapixels' }); }
  let filename;
  try { filename = decodeURIComponent(String(request.headers['x-file-name'] || 'image')); }
  catch { return reply.code(400).send({ error: 'Invalid image filename' }); }
  if (!filename || filename.length > 255 || filename.split('').some(character => character === '/' || character === '\\' || character.charCodeAt(0) < 32)) return reply.code(400).send({ error: 'Invalid image filename' });
  return reply.code(201).send({ asset: await createAsset(id, filename, mediaType, contents) });
});
app.get('/api/assets/:assetId', async (request, reply) => {
  const asset = await getAsset(uuid(request.params.assetId));
  if (!asset) return missing(reply, 'Asset');
  const metadata = { ...asset };
  delete metadata.contents; delete metadata.objectKey; delete metadata.objectBucket;
  return { asset: { ...metadata, url: `/api/assets/${asset.id}/content` } };
});
app.get('/api/assets/:assetId/content', async (request, reply) => {
  const asset = await getAsset(uuid(request.params.assetId));
  if (!asset) return missing(reply, 'Asset');
  return reply.header('Cache-Control', 'private, max-age=31536000, immutable').type(asset.mediaType).send(await assetContents(asset));
});

app.get('/api/projects/:projectId/exports/:target/check', async (request, reply) => {
  const id = uuid(request.params.projectId);
  if (!await getProject(id)) return missing(reply, 'Project');
  const { pages, assets } = await projectExportData(id);
  return { target: request.params.target, pages: pages.map(page => ({ id: page.id, name: page.name, path: page.path })), issues: analyzeProjectExport(request.params.target, pages, assets) };
});
app.get('/api/projects/:projectId/exports/:target.zip', async (request, reply) => {
  const id = uuid(request.params.projectId);
  const project = await getProject(id);
  if (!project) return missing(reply, 'Project');
  const { pages, assets } = await projectExportData(id);
  const issues = analyzeProjectExport(request.params.target, pages, assets);
  if (issues.length) return reply.code(422).send({ error: 'Export has unsupported content', issues });
  const referenced = await projectExportAssets(id, referencedAssetIds(pages));
  const files = buildProjectFiles(request.params.target, pages, referenced);
  const archive = zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, typeof value === 'string' ? strToU8(value) : new Uint8Array(value)])), { level: 6 });
  const filename = `${project.name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'website'}-${request.params.target}.zip`;
  return reply.type('application/zip').header('Content-Disposition', `attachment; filename="${filename}"`).send(Buffer.from(archive));
});

if (process.env.NODE_ENV !== 'test') {
  try {
    if (process.env.NODE_ENV === 'production') {
      if (process.env.ASSET_STORE !== 's3') throw new Error('Production requires ASSET_STORE=s3');
      if (!process.env.PUBLIC_ORIGIN || new URL(process.env.PUBLIC_ORIGIN).protocol !== 'https:') throw new Error('Production requires an HTTPS PUBLIC_ORIGIN');
    }
    await migrate();
    await app.listen({ port: Number(process.env.API_PORT || 3001), host: process.env.API_HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1') });
    await drainAssetObjectDeletions();
    setInterval(() => drainAssetObjectDeletions().catch(error => app.log.error(error)), 60000).unref();
  } catch (error) {
    app.log.error(error);
    await app.close(); await pool.end();
    process.exitCode = 1;
  }
}

process.on('SIGTERM', async () => { await app.close(); await pool.end(); });
