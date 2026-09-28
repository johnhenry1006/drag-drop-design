import assert from 'node:assert/strict';
import test from 'node:test';
import { documentCss, parseDocument, samplePage, validateDocument } from '../src/index.js';

const copy = () => structuredClone(samplePage);

test('sample is JSON-safe and accepts direct and nested content in every region', () => {
  const page = copy();
  page.regions.header.push(page.regions.main.splice(1, 1)[0]);
  page.regions.footer.push(page.regions.main.splice(1, 1)[0]);
  assert.equal(validateDocument(page), page);
  assert.equal(parseDocument(JSON.stringify(page)).regions.header.length, 3);
});

test('rejects duplicate IDs across regions and non-JSON runtime data', () => {
  const duplicated = copy();
  duplicated.regions.footer[0].id = duplicated.regions.header[0].id;
  assert.throws(() => validateDocument(duplicated), /duplicate ID/);

  const withFunction = copy();
  withFunction.regions.header[0].props.label = () => 'runtime';
  assert.throws(() => validateDocument(withFunction), /JSON data/);

  const withDomLikeObject = copy();
  withDomLikeObject.regions.main[0].props.label = new Date();
  assert.throws(() => validateDocument(withDomLikeObject), /plain JSON object/);
});

test('desktop, tablet, and mobile node CSS stays scoped', () => {
  const page = copy();
  const heading = page.regions.main[2];
  heading.styles.tablet.fontSize = '32px';
  heading.styles.mobile.fontSize = '24px';
  validateDocument(page);
  const css = documentCss(page);
  assert.match(css, /\[data-node-id="work_heading"\]\{[^}]*text-align:center/);
  assert.match(css, /@media \(max-width: 900px\)\{\[data-node-id="work_heading"\]\{font-size:32px\}/);
  assert.match(css, /@media \(max-width: 600px\)\{\[data-node-id="work_heading"\]\{font-size:24px\}/);
  heading.styles.mobile.color = 'red};body{display:none';
  assert.throws(() => validateDocument(page), /invalid/);
});
