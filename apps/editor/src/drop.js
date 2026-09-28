import { addNode, findNode, getAncestors, moveNode, regions, registry } from '@builder/document';

export function placementFromPointer(target, pointerY, bounds) {
  if (target.startsWith('canvas-region:') || target.startsWith('layer-region:')) return 'inside';
  if (!bounds || !Number.isFinite(pointerY)) return 'inside';
  const ratio = (pointerY - bounds.top) / Math.max(bounds.height, 1);
  if (ratio < 0.25) return 'before';
  if (ratio > 0.75) return 'after';
  return 'inside';
}

export function resolveDrop(document, source, targetId, placement) {
  if (!targetId) throw new Error('Drop onto a region or node');
  const [surfaceKind, target] = targetId.split(':');
  const [surface, kind] = surfaceKind.split('-');
  if (!['canvas', 'layer'].includes(surface)) throw new Error('Unknown drop surface');
  let parent;
  let index;
  if (kind === 'region') {
    if (!regions.includes(target)) throw new Error(`Unknown region ${target}`);
    parent = target;
    index = document.regions[target].length;
    placement = 'inside';
  } else if (kind === 'node') {
    const location = findNode(document, target);
    if (!location) throw new Error(`Node ${target} does not exist`);
    if (placement === 'inside') {
      if (registry[location.node.type].kind !== 'container') throw new Error(`${location.node.type} cannot contain children; drop before or after it`);
      parent = target;
      index = location.node.children.length;
    } else if (placement === 'before' || placement === 'after') {
      parent = location.parentId || location.region;
      index = location.index + (placement === 'after' ? 1 : 0);
    } else throw new Error(`Unknown placement ${placement}`);
  } else throw new Error('Unknown drop target');

  if (source.kind === 'node') {
    if (source.id === parent || (!regions.includes(parent) && getAncestors(document, parent).includes(source.id))) throw new Error('Cannot move a node into itself or its descendant');
    const origin = findNode(document, source.id);
    if (!origin) throw new Error(`Node ${source.id} does not exist`);
    if ((origin.parentId || origin.region) === parent && origin.index < index) index -= 1;
  }
  return { parent, index, placement };
}

export function applyDrop(document, source, targetId, placement) {
  const { parent, index } = resolveDrop(document, source, targetId, placement);
  return source.kind === 'palette' ? addNode(document, parent, index, source.node) : moveNode(document, source.id, parent, index);
}
