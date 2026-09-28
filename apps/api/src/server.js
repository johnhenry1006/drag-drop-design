import Fastify from 'fastify';
import { zipSync, strToU8 } from 'fflate';
import { samplePage } from '@builder/document';
import { analyzeProjectExport, buildProjectFiles } from '@builder/exporters/project';
import { checkDatabase, pool } from './db.js';
import { createAsset, createPage, createProject, getAsset, getPage, getProject, getRevision, listAssets, listPages, listProjects, listRevisions, migrate, projectExportData, restorePage, savePage, updateProject, validDocument } from './store.js';

export const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
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
app.addContentTypeParser(/^image\/(png|jpeg|gif|webp)$/, { parseAs: 'buffer', bodyLimit: 10 * 1024 * 1024 }, (request, body, done) => done(null, body));

app.get('/api/health', async () => ({ ok: true }));
app.get('/api/health/db', async () => ({ ok: await checkDatabase() }));
app.get('/api/sample-page', async () => validDocument(samplePage));

app.get('/api/projects', async () => ({ projects: await listProjects() }));
app.post('/api/projects', async (request, reply) => reply.code(201).send({ project: await createProject(request.body?.name) }));
app.get('/api/projects/:projectId', async (request, reply) => {
  const project = await getProject(uuid(request.params.projectId));
  return project ? { project } : missing(reply, 'Project');
});
app.patch('/api/projects/:projectId', async (request, reply) => {
  const project = await updateProject(uuid(request.params.projectId), request.body?.name);
  return project ? { project } : missing(reply, 'Project');
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
  let filename;
  try { filename = decodeURIComponent(String(request.headers['x-file-name'] || 'image')); }
  catch { return reply.code(400).send({ error: 'Invalid image filename' }); }
  if (!filename || filename.length > 255 || /[/\\\x00-\x1f]/.test(filename)) return reply.code(400).send({ error: 'Invalid image filename' });
  return reply.code(201).send({ asset: await createAsset(id, filename, mediaType, contents) });
});
app.get('/api/assets/:assetId', async (request, reply) => {
  const asset = await getAsset(uuid(request.params.assetId));
  if (!asset) return missing(reply, 'Asset');
  const { contents, ...metadata } = asset;
  return { asset: { ...metadata, url: `/api/assets/${asset.id}/content` } };
});
app.get('/api/assets/:assetId/content', async (request, reply) => {
  const asset = await getAsset(uuid(request.params.assetId));
  if (!asset) return missing(reply, 'Asset');
  return reply.header('Cache-Control', 'public, max-age=31536000, immutable').type(asset.mediaType).send(asset.contents);
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
  const files = buildProjectFiles(request.params.target, pages, assets);
  const archive = zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, typeof value === 'string' ? strToU8(value) : new Uint8Array(value)])), { level: 6 });
  const filename = `${project.name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'website'}-${request.params.target}.zip`;
  return reply.type('application/zip').header('Content-Disposition', `attachment; filename="${filename}"`).send(Buffer.from(archive));
});

if (process.env.NODE_ENV !== 'test') {
  try {
    await migrate();
    await app.listen({ port: Number(process.env.API_PORT || 3001), host: '127.0.0.1' });
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
  }
}

process.on('SIGTERM', async () => { await app.close(); await pool.end(); });
