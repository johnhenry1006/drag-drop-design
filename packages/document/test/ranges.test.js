import assert from 'node:assert/strict';
import test from 'node:test';
import { addNode, samplePage, updateNode, validateDocument } from '../src/index.js';
import { buildProjectFiles } from '../../exporters/src/project.js';
import { createPaletteNode, paletteItems } from '../../../apps/editor/src/palette.js';

test('Rating and Slider validate boundaries, steps, names, and JSON persistence', () => {
  let page = structuredClone(samplePage);
  const rating = createPaletteNode('Rating');
  const slider = createPaletteNode('Slider');
  assert.ok(paletteItems.some(item => item.key === 'Rating'));
  assert.ok(paletteItems.some(item => item.key === 'Slider'));
  page = addNode(page, 'header', 0, rating);
  page = addNode(page, 'main', 0, slider);
  assert.equal(validateDocument(JSON.parse(JSON.stringify(page))).regions.main[0].id, slider.id);
  assert.equal(updateNode(page, rating.id, { props: { defaultValue: 0 } }).regions.header[0].props.defaultValue, 0);
  assert.equal(updateNode(page, slider.id, { props: { defaultValue: 100 } }).regions.main[0].props.defaultValue, 100);
  assert.equal(updateNode(page, rating.id, { props: { items: 6, step: 2, defaultValue: 4 } }).regions.header[0].props.items, 6);
  assert.equal(updateNode(page, slider.id, { props: { min: 0.1, max: 0.5, step: 0.1, defaultValue: 0.3 } }).regions.main[0].props.defaultValue, 0.3);
  assert.equal(updateNode(page, slider.id, { props: { min: 5, max: 5, defaultValue: 5 } }).regions.main[0].props.max, 5);
  for (const value of [NaN, Infinity, -Infinity, 101]) assert.throws(() => updateNode(page, slider.id, { props: { defaultValue: value } }));
  assert.throws(() => updateNode(page, slider.id, { props: { min: 101 } }), /range/);
  assert.throws(() => updateNode(page, slider.id, { props: { step: 0 } }), /step/);
  assert.throws(() => updateNode(page, slider.id, { props: { defaultValue: 50.5 } }), /range/);
  assert.throws(() => updateNode(page, rating.id, { props: { items: 0 } }), /items/);
  assert.throws(() => updateNode(page, rating.id, { props: { defaultValue: 6 } }), /rating score/);
  assert.throws(() => updateNode(page, rating.id, { props: { step: 2 } }), /rating score/);
  assert.throws(() => updateNode(page, slider.id, { props: { name: rating.props.name } }), /duplicates/);
});

test('three project exports include local runtime and responsive node styles', () => {
  let page = structuredClone(samplePage);
  const rating = createPaletteNode('Rating');
  rating.props.label = 'Score <now> & later';
  rating.props.readOnly = true;
  rating.styles.mobile.width = '220px';
  const slider = createPaletteNode('Slider');
  slider.props.min = -10;
  slider.props.max = 10;
  slider.props.defaultValue = 0;
  slider.props.step = 2;
  page = addNode(page, 'main', 0, rating);
  page = addNode(page, 'footer', 0, slider);
  for (const target of ['html', 'react', 'vue']) {
    const files = buildProjectFiles(target, [{ id: 'page_ranges', name: 'Ranges', path: '/', document: page }]);
    const source = files[target === 'html' ? 'index.html' : target === 'react' ? 'src/pages.jsx' : 'src/pages.js'];
    assert.match(source, /RatingControl|builder-rating/);
    assert.match(source, /SliderControl|builder-slider/);
    assert.match(files[target === 'html' ? 'styles.css' : 'src/styles.css'], new RegExp(`n-${rating.id}`));
    assert.match(files[target === 'html' ? 'controls.js' : target === 'react' ? 'src/controls.jsx' : 'src/controls.js'], /aria-valuetext/);
    if (target === 'html') {
      assert.match(source, /Score &lt;now&gt; &amp; later/);
      assert.match(source, /aria-readonly="true"/);
    }
  }
});
