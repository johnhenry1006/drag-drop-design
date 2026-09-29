import React, { useState } from 'react';
import { documentCss, iconPaths, regions, registry } from '@builder/document';
import { useDroppable } from '@dnd-kit/react';
import { pointerIntersection } from '@dnd-kit/collision';

const renderers = {
  container: (node, content, common) => React.createElement(registry[node.type].tag, common, content),
  layout: (node, content, common) => React.createElement('div', common, content),
  heading: (node, content, common) => React.createElement(`h${node.props.level || 2}`, common, node.props.text),
  text: (node, content, common) => React.createElement('p', common, node.props.text),
  image: (node, content, common) => React.createElement('img', { ...common, src: node.props.src, alt: node.props.alt }),
  button: (node, content, common) => React.createElement('a', { ...common, href: node.props.href }, node.props.text),
  avatar: (node, content, common) => <span {...common} className="builder-avatar" data-shape={node.props.shape} role="img" aria-label={node.props.alt || node.props.name} style={{ '--avatar-size': `${node.props.size}px` }}><span aria-hidden="true">{node.props.initials || node.props.name?.split(/\s+/).map(word => word[0]).slice(0, 2).join('').toUpperCase()}</span>{node.props.src && <img key={node.props.src} src={node.props.src} alt="" aria-hidden="true" onError={event => { event.currentTarget.hidden = true; }} />}</span>,
  badge: (node, content, common) => <span {...common} className="builder-badge" data-placement={node.props.placement} style={{ '--badge-color': node.props.color }}><span>{node.props.content}</span><span className="builder-badge-mark" aria-label={node.props.text || (node.props.maxCount > 0 && node.props.count > node.props.maxCount ? `${node.props.maxCount} plus` : String(node.props.count))}>{node.props.text || (node.props.maxCount > 0 && node.props.count > node.props.maxCount ? `${node.props.maxCount}+` : node.props.count)}</span></span>,
  chip: (node, content, common) => <span {...common} className="builder-chip">{node.props.icon && <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={iconPaths[node.props.icon]} /></svg>}<span>{node.props.label}</span></span>,
  icon: (node, content, common) => <svg {...common} className="builder-icon" viewBox="0 0 24 24" role="img" aria-label={node.props.name} style={{ '--icon-size': `${node.props.size}px`, '--icon-color': node.props.color }}><path d={iconPaths[node.props.icon]} /></svg>,
  list: (node, content, common) => React.createElement(node.props.mode === 'ordered' ? 'ol' : 'ul', { ...common, className: 'builder-list' }, node.props.items.map(item => <li key={item.id}>{item.text}</li>)),
  table: (node, content, common) => <div {...common} className="builder-table-scroll" role="region" aria-label={node.props.caption || 'Table'} tabIndex={0}><table>{node.props.caption && <caption>{node.props.caption}</caption>}<thead><tr>{node.props.columns.map(column => <th key={column.id} scope="col">{column.label}</th>)}</tr></thead><tbody>{node.props.rows.map(row => <tr key={row.id}>{node.props.columns.map(column => <td key={column.id}>{row.cells[column.id]}</td>)}</tr>)}</tbody></table></div>,
  tooltip: (node, content, common) => <TooltipNode node={node} common={common} />,
  checkbox: (node, content, common) => <ControlNode node={node} common={common} />,
  radio: (node, content, common) => <ControlNode node={node} common={common} />,
  switch: (node, content, common) => <ControlNode node={node} common={common} />,
  toggle: (node, content, common) => <ControlNode node={node} common={common} />
};

function ControlNode({ node, common }) {
  const p = node.props;
  const editing = Boolean(common.onClick);
  const [value, setValue] = useState(node.type === 'Radio Group' ? p.defaultValue : node.type === 'Toggle Button' ? p.defaultPressed : p.defaultChecked);
  const disabled = editing || p.disabled;
  if (node.type === 'Radio Group') return <fieldset {...common} className="builder-radio" disabled={!editing && p.disabled} data-disabled={p.disabled ? 'true' : undefined}><legend>{p.label}</legend>{p.options.map(option => <label key={option.id}><input type="radio" name={p.name} value={option.value} checked={(editing ? p.defaultValue : value) === option.value} required={p.required} disabled={disabled} onChange={() => setValue(option.value)} /><span>{option.label}</span></label>)}</fieldset>;
  if (node.type === 'Toggle Button') { const pressed = editing ? p.defaultPressed : value; return <span {...common} className="builder-toggle" data-pressed={pressed ? 'true' : 'false'} data-disabled={p.disabled ? 'true' : undefined}><button type="button" name={p.name} aria-pressed={pressed} disabled={disabled} onClick={() => setValue(current => !current)}>{p.label}</button></span>; }
  const checked = editing ? p.defaultChecked : value;
  return <span {...common} className={node.type === 'Switch' ? 'builder-switch' : 'builder-checkbox'} data-disabled={p.disabled ? 'true' : undefined}><label><input type="checkbox" role={node.type === 'Switch' ? 'switch' : undefined} name={p.name} checked={checked} required={p.required} disabled={disabled} onChange={event => setValue(event.target.checked)} /><span>{p.label}</span></label></span>;
}

function TooltipNode({ node, common }) {
  const [open, setOpen] = useState(false);
  const [touched, setTouched] = useState(false);
  const editing = Boolean(common.onClick);
  return <span {...common} className="builder-tooltip" data-placement={node.props.placement} data-open={open ? 'true' : undefined} data-touched={touched ? 'true' : undefined} data-edit={editing ? 'true' : undefined} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setTouched(false); } }}><button type="button" aria-describedby={`tip-${node.id}`} aria-expanded={open} onClick={event => { if (editing) { common.onClick(event); return; } setTouched(true); setOpen(value => !value); }} onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); setTouched(false); event.currentTarget.blur(); } }}>{node.props.trigger}</button><span id={`tip-${node.id}`} role="tooltip" className="builder-tooltip-content">{node.props.content}</span></span>;
}

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
    onKeyDown: onSelect ? event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.stopPropagation(); onSelect(node.id); } } : undefined,
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
