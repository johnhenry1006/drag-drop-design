import React from 'react';
import { documentCss, regions, registry } from '@builder/document';
import { useDroppable } from '@dnd-kit/react';
import { pointerIntersection } from '@dnd-kit/collision';

const renderers = {
  container: (node, content, common) => React.createElement(registry[node.type].tag, common, content),
  layout: (node, content, common) => React.createElement('div', common, content),
  heading: (node, content, common) => React.createElement(`h${node.props.level || 2}`, common, node.props.text),
  text: (node, content, common) => React.createElement('p', common, node.props.text),
  image: (node, content, common) => React.createElement('img', { ...common, src: node.props.src, alt: node.props.alt }),
  button: (node, content, common) => React.createElement('a', { ...common, href: node.props.href }, node.props.text)
};

function NodeView({ node, selectedId, onSelect, dropTarget, depth }) {
  const { ref } = useDroppable({ id: `canvas-node:${node.id}`, accept: ['palette', 'tree-node'], collisionDetector: pointerIntersection, collisionPriority: depth + 2 });
  const content = node.children?.map(child => <NodeView key={child.id} node={child} selectedId={selectedId} onSelect={onSelect} dropTarget={dropTarget} depth={depth + 1} />);
  const common = {
    ref,
    'data-node-id': node.id,
    'data-selected': selectedId === node.id ? 'true' : undefined,
    'data-drop': dropTarget?.targetId === `canvas-node:${node.id}` && dropTarget.valid ? dropTarget.placement : undefined,
    'data-drop-invalid': dropTarget?.targetId === `canvas-node:${node.id}` && !dropTarget.valid ? 'true' : undefined,
    'data-empty': node.children?.length === 0 ? 'true' : undefined,
    tabIndex: onSelect ? 0 : undefined,
    'aria-label': onSelect ? `Select ${node.type}: ${node.props.label || node.props.text || node.type}` : undefined,
    onKeyDown: onSelect ? event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onSelect(node.id); } } : undefined,
    onClick: onSelect ? event => { event.preventDefault(); event.stopPropagation(); onSelect(node.id); } : undefined
  };
  return renderers[registry[node.type].renderer](node, content, common);
}

function RegionView({ region, nodes, selectedId, onSelect, dropTarget }) {
  const { ref } = useDroppable({ id: `canvas-region:${region}`, accept: ['palette', 'tree-node'], collisionDetector: pointerIntersection, collisionPriority: 1 });
  return React.createElement(region, {
    ref,
    className: `page-region region-${region}`,
    'data-region': region,
    'data-drop': dropTarget?.targetId === `canvas-region:${region}` && dropTarget.valid ? 'inside' : undefined,
    'data-drop-invalid': dropTarget?.targetId === `canvas-region:${region}` && !dropTarget.valid ? 'true' : undefined
  }, nodes.map(node => <NodeView key={node.id} node={node} selectedId={selectedId} onSelect={onSelect} dropTarget={dropTarget} depth={0} />));
}

export function PageView({ document, selectedId, onSelect, dropTarget, breakpoint = 'desktop', interactive = true }) {
  return <div className="page" data-node-id={document.id} data-breakpoint={breakpoint}>
    <style>{documentCss(document, undefined, breakpoint)}</style>
    {interactive ? regions.map(region => <RegionView key={region} region={region} nodes={document.regions[region]} selectedId={selectedId} onSelect={onSelect} dropTarget={dropTarget} />) : regions.map(region => React.createElement(region, { key: region, className: `page-region region-${region}` }, document.regions[region].map(node => <StaticNodeView key={node.id} node={node} />)))}
  </div>;
}

function StaticNodeView({ node }) {
  const content = node.children?.map(child => <StaticNodeView key={child.id} node={child} />);
  return renderers[registry[node.type].renderer](node, content, { 'data-node-id': node.id });
}
