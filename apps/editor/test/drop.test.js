import assert from 'node:assert/strict';
import test from 'node:test';
import { findNode, samplePage } from '@builder/document';
import { exportHtml, exportReact, exportVue } from '@builder/exporters';
import { applyDrop, resolveDrop } from '../src/drop.js';
import { createPaletteNode } from '../src/palette.js';

test('palette drops directly into all semantic regions and inside nested containers', () => {
  let page = structuredClone(samplePage);
  for (const region of ['header', 'main', 'footer']) {
    const node = createPaletteNode('Container');
    page = applyDrop(page, { kind: 'palette', node }, `canvas-region:${region}`, 'inside');
    assert.equal(findNode(page, node.id).parentId, null);
    assert.equal(findNode(page, node.id).region, region);
  }
  const nested = createPaletteNode('Text');
  page = applyDrop(page, { kind: 'palette', node: nested }, 'canvas-node:hero_copy', 'inside');
  assert.equal(findNode(page, nested.id).parentId, 'hero_copy');
});

test('before and after resolve final indices for a move within one parent', () => {
  const page = structuredClone(samplePage);
  const planned = resolveDrop(page, { kind: 'node', id: 'nav_work' }, 'layer-node:nav_contact', 'after');
  assert.deepEqual(planned, { parent: 'navigation', index: 2, placement: 'after' });
  const moved = applyDrop(page, { kind: 'node', id: 'nav_work' }, 'layer-node:nav_contact', 'after');
  assert.deepEqual(findNode(moved, 'nav_work'), { node: moved.regions.header[0].children[1].children[2], parentId: 'navigation', region: 'header', index: 2 });
});

test('invalid leaf and cyclic targets produce explicit errors without changing the source', () => {
  const page = structuredClone(samplePage);
  assert.throws(() => applyDrop(page, { kind: 'palette', node: createPaletteNode('Text') }, 'layer-node:nav_work', 'inside'), /cannot contain children/);
  assert.throws(() => applyDrop(page, { kind: 'node', id: 'hero' }, 'layer-node:hero_copy', 'inside'), /descendant/);
  assert.equal(findNode(page, 'hero').parentId, null);
});

test('new Navigation and Link nodes remain exportable from the updated Page JSON', () => {
  const navigation = createPaletteNode('Navigation');
  const link = createPaletteNode('Link');
  let page = applyDrop(samplePage, { kind: 'palette', node: navigation }, 'layer-region:header', 'inside');
  page = applyDrop(page, { kind: 'palette', node: link }, `layer-node:${navigation.id}`, 'inside');
  assert.match(exportHtml(page)['index.html'], new RegExp(`<nav class="n-${navigation.id}"><a class="n-${link.id}"`));
  assert.match(exportReact(page)['src/App.jsx'], /<nav className=/);
  assert.match(exportVue(page)['src/main.js'], /h\("nav"/);
});
