import assert from 'node:assert/strict';
import test from 'node:test';
import { addNode, samplePage, updateNode, validateDocument } from '../src/index.js';
import { buildProjectFiles } from '../../exporters/src/project.js';
import { createPaletteNode, paletteItems } from '../../../apps/editor/src/palette.js';

test('Transfer List validates unique IDs and values, right-side references, and empty options', () => {
  let page = structuredClone(samplePage);
  const node = createPaletteNode('Transfer List');
  assert.ok(paletteItems.some(item => item.key === 'Transfer List' && item.group === 'Forms'));
  assert.equal(node.children, undefined);
  page = addNode(page, 'main', 0, node);
  const [first, second] = node.props.options;
  page = updateNode(page, node.id, { props: { options: [{ ...first, label: 'Same' }, { ...second, label: 'Same' }], defaultRightIds: [second.id] } });
  assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(page))).regions.main[0].props.defaultRightIds, [second.id]);
  assert.equal(updateNode(page, node.id, { props: { options: [], defaultRightIds: [] } }).regions.main[0].props.options.length, 0);
  assert.throws(() => updateNode(page, node.id, { props: { options: [{ ...first }, { ...first }] } }), /options is invalid/);
  assert.throws(() => updateNode(page, node.id, { props: { options: [{ ...first }, { ...second, value: first.value }] } }), /options is invalid/);
  assert.throws(() => updateNode(page, node.id, { props: { defaultRightIds: [first.id, first.id] } }), /defaultRightIds is invalid/);
  assert.throws(() => updateNode(page, node.id, { props: { defaultRightIds: ['missing'] } }), /must reference existing option IDs/);
  assert.throws(() => updateNode(page, node.id, { props: { options: [] } }), /must reference existing option IDs/);
});

test('Transfer List exports escape labels and bundle local behavior in all three targets', () => {
  let page = structuredClone(samplePage);
  const node = createPaletteNode('Transfer List');
  node.props.label = 'Pick <items> & more';
  node.props.options[0].label = 'Same "label"';
  node.props.options[1].label = 'Same "label"';
  node.props.defaultRightIds = [node.props.options[1].id];
  node.styles.mobile.width = '320px';
  page = addNode(page, 'footer', 0, node);
  const pages = [{ id: 'page_transfer', name: 'Transfer', path: '/', document: page }];
  for (const target of ['html', 'react', 'vue']) {
    const files = buildProjectFiles(target, pages);
    const source = files[target === 'html' ? 'index.html' : target === 'react' ? 'src/pages.jsx' : 'src/pages.js'];
    assert.match(source, /TransferControl|builder-transfer/);
    assert.match(files[target === 'html' ? 'styles.css' : 'src/styles.css'], /@container\(max-width:550px\)/);
    assert.match(files[target === 'html' ? 'transfer.js' : target === 'react' ? 'src/transfer.jsx' : 'src/transfer.js'], /Move right|data-move/);
    if (target === 'html') {
      assert.match(source, /Pick &lt;items&gt; &amp; more/);
      assert.match(source, /Same &quot;label&quot;/);
      assert.doesNotMatch(source, /Pick <items>/);
      assert.match(files['build.js'], /transfer\.js/);
    }
  }
});
