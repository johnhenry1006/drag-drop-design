import assert from 'node:assert/strict';
import test from 'node:test';
import { findNode, registry, validateDocument } from '../src/index.js';
import { applyDrop } from '../../../apps/editor/src/drop.js';
import { createPaletteNode, paletteItems } from '../../../apps/editor/src/palette.js';

export const expansionTypes = ['Checkbox', 'Floating Action Button', 'Radio Group', 'Rating', 'Autocomplete', 'Slider', 'Switch', 'Transfer List', 'Toggle Button', 'Avatar', 'Badge', 'Chip', 'Icons', 'Lists', 'Table', 'Tooltip'];
const blank = () => ({ schemaVersion: 1, id: `page_${crypto.randomUUID().replaceAll('-', '')}`, type: 'Page', props: { title: 'Expansion regression' }, styles: { desktop: {}, tablet: {}, mobile: {} }, regions: { header: [], main: [], footer: [] } });

test('all 16 registered elements resolve palette drops in every region and nested containers', () => {
  for (const type of expansionTypes) {
    assert.ok(paletteItems.some(item => item.key === type && `${item.label} ${item.group}`.toLowerCase().includes(type.toLowerCase())), `${type} is searchable`);
    assert.deepEqual(registry[type].exports, ['html', 'react', 'vue']);
    assert.equal(registry[type].kind, 'element');
    let page = blank();
    for (const region of ['header', 'main', 'footer']) {
      const node = createPaletteNode(type);
      page = applyDrop(page, { kind: 'palette', node }, `canvas-region:${region}`, 'inside');
      assert.equal(findNode(page, node.id).region, region);
      assert.equal(findNode(page, node.id).parentId, null);
    }
    const outer = createPaletteNode('Container');
    const inner = createPaletteNode('Container');
    page = applyDrop(page, { kind: 'palette', node: outer }, 'canvas-region:main', 'inside');
    page = applyDrop(page, { kind: 'palette', node: inner }, `canvas-node:${outer.id}`, 'inside');
    const nested = createPaletteNode(type);
    nested.styles.mobile.opacity = '0.87';
    page = applyDrop(page, { kind: 'palette', node: nested }, `canvas-node:${inner.id}`, 'inside');
    assert.equal(findNode(page, nested.id).parentId, inner.id);
    assert.equal(findNode(page, nested.id).node.styles.mobile.opacity, '0.87');
    assert.equal(validateDocument(JSON.parse(JSON.stringify(page))).schemaVersion, 1);
  }
});
