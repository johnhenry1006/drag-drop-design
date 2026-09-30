import assert from 'node:assert/strict';
import test from 'node:test';
import { paletteGroups, searchPaletteItems } from '../src/palette.js';
import { paletteGroupsStorageKey, readCollapsedPaletteGroups, writeCollapsedPaletteGroups } from '../src/palette-preferences.js';

test('palette search uses registry names and keywords without exposing unrelated rows', () => {
  assert.deepEqual(searchPaletteItems('  headline ').map(item => item.key), ['Heading']);
  assert.deepEqual(searchPaletteItems('wrapper').map(item => item.key), ['Container']);
  assert.deepEqual(searchPaletteItems('typeahead').map(item => item.key), ['Autocomplete']);
  assert.deepEqual(searchPaletteItems('container title'), []);
  assert.deepEqual(searchPaletteItems(' '), searchPaletteItems(''));
});

test('palette preferences preserve unknown group choices and safely ignore bad storage', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  assert.deepEqual([...readCollapsedPaletteGroups(storage)], []);
  assert.equal(writeCollapsedPaletteGroups(new Set(['Basic', 'Future group']), storage), true);
  const collapsed = readCollapsedPaletteGroups(storage);
  assert.deepEqual([...collapsed], ['Basic', 'Future group']);
  assert.equal(paletteGroups.filter(group => !collapsed.has(group)).includes('Layout'), true);
  values.set(paletteGroupsStorageKey, '{invalid');
  assert.deepEqual([...readCollapsedPaletteGroups(storage)], []);
  values.set(paletteGroupsStorageKey, JSON.stringify({ collapsed: ['Basic', 4, '', 'Layout'] }));
  assert.deepEqual([...readCollapsedPaletteGroups(storage)], ['Basic', 'Layout']);
  const unavailable = { getItem: () => { throw new Error('disabled'); }, setItem: () => { throw new Error('disabled'); } };
  assert.deepEqual([...readCollapsedPaletteGroups(unavailable)], []);
  assert.equal(writeCollapsedPaletteGroups(new Set(['Basic']), unavailable), false);
});
