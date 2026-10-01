import { randomUUID } from 'node:crypto';
import { linkNode, validateDocument } from '@builder/document';

const newNodeId = prefix => `${prefix}_${randomUUID().replaceAll('-', '')}`;
const assetPattern = /^\/api\/assets\/([0-9a-f-]{36})\/content$/i;
const internalRoute = href => typeof href === 'string' && href.startsWith('/') && !href.startsWith('//') ? href.split(/[?#]/, 1)[0] : null;
const anchorPart = href => href.includes('#') ? href.slice(href.indexOf('#') + 1) : '';
const visitNodes = (document, visit) => {
  const walk = node => { visit(node); node.children?.forEach(walk); };
  for (const region of ['header', 'main', 'footer']) document.regions[region].forEach(walk);
};

export function templateDependencies(page, samples) {
  const byId = new Map(samples.map(sample => [sample.id, sample]));
  const byPath = new Map(samples.map(sample => [sample.path, sample]));
  const required = new Set();
  visitNodes(page.document, node => {
    if (!linkNode(node)) return;
    const target = byId.get(node.props.targetPageId) || byPath.get(internalRoute(node.props.href));
    if (target && target.id !== page.id) required.add(target.id);
  });
  return [...required];
}

export function cloneTemplateDocument(source, context) {
  const { pageIds, paths, samplesById, samplesByPath, destinationPaths, assetIds, nodeIdsByPage } = context;
  const document = structuredClone(source.document);
  const nodeIds = nodeIdsByPage.get(source.id);
  document.id = newNodeId('page');
  visitNodes(document, node => {
    node.id = nodeIds.get(node.id);
    if (node.type === 'Lists') for (const item of node.props.items) item.id = newNodeId('item');
    if (node.type === 'Table') {
      const columns = new Map(node.props.columns.map(column => [column.id, newNodeId('column')]));
      for (const column of node.props.columns) column.id = columns.get(column.id);
      for (const row of node.props.rows) {
        row.id = newNodeId('row');
        row.cells = Object.fromEntries(Object.entries(row.cells).map(([id, value]) => [columns.get(id), value]));
      }
    }
    if (['Radio Group', 'Autocomplete', 'Transfer List'].includes(node.type)) {
      const options = new Map(node.props.options.map(option => [option.id, newNodeId('option')]));
      for (const option of node.props.options) option.id = options.get(option.id);
      if (node.type === 'Autocomplete' && node.props.defaultOptionId) node.props.defaultOptionId = options.get(node.props.defaultOptionId);
      if (node.type === 'Transfer List') node.props.defaultRightIds = node.props.defaultRightIds.map(id => options.get(id));
    }
    if ((node.type === 'Image' || node.type === 'Avatar') && assetPattern.test(node.props.src)) {
      const id = assetPattern.exec(node.props.src)[1].toLowerCase();
      if (!assetIds.has(id)) throw new Error(`Template asset ${id} is unavailable for copying`);
      node.props.src = `/api/assets/${assetIds.get(id)}/content`;
    }
  });
  const unresolved = [];
  visitNodes(document, node => {
    if (!linkNode(node)) return;
    const targetId = node.props.targetPageId;
    if (targetId) {
      if (!pageIds.has(targetId)) { unresolved.push(samplesById.get(targetId)?.name || targetId); return; }
      node.props.targetPageId = pageIds.get(targetId);
      if (node.props.anchor) node.props.anchor = nodeIdsByPage.get(targetId)?.get(node.props.anchor) || node.props.anchor;
      return;
    }
    const href = node.props.href;
    const route = internalRoute(href);
    if (route) {
      const target = samplesByPath.get(route);
      if (target && !paths.has(target.id)) { unresolved.push(target.name); return; }
      if (!target && !destinationPaths.has(route)) { unresolved.push(route); return; }
      const mapped = target ? paths.get(target.id) : route;
      const suffix = href.slice(route.length);
      const oldAnchor = anchorPart(href);
      const newAnchor = target && oldAnchor ? nodeIdsByPage.get(target.id)?.get(oldAnchor) : null;
      node.props.href = newAnchor ? `${mapped}${suffix.slice(0, suffix.indexOf('#') + 1)}${newAnchor}` : `${mapped}${suffix}`;
    } else if (href?.startsWith('#')) {
      node.props.href = `#${nodeIds.get(href.slice(1)) || href.slice(1)}`;
    }
  });
  if (unresolved.length) throw Object.assign(new Error(`Copy these linked sample pages too, or fix the links: ${[...new Set(unresolved)].join(', ')}`), { statusCode: 409, missingTemplates: [...new Set(unresolved)] });
  return validateDocument(document);
}

export function nodeIdMap(document) {
  const ids = new Map();
  visitNodes(document, node => ids.set(node.id, newNodeId('node')));
  return ids;
}

export function referencedTemplateAssetIds(pages) {
  const ids = new Set();
  for (const page of pages) visitNodes(page.document, node => {
    if ((node.type === 'Image' || node.type === 'Avatar') && assetPattern.test(node.props.src)) ids.add(assetPattern.exec(node.props.src)[1].toLowerCase());
  });
  return [...ids];
}
