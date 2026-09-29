import { breakpoints, regions, registry } from './registry.js';
import { supportedStyles } from './style-support.js';
import { parseAdvancedCss } from './advanced-css.js';
import { iconIds } from './icons.js';

const plain = value => value !== null && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const identifier = value => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(value);
const newTypes = new Set(['Avatar', 'Badge', 'Chip', 'Icons', 'Lists', 'Table', 'Tooltip', 'Checkbox', 'Radio Group', 'Switch', 'Toggle Button', 'Rating', 'Slider', 'Autocomplete', 'Transfer List', 'Floating Action Button']);
const controlTypes = new Set(['Checkbox', 'Radio Group', 'Switch', 'Toggle Button', 'Rating', 'Slider', 'Autocomplete']);
const stringField = (value, max = 200) => typeof value === 'string' && value.length <= max;
const integerField = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const colorField = value => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
const exactKeys = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const uniqueIds = values => values.every(plain) && new Set(values.map(value => value.id)).size === values.length;
const validItems = value => Array.isArray(value) && value.length <= 100 && uniqueIds(value) && value.every(item => exactKeys(item, ['id', 'text']) && identifier(item.id) && stringField(item.text, 1000));
const validColumns = value => Array.isArray(value) && value.length >= 1 && value.length <= 20 && uniqueIds(value) && value.every(column => exactKeys(column, ['id', 'label']) && identifier(column.id) && stringField(column.label, 200) && column.label.trim());
const validRows = value => Array.isArray(value) && value.length <= 100 && uniqueIds(value) && value.every(row => exactKeys(row, ['id', 'cells']) && identifier(row.id) && plain(row.cells) && Object.values(row.cells).every(cell => stringField(cell, 1000)));
const validOptions = value => Array.isArray(value) && value.length >= 1 && value.length <= 50 && uniqueIds(value) && value.every(option => exactKeys(option, ['id', 'label', 'value']) && identifier(option.id) && stringField(option.label, 200) && option.label.trim() && stringField(option.value, 100) && option.value.trim()) && new Set(value.map(option => option.value)).size === value.length;
const validAutocompleteOptions = value => Array.isArray(value) && value.length <= 100 && uniqueIds(value) && value.every(option => exactKeys(option, ['id', 'label', 'value']) && identifier(option.id) && stringField(option.label, 200) && option.label.trim() && stringField(option.value, 100) && option.value.trim());
const validTransferOptions = value => validAutocompleteOptions(value) && new Set(value.map(option => option.value)).size === value.length;
const finiteNumber = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1000000;
const aligned = (value, min, step) => Math.abs((value - min) / step - Math.round((value - min) / step)) < 1e-8;
export const safeFabHref = value => {
  if (!stringField(value, 2048) || /[\s<>"'`\\]/.test(value)) return false;
  if (/^\/(?!\/)[A-Za-z0-9/_?&=.%+-]*$/.test(value)) return true;
  if (!value.startsWith('https://')) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !url.hostname.endsWith('.localhost'); }
  catch { return false; }
};

function validNewProp(type, key, value) {
  if (type === 'Avatar') {
    if (key === 'size') return integerField(value, 16, 256);
    if (key === 'shape') return ['circle', 'square', 'rounded'].includes(value);
    if (key === 'src') return stringField(value, 2048) && (!value || /^(\/|https?:\/\/|data:image\/)/i.test(value));
    return stringField(value, key === 'alt' ? 500 : 100);
  }
  if (type === 'Badge') {
    if (key === 'count' || key === 'maxCount') return integerField(value, 0, 99999);
    if (key === 'color') return colorField(value);
    if (key === 'placement') return ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'].includes(value);
    return stringField(value, 200);
  }
  if (type === 'Chip') return key === 'icon' ? value === '' || iconIds.includes(value) : stringField(value, 200);
  if (type === 'Icons') {
    if (key === 'icon') return iconIds.includes(value);
    if (key === 'size') return integerField(value, 12, 256);
    if (key === 'color') return colorField(value);
    return stringField(value, 100);
  }
  if (type === 'Lists') return key === 'mode' ? ['ordered', 'unordered'].includes(value) : validItems(value);
  if (type === 'Table') {
    if (key === 'caption') return stringField(value, 300);
    return key === 'columns' ? validColumns(value) : validRows(value);
  }
  if (type === 'Tooltip') return key === 'placement' ? ['top', 'bottom', 'left', 'right'].includes(value) : stringField(value, 500) && Boolean(value.trim());
  if (type === 'Autocomplete') {
    if (key === 'name') return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value);
    if (key === 'options') return validAutocompleteOptions(value);
    if (key === 'required' || key === 'disabled') return typeof value === 'boolean';
    if (key === 'defaultOptionId') return value === '' || identifier(value);
    return stringField(value, 200) && (key === 'placeholder' || Boolean(value.trim()));
  }
  if (type === 'Transfer List') {
    if (key === 'options') return validTransferOptions(value);
    if (key === 'defaultRightIds') return Array.isArray(value) && value.length <= 100 && value.every(identifier) && new Set(value).size === value.length;
    if (key === 'disabled') return typeof value === 'boolean';
    return stringField(value, 200) && Boolean(value.trim());
  }
  if (type === 'Floating Action Button') {
    if (key === 'icon') return iconIds.includes(value);
    if (key === 'label') return stringField(value, 200) && Boolean(value.trim());
    if (key === 'action') return ['scrollTop', 'link'].includes(value);
    if (key === 'href') return value === '' || safeFabHref(value);
    if (key === 'corner') return ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'].includes(value);
    if (key === 'offset') return integerField(value, 16, 120);
    if (key === 'shape') return ['circle', 'rounded', 'square'].includes(value);
    if (key.startsWith('visible')) return typeof value === 'boolean';
    return false;
  }
  if (type === 'Rating' || type === 'Slider') {
    if (key === 'name') return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value);
    if (key === 'label') return stringField(value, 200) && Boolean(value.trim());
    if (key === 'disabled' || key === 'readOnly') return typeof value === 'boolean';
    if (key === 'items') return integerField(value, 1, 20);
    if (key === 'step') return type === 'Rating' ? integerField(value, 1, 20) : finiteNumber(value) && value > 0;
    if (key === 'min' || key === 'max' || key === 'defaultValue') return finiteNumber(value);
    return false;
  }
  if (controlTypes.has(type)) {
    if (key === 'name') return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value);
    if (key === 'label') return stringField(value, 200) && Boolean(value.trim());
    if (key === 'disabled' || key === 'required' || key === 'defaultChecked' || key === 'defaultPressed') return typeof value === 'boolean';
    if (key === 'options') return validOptions(value);
    if (key === 'defaultValue') return stringField(value, 100) && Boolean(value.trim());
  }
  return false;
}

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

