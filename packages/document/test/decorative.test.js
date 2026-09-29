import assert from 'node:assert/strict';
import test from 'node:test';
import { addNode, registry, samplePage, updateNode, validateDocument } from '../src/index.js';
import { buildProjectFiles, analyzeProjectExport, referencedAssetIds } from '../../exporters/src/project.js';
import { createPaletteNode, paletteItems } from '../../../apps/editor/src/palette.js';

const assetId = '00000000-0000-4000-8000-000000000123';
const assetUrl = `/api/assets/${assetId}/content`;
const asset = { id: assetId, mediaType: 'image/png', contents: Buffer.from('image bytes') };

test('four palette types remain valid JSON leaves in regions and nested containers', () => {
  let page = structuredClone(samplePage);
  const locations = [['Avatar', 'header'], ['Badge', 'main'], ['Chip', 'footer'], ['Icons', 'hero_inner']];
  for (const [type, parent] of locations) {
    assert.ok(paletteItems.some(item => item.key === type));
    const node = createPaletteNode(type);
    assert.equal(node.type, type);
    assert.equal(registry[type].kind, 'element');
    assert.equal(node.children, undefined);
    assert.match(node.id, /^node_/);
    page = addNode(page, parent, 0, node);
  }
  assert.equal(validateDocument(JSON.parse(JSON.stringify(page))).regions.header[0].type, 'Avatar');
  assert.equal(new Set(locations.map(([, parent]) => parent)).size, 4);
  assert.throws(() => updateNode(page, page.regions.footer[0].id, { props: { icon: '<svg>' } }), /icon is invalid/);
  assert.throws(() => updateNode(page, page.regions.header[0].id, { props: { size: 5000 } }), /size is invalid/);
});

test('Avatar assets are bundled once and all targets retain fallback, labels, and responsive CSS', () => {
  let page = structuredClone(samplePage);
  for (const region of ['header', 'main', 'footer']) {
    const node = createPaletteNode('Avatar');
    node.props.src = assetUrl;
    node.props.name = 'Ada Lovelace';
    node.props.alt = 'Ada portrait';
    node.props.initials = 'AL';
    node.styles.mobile.width = '36px';
    page = addNode(page, region, 0, node);
  }
  const badge = createPaletteNode('Badge');
  badge.props.count = 101;
  badge.props.maxCount = 99;
  page = addNode(page, 'main', 0, badge);
  page = addNode(page, 'main', 1, createPaletteNode('Chip'));
  page = addNode(page, 'main', 2, createPaletteNode('Icons'));
  const pages = [{ id: 'page_decorative', name: 'Decorative', path: '/', document: page }];
  assert.deepEqual(referencedAssetIds(pages), [assetId]);
  for (const target of ['html', 'react', 'vue']) {
    assert.deepEqual(analyzeProjectExport(target, pages, [asset]), []);
    const files = buildProjectFiles(target, pages, [asset]);
    const assetName = `${target === 'html' ? '' : 'public/'}assets/${assetId}.png`;
    assert.deepEqual(files[assetName], asset.contents);
    assert.equal(Object.keys(files).filter(name => name === assetName).length, 1);
    const source = files[target === 'html' ? 'index.html' : target === 'react' ? 'src/pages.jsx' : 'src/pages.js'];
    assert.match(source, /Ada portrait/);
    assert.match(source, /AL/);
    assert.match(source, /99\+/);
    assert.doesNotMatch(source, /\/api\/assets\/|localhost/);
    assert.match(files[target === 'html' ? 'styles.css' : 'src/styles.css'], /36px/);
  }
  const missing = analyzeProjectExport('html', pages, []);
  assert.ok(missing.some(issue => issue.nodeId === page.regions.header[0].id && /missing/.test(issue.message)));
});
