import assert from 'node:assert/strict';
import test from 'node:test';
import { addNode, samplePage, updateNode, validateDocument } from '../src/index.js';
import { buildProjectFiles } from '../../exporters/src/project.js';
import { createPaletteNode, paletteItems } from '../../../apps/editor/src/palette.js';

test('Autocomplete keeps stable option IDs, permits duplicate labels and an empty list, and validates selection', () => {
  let page = structuredClone(samplePage);
  const node = createPaletteNode('Autocomplete');
  assert.ok(paletteItems.some(item => item.key === 'Autocomplete' && item.group === 'Forms'));
  assert.equal(node.children, undefined);
  page = addNode(page, 'main', 0, node);
  const [first, second] = node.props.options;
  const options = [{ ...first, label: 'Same' }, { ...second, label: 'Same' }];
  page = updateNode(page, node.id, { props: { options, defaultOptionId: second.id } });
  assert.equal(validateDocument(JSON.parse(JSON.stringify(page))).regions.main[0].props.defaultOptionId, second.id);
  assert.equal(updateNode(page, node.id, { props: { options: [], defaultOptionId: '' } }).regions.main[0].props.options.length, 0);
  assert.throws(() => updateNode(page, node.id, { props: { options: [{ ...first }, { ...first }] } }), /options is invalid/);
  assert.throws(() => updateNode(page, node.id, { props: { defaultOptionId: 'missing' } }), /must match an option ID/);
  assert.throws(() => updateNode(page, node.id, { props: { options: [] } }), /must match an option ID/);
  assert.throws(() => updateNode(page, node.id, { props: { emptyText: '' } }), /emptyText is invalid/);
  assert.throws(() => updateNode(page, node.id, { props: { required: 'yes' } }), /required is invalid/);
});

test('Autocomplete export escapes configured text and includes local runtime in all three targets', () => {
  let page = structuredClone(samplePage);
  const node = createPaletteNode('Autocomplete');
  node.props.label = 'Fruit <choice> & more';
  node.props.options[0].label = 'A "fruit"';
  node.props.defaultOptionId = node.props.options[0].id;
  node.styles.mobile.width = '240px';
  page = addNode(page, 'footer', 0, node);
  const pages = [{ id: 'page_autocomplete', name: 'Autocomplete', path: '/', document: page }];
  for (const target of ['html', 'react', 'vue']) {
    const files = buildProjectFiles(target, pages);
    const source = files[target === 'html' ? 'index.html' : target === 'react' ? 'src/pages.jsx' : 'src/pages.js'];
    assert.match(source, /AutocompleteControl|builder-autocomplete/);
    assert.match(files[target === 'html' ? 'styles.css' : 'src/styles.css'], /builder-autocomplete/);
    assert.match(files[target === 'html' ? 'autocomplete.js' : target === 'react' ? 'src/autocomplete.jsx' : 'src/autocomplete.js'], /aria-activedescendant/);
    if (target === 'html') {
      assert.match(source, /Fruit &lt;choice&gt; &amp; more/);
      assert.match(source, /A &quot;fruit&quot;/);
      assert.doesNotMatch(source, /Fruit <choice>/);
      assert.match(files['build.js'], /autocomplete\.js/);
    }
  }
});
