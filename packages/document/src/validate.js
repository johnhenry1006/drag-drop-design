import { breakpoints, regions, registry } from './registry.js';
import { supportedStyles } from './style-support.js';
import { parseAdvancedCss } from './advanced-css.js';

const plain = value => value !== null && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const identifier = value => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(value);

function assertJson(value, path, seen) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return;
  if (typeof value !== 'object' || seen.has(value)) throw new Error(`${path} must contain only acyclic JSON data`);
  seen.add(value);
  if (Array.isArray(value)) value.forEach((item, index) => assertJson(item, `${path}[${index}]`, seen));
  else {
    if (!plain(value)) throw new Error(`${path} must be a plain JSON object`);
    for (const [key, item] of Object.entries(value)) assertJson(item, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

function validateStyles(styles, path) {
  if (!plain(styles) || Object.keys(styles).some(key => !breakpoints.includes(key))) throw new Error(`${path}.styles has invalid breakpoints`);
  for (const breakpoint of breakpoints) {
    const rules = styles[breakpoint];
    if (!plain(rules)) throw new Error(`${path}.styles.${breakpoint} must be an object`);
    for (const [name, value] of Object.entries(rules)) {
      if (!/^[a-z][a-zA-Z]*$/.test(name) || name.startsWith('on') || !['string', 'number'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value)) || (typeof value === 'string' && (value.length > 2048 || /[;{}<>\\]|\/\*|\*\/|(?:url|image-set|expression|var|env)\s*\(/i.test(value)))) {
        throw new Error(`${path}.styles.${breakpoint}.${name} is invalid`);
      }
      if (supportedStyles.has(name) && typeof value === 'string') {
        try { parseAdvancedCss(`${name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}:${value}`); }
        catch (error) { throw new Error(`${path}.styles.${breakpoint}.${name}: ${error.message}`, { cause: error }); }
      }
    }
  }
}

function validateAdvancedCss(value, path) {
  if (value === undefined) return;
  if (!plain(value) || Object.keys(value).some(key => !breakpoints.includes(key))) throw new Error(`${path}.advancedCss has invalid breakpoints`);
  for (const [breakpoint, declarations] of Object.entries(value)) {
    if (typeof declarations !== 'string' || !declarations.trim()) throw new Error(`${path}.advancedCss.${breakpoint} must contain declarations`);
    try { parseAdvancedCss(declarations); }
    catch (error) { throw new Error(`${path}.advancedCss.${breakpoint}: ${error.message}`, { cause: error }); }
  }
}

function validateNode(node, path, ids) {
  if (!plain(node) || !registry[node.type]) throw new Error(`${path} has an unknown node type`);
  if (!identifier(node.id) || regions.includes(node.id) || ids.has(node.id)) throw new Error(`${path} has an invalid or duplicate ID`);
  ids.add(node.id);
  if (Object.keys(node).some(key => !['id', 'type', 'props', 'styles', 'advancedCss', 'children'].includes(key))) throw new Error(`${path} has unsupported data`);
  if (!plain(node.props)) throw new Error(`${path}.props must be an object`);
  const unsupportedProp = Object.keys(node.props).find(key => !registry[node.type].editable.includes(key));
  if (unsupportedProp) throw new Error(`${path}.props has unsupported property ${unsupportedProp}`);
  for (const [key, value] of Object.entries(node.props)) {
    if (key === 'level' ? !Number.isInteger(value) || value < 1 || value > 6 : typeof value !== 'string') throw new Error(`${path}.props.${key} is invalid`);
    if (key === 'href' && value && !/^(#|\/|https?:\/\/|mailto:|tel:)/i.test(value)) throw new Error(`${path}.props.href has an unsupported URL`);
    if (key === 'src' && value && !/^(\/|https?:\/\/|data:image\/)/i.test(value)) throw new Error(`${path}.props.src has an unsupported URL`);
  }
  validateStyles(node.styles, path);
  validateAdvancedCss(node.advancedCss, path);
  if (registry[node.type].kind === 'container') {
    if (!Array.isArray(node.children)) throw new Error(`${path}.children must be an array`);
    node.children.forEach((child, index) => {
      if (!registry[node.type].children.includes(child?.type)) throw new Error(`${path}.children[${index}] is not allowed`);
      validateNode(child, `${path}.children[${index}]`, ids);
    });
  } else if ('children' in node) throw new Error(`${path} cannot have children`);
}

export function validateDocument(document) {
  assertJson(document, 'document', new Set());
  if (!plain(document) || document.schemaVersion !== 1 || document.type !== 'Page' || !identifier(document.id)) throw new Error('Unsupported Page document');
  if (Object.keys(document).some(key => !['schemaVersion', 'id', 'type', 'props', 'styles', 'regions'].includes(key))) throw new Error('Page has unsupported data');
  if (!plain(document.props) || typeof document.props.title !== 'string' || Object.keys(document.props).some(key => key !== 'title')) throw new Error('Page.props is invalid');
  validateStyles(document.styles, 'Page');
  if (!plain(document.regions) || Object.keys(document.regions).some(key => !regions.includes(key))) throw new Error('Page.regions is invalid');
  const ids = new Set([document.id]);
  for (const region of regions) {
    if (!Array.isArray(document.regions[region])) throw new Error(`Page.regions.${region} must be an array`);
    document.regions[region].forEach((node, index) => validateNode(node, `Page.regions.${region}[${index}]`, ids));
  }
  return document;
}

export function parseDocument(json) {
  return validateDocument(JSON.parse(json));
}