function validateNode(node, path, ids, fieldNames) {
  if (!plain(node) || !registry[node.type]) throw new Error(`${path} has an unknown node type`);
  if (!identifier(node.id) || regions.includes(node.id) || ids.has(node.id)) throw new Error(`${path} has an invalid or duplicate ID`);
  ids.add(node.id);
  if (Object.keys(node).some(key => !['id', 'type', 'props', 'styles', 'advancedCss', 'children'].includes(key))) throw new Error(`${path} has unsupported data`);
  if (!plain(node.props)) throw new Error(`${path}.props must be an object`);
  const unsupportedProp = Object.keys(node.props).find(key => !registry[node.type].editable.includes(key));
  if (unsupportedProp) throw new Error(`${path}.props has unsupported property ${unsupportedProp}`);
  if (newTypes.has(node.type)) {
    const missingProp = registry[node.type].editable.find(key => !Object.hasOwn(node.props, key));
    if (missingProp) throw new Error(`${path}.props.${missingProp} is required`);
  }
  for (const [key, value] of Object.entries(node.props)) {
    if (newTypes.has(node.type) ? !validNewProp(node.type, key, value) : key === 'level' ? !Number.isInteger(value) || value < 1 || value > 6 : typeof value !== 'string') throw new Error(`${path}.props.${key} is invalid`);
    if (key === 'href' && value && !/^(#|\/|https?:\/\/|mailto:|tel:)/i.test(value)) throw new Error(`${path}.props.href has an unsupported URL`);
    if (key === 'src' && value && !/^(\/|https?:\/\/|data:image\/)/i.test(value)) throw new Error(`${path}.props.src has an unsupported URL`);
  }
  if (node.type === 'Avatar' && !node.props.name?.trim() && !node.props.alt?.trim()) throw new Error(`${path}.props needs an accessible name`);
  if (node.type === 'Icons' && !node.props.name?.trim()) throw new Error(`${path}.props.name needs an accessible name`);
  if (node.type === 'Badge' && !node.props.content?.trim()) throw new Error(`${path}.props.content needs anchor text`);
  if (node.type === 'Chip' && !node.props.label?.trim()) throw new Error(`${path}.props.label is required`);
  if (node.type === 'Table') {
    const columnIds = node.props.columns.map(column => column.id);
    for (const [index, row] of node.props.rows.entries()) {
      if (Object.keys(row.cells).length !== columnIds.length || columnIds.some(id => !Object.hasOwn(row.cells, id))) throw new Error(`${path}.props.rows[${index}].cells must match columns`);
    }
  }
  if (node.type === 'Radio Group' && !node.props.options.some(option => option.value === node.props.defaultValue)) throw new Error(`${path}.props.defaultValue must match an option`);
  if (node.type === 'Autocomplete' && node.props.defaultOptionId && !node.props.options.some(option => option.id === node.props.defaultOptionId)) throw new Error(`${path}.props.defaultOptionId must match an option ID`);
  if (node.type === 'Transfer List' && node.props.defaultRightIds.some(id => !node.props.options.some(option => option.id === id))) throw new Error(`${path}.props.defaultRightIds must reference existing option IDs`);
  if (node.type === 'Floating Action Button' && (node.props.action === 'link' ? !safeFabHref(node.props.href) : node.props.href !== '')) throw new Error(`${path}.props.href must match the selected action`);
  if (node.type === 'Rating' && (node.props.step > node.props.items || node.props.items % node.props.step !== 0 || node.props.defaultValue < 0 || node.props.defaultValue > node.props.items || !aligned(node.props.defaultValue, 0, node.props.step))) throw new Error(`${path}.props rating score must be within 0..items and aligned to step`);
  if (node.type === 'Slider' && (node.props.min > node.props.max || node.props.defaultValue < node.props.min || node.props.defaultValue > node.props.max || !aligned(node.props.defaultValue, node.props.min, node.props.step))) throw new Error(`${path}.props slider range or initial value is invalid`);
  if (controlTypes.has(node.type)) {
    if (fieldNames.has(node.props.name)) throw new Error(`${path}.props.name duplicates another field`);
    fieldNames.add(node.props.name);
  }
  validateStyles(node.styles, path);
  validateAdvancedCss(node.advancedCss, path);
  if (registry[node.type].kind === 'container') {
    if (!Array.isArray(node.children)) throw new Error(`${path}.children must be an array`);
    node.children.forEach((child, index) => {
      if (!registry[node.type].children.includes(child?.type)) throw new Error(`${path}.children[${index}] is not allowed`);
      validateNode(child, `${path}.children[${index}]`, ids, fieldNames);
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
  const fieldNames = new Set();
  for (const region of regions) {
    if (!Array.isArray(document.regions[region])) throw new Error(`Page.regions.${region} must be an array`);
    document.regions[region].forEach((node, index) => validateNode(node, `Page.regions.${region}[${index}]`, ids, fieldNames));
  }
  return document;
}

export function parseDocument(json) {
  return validateDocument(JSON.parse(json));
}
