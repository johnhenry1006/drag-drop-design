import { regions, registry } from './registry.js';
import { validateDocument } from './validate.js';

function locate(document, id) {
  function search(nodes, region, ancestors, parentId) {
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index];
      if (node.id === id) return { node, parentId, region, index, ancestors, siblings: nodes };
      if (node.children) {
        const found = search(node.children, region, [...ancestors, node.id], node.id);
        if (found) return found;
      }
    }
    return null;
  }
  for (const region of regions) {
    const found = search(document.regions[region], region, [], null);
    if (found) return found;
  }
  return null;
}

function destination(document, parent) {
  if (regions.includes(parent)) return { siblings: document.regions[parent], region: parent };
  const found = locate(document, parent);
  if (!found) throw new Error(`Destination ${parent} does not exist`);
  if (registry[found.node.type].kind !== 'container') throw new Error(`Destination ${parent} cannot contain children`);
  return { siblings: found.node.children, region: found.region };
}

function checkIndex(index, length) {
  if (!Number.isInteger(index) || index < 0 || index > length) throw new RangeError(`Index ${index} is outside 0..${length}`);
}

export function findNode(document, id) {
  validateDocument(document);
  const found = locate(document, id);
  if (!found) return null;
  const { node, parentId, region, index } = found;
  return { node, parentId, region, index };
}

export function getAncestors(document, id) {
  validateDocument(document);
  const found = locate(document, id);
  if (!found) throw new Error(`Node ${id} does not exist`);
  return [...found.ancestors];
}

export function addNode(document, parent, index, node) {
  validateDocument(document);
  const next = structuredClone(document);
  const { siblings } = destination(next, parent);
  checkIndex(index, siblings.length);
  siblings.splice(index, 0, structuredClone(node));
  return validateDocument(next);
}

export function removeNode(document, id) {
  validateDocument(document);
  const next = structuredClone(document);
  const found = locate(next, id);
  if (!found) throw new Error(`Node ${id} does not exist`);
  found.siblings.splice(found.index, 1);
  return validateDocument(next);
}

export function updateNode(document, id, patch) {
  validateDocument(document);
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !['props', 'styles', 'advancedCss'].includes(key))) {
    throw new Error('updateNode accepts only props, styles, and advancedCss');
  }
  const next = structuredClone(document);
  const found = locate(next, id);
  if (!found) throw new Error(`Node ${id} does not exist`);
  if (patch.props) found.node.props = { ...found.node.props, ...patch.props };
  if (patch.styles) {
    found.node.styles = { ...found.node.styles };
    for (const [breakpoint, values] of Object.entries(patch.styles)) {
      const merged = { ...found.node.styles[breakpoint], ...values };
      for (const [name, value] of Object.entries(values)) if (value === null) delete merged[name];
      found.node.styles[breakpoint] = merged;
    }
  }
  if (patch.advancedCss) {
    const merged = { ...found.node.advancedCss, ...patch.advancedCss };
    for (const [breakpoint, value] of Object.entries(patch.advancedCss)) if (value === null) delete merged[breakpoint];
    if (Object.keys(merged).length) found.node.advancedCss = merged;
    else delete found.node.advancedCss;
  }
  return validateDocument(next);
}

export function moveNode(document, id, parent, index) {
  validateDocument(document);
  const source = locate(document, id);
  if (!source) throw new Error(`Node ${id} does not exist`);
  if (parent === id || (!regions.includes(parent) && getAncestors(document, parent).includes(id))) {
    throw new Error(`Cannot move ${id} into its own descendant`);
  }
  const next = structuredClone(document);
  const moving = locate(next, id);
  moving.siblings.splice(moving.index, 1);
  const { siblings } = destination(next, parent);
  checkIndex(index, siblings.length);
  siblings.splice(index, 0, moving.node);
  return validateDocument(next);
}

export function reorderNode(document, id, index) {
  validateDocument(document);
  const found = locate(document, id);
  if (!found) throw new Error(`Node ${id} does not exist`);
  return moveNode(document, id, found.parentId || found.region, index);
}
