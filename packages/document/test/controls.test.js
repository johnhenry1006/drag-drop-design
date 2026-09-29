import assert from 'node:assert/strict';
import test from 'node:test';
import { addNode, samplePage, updateNode, validateDocument } from '../src/index.js';
import { buildProjectFiles } from '../../exporters/src/project.js';
import { createPaletteNode, paletteItems } from '../../../apps/editor/src/palette.js';

test('four controls remain JSON leaves with stable field names and validated initial state', () => {
  let page = structuredClone(samplePage);
  const controls = ['Checkbox', 'Radio Group', 'Switch', 'Toggle Button'].map(createPaletteNode);
  for (const node of controls) {
    assert.ok(paletteItems.some(item => item.key === node.type));
    assert.equal(node.children, undefined);
    page = addNode(page, 'main', 0, node);
  }
  assert.equal(new Set(controls.map(node => node.props.name)).size, 4);
  assert.equal(validateDocument(JSON.parse(JSON.stringify(page))).regions.main[0].type, 'Toggle Button');
  const radio = controls[1];
  const duplicate = radio.props.options.map(option => ({ ...option, value: 'same' }));
  assert.throws(() => updateNode(page, radio.id, { props: { options: duplicate } }), /options is invalid/);
  assert.throws(() => updateNode(page, radio.id, { props: { defaultValue: 'absent' } }), /must match an option/);
  assert.throws(() => updateNode(page, controls[0].id, { props: { defaultChecked: 'yes' } }), /defaultChecked is invalid/);
  assert.throws(() => updateNode(page, controls[3].id, { props: { required: true } }), /unsupported property required/);
  assert.throws(() => updateNode(page, controls[0].id, { props: { name: controls[2].props.name } }), /duplicates another field/);
});

test('all exports retain initial flags, native radio markup, local runtime, and escaped labels', () => {
  let page = structuredClone(samplePage);
  const checkbox = createPaletteNode('Checkbox');
  checkbox.props.label = '<Accept & continue>';
  checkbox.props.defaultChecked = true;
  checkbox.props.required = true;
  const radio = createPaletteNode('Radio Group');
  radio.props.defaultValue = radio.props.options[1].value;
  radio.props.disabled = true;
  const sw = createPaletteNode('Switch');
  sw.props.disabled = true;
  sw.props.required = true;
  const toggle = createPaletteNode('Toggle Button');
  toggle.props.defaultPressed = true;
  toggle.props.disabled = true;
  for (const node of [checkbox, radio, sw, toggle]) page = addNode(page, 'footer', page.regions.footer.length, node);
  const pages = [{ id: 'page_controls', name: 'Controls', path: '/', document: page }];
  for (const target of ['html', 'react', 'vue']) {
    const files = buildProjectFiles(target, pages);
    const source = files[target === 'html' ? 'index.html' : target === 'react' ? 'src/pages.jsx' : 'src/pages.js'];
    assert.match(source, /<Accept & continue>|&lt;Accept &amp; continue&gt;/);
    assert.match(source, /RadioControl|<fieldset|h\('RadioControl/);
    assert.ok(files[target === 'html' ? 'controls.js' : target === 'react' ? 'src/controls.jsx' : 'src/controls.js']);
    assert.match(files[target === 'html' ? 'styles.css' : 'src/styles.css'], /builder-toggle:where\(\[data-pressed/);
    if (target === 'html') {
      assert.match(source, /checked required/);
      assert.match(source, /aria-pressed="true" disabled/);
      assert.match(source, /<fieldset[^>]* disabled/);
      assert.match(source, /role="switch"[^>]*disabled/);
      assert.doesNotMatch(source, /<Accept & continue>/);
    }
  }
});
