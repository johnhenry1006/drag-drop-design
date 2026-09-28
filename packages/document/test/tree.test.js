import assert from 'node:assert/strict';
import test from 'node:test';
import { addNode, findNode, getAncestors, moveNode, removeNode, reorderNode, samplePage, updateNode } from '../src/index.js';

const emptyStyles = () => ({ desktop: {}, tablet: {}, mobile: {} });
const textNode = id => ({ id, type: 'Text', props: { text: id }, styles: emptyStyles() });

test('moves a direct node into a nested container at the requested index without changing the input', () => {
  const original = structuredClone(samplePage);
  const moved = moveNode(original, 'work_label', 'hero_copy', 1);
  assert.deepEqual(getAncestors(moved, 'work_label'), ['hero', 'hero_inner', 'hero_copy']);
  assert.deepEqual(findNode(moved, 'work_label'), { node: moved.regions.main[0].children[0].children[0].children[1], parentId: 'hero_copy', region: 'main', index: 1 });
  assert.equal(findNode(original, 'work_label').parentId, null);
  assert.equal(original.regions.main[1].id, 'work_label');
});

test('rejects a cycle and preserves both source and destination', () => {
  const original = structuredClone(samplePage);
  assert.throws(() => moveNode(original, 'hero', 'hero_copy', 0), /own descendant/);
  assert.throws(() => moveNode(original, 'hero', 'hero', 0), /own descendant/);
  assert.equal(findNode(original, 'hero').region, 'main');
  assert.equal(findNode(original, 'hero_copy').parentId, 'hero_inner');
});

test('supports direct content in all regions, nested containers, update, reorder, and remove', () => {
  let page = structuredClone(samplePage);
  page = addNode(page, 'header', 0, textNode('header_note'));
  page = addNode(page, 'main', page.regions.main.length, textNode('main_note'));
  page = addNode(page, 'footer_brand', 1, textNode('footer_note'));
  assert.equal(findNode(page, 'footer_note').parentId, 'footer_brand');
  page = updateNode(page, 'footer_note', { props: { text: 'Editable footer' }, styles: { mobile: { color: '#fff' } } });
  assert.equal(findNode(page, 'footer_note').node.props.text, 'Editable footer');
  page = reorderNode(page, 'header_note', 2);
  assert.equal(findNode(page, 'header_note').index, 2);
  page = removeNode(page, 'main_note');
  assert.equal(findNode(page, 'main_note'), null);
});

test('rejects duplicate IDs and children on leaf elements', () => {
  assert.throws(() => addNode(samplePage, 'footer', 0, textNode('brand')), /duplicate ID/);
  assert.throws(() => addNode(samplePage, 'brand', 0, textNode('inside_heading')), /cannot contain children/);
  const invalid = { ...textNode('invalid_text'), children: [textNode('child')] };
  assert.throws(() => addNode(samplePage, 'main', 0, invalid), /cannot have children/);
});
