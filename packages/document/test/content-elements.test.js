import assert from 'node:assert/strict';
import test from 'node:test';
import { addNode, samplePage, updateNode, validateDocument } from '../src/index.js';
import { buildProjectFiles } from '../../exporters/src/project.js';
import { createPaletteNode, paletteItems } from '../../../apps/editor/src/palette.js';

test('Lists keep item IDs and text when reordered, and invalid structured props are rejected', () => {
  let page = structuredClone(samplePage);
  const list = createPaletteNode('Lists');
  assert.ok(paletteItems.some(item => item.key === 'Lists'));
  page = addNode(page, 'header', 0, list);
  const items = [{ id: 'item_a', text: 'Alpha' }, { id: 'item_b', text: 'Beta' }, { id: 'item_c', text: 'Gamma' }];
  page = updateNode(page, list.id, { props: { mode: 'ordered', items } });
  page = updateNode(page, list.id, { props: { items: [items[2], items[0], items[1]] }, styles: { mobile: { fontSize: '14px' } } });
  const saved = validateDocument(JSON.parse(JSON.stringify(page)));
  assert.deepEqual(saved.regions.header[0].props.items, [items[2], items[0], items[1]]);
  assert.match(buildProjectFiles('html', [{ id: 'page_list', name: 'List', path: '/', document: saved }])['index.html'], /<ol[^>]*><li>Gamma<\/li><li>Alpha<\/li><li>Beta<\/li><\/ol>/);
  assert.throws(() => updateNode(page, list.id, { props: { items: [items[0], items[0]] } }), /items is invalid/);
});

test('Table cells follow stable column IDs and exports escape plain text', () => {
  let page = structuredClone(samplePage);
  const table = createPaletteNode('Table');
  const tip = createPaletteNode('Tooltip');
  page = addNode(page, 'main', 0, table);
  page = addNode(page, 'footer', 0, tip);
  const columns = [{ id: 'col_name', label: 'Name' }, { id: 'col_value', label: 'Value' }];
  const rows = [{ id: 'row_a', cells: { col_name: '<script>alert(1)</script>', col_value: '42' } }];
  page = updateNode(page, table.id, { props: { caption: 'Results', columns, rows } });
  page = updateNode(page, table.id, { props: { columns: [columns[1], columns[0]] } });
  page = updateNode(page, tip.id, { props: { trigger: 'Help', content: '<img src=x onerror=alert(1)>', placement: 'bottom' } });
  assert.throws(() => updateNode(page, table.id, { props: { columns: [columns[0]] } }), /cells must match columns/);
  assert.deepEqual(page.regions.main[0].props.columns.map(column => column.label), ['Value', 'Name']);
  assert.equal(page.regions.main[0].props.rows[0].cells.col_name, '<script>alert(1)</script>');
  const pages = [{ id: 'page_table', name: 'Table', path: '/', document: page }];
  for (const target of ['html', 'react', 'vue']) {
    const files = buildProjectFiles(target, pages);
    const source = files[target === 'html' ? 'index.html' : target === 'react' ? 'src/pages.jsx' : 'src/pages.js'];
    assert.match(source, /Value/);
    assert.match(source, /42/);
    assert.match(source, /scope/);
    assert.ok(files[target === 'html' ? 'tooltip.js' : target === 'react' ? 'src/tooltip.jsx' : 'src/tooltip.js']);
    if (target === 'html') { assert.doesNotMatch(source, /<script>alert\(1\)<\/script>/); assert.match(source, /&lt;script&gt;/); }
  }
});
