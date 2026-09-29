import assert from 'node:assert/strict';
import test from 'node:test';
import { addNode, findNode, updateNode, validateDocument } from '@builder/document';
import { createPaletteNode } from '../src/palette.js';
import { emptyHistory, recordChange, travel } from '../src/history.js';

const blank = () => ({ schemaVersion: 1, id: 'page_history', type: 'Page', props: { title: 'History' }, styles: { desktop: {}, tablet: {}, mobile: {} }, regions: { header: [], main: [], footer: [] } });

test('undo and redo restore tree and property snapshots, and a new edit clears redo', () => {
  const start = validateDocument(blank());
  const card = createPaletteNode('Card');
  const added = addNode(start, 'main', 0, card);
  const edited = updateNode(added, card.id, { props: { label: 'News card' }, styles: { mobile: { padding: '12px' } } });
  let history = recordChange(emptyHistory(), start, added);
  history = recordChange(history, added, edited);
  let step = travel(history, edited, 'undo');
  assert.equal(findNode(step.document, card.id).node.props.label, 'Card');
  step = travel(step.history, step.document, 'undo');
  assert.equal(step.document.regions.main.length, 0);
  step = travel(step.history, step.document, 'redo');
  assert.equal(findNode(step.document, card.id).node.type, 'Card');
  const branched = recordChange(step.history, step.document, updateNode(step.document, card.id, { props: { label: 'Another card' } }));
  assert.equal(travel(branched, step.document, 'redo'), null);
});
