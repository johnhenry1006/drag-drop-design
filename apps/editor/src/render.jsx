import React from 'react';
import { documentCss, regions, registry } from '@builder/document';

const renderers = {
  container: (node, content, common) => React.createElement(registry[node.type].tag, common, content),
  layout: (node, content, common) => React.createElement('div', common, content),
  heading: (node, content, common) => React.createElement(`h${node.props.level || 2}`, common, node.props.text),
  text: (node, content, common) => React.createElement('p', common, node.props.text),
  image: (node, content, common) => React.createElement('img', { ...common, src: node.props.src, alt: node.props.alt }),
  button: (node, content, common) => React.createElement('a', { ...common, href: node.props.href }, node.props.text)
};

function NodeView({ node, selectedId, onSelect }) {
  const content = node.children?.map(child => <NodeView key={child.id} node={child} selectedId={selectedId} onSelect={onSelect} />);
  const common = {
    'data-node-id': node.id,
    'data-selected': selectedId === node.id ? 'true' : undefined,
    onClick: onSelect ? event => { event.preventDefault(); event.stopPropagation(); onSelect(node.id); } : undefined
  };
  return renderers[registry[node.type].renderer](node, content, common);
}

export function PageView({ document, selectedId, onSelect }) {
  return <div className="page" data-node-id={document.id}>
    <style>{documentCss(document)}</style>
    {regions.map(region => React.createElement(region, { key: region, className: `page-region region-${region}` }, document.regions[region].map(node => <NodeView key={node.id} node={node} selectedId={selectedId} onSelect={onSelect} />)))}
  </div>;
}
