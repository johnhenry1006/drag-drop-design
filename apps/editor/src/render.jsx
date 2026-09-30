import React, { useState } from 'react';
import { documentCss, iconPaths, regions, registry, resolveLinkHref } from '@builder/document';
import { useDroppable } from '@dnd-kit/react';
import { pointerIntersection } from '@dnd-kit/collision';

const renderers = {
  container: (node, content, common) => React.createElement(registry[node.type].tag, common, content),
  layout: (node, content, common) => React.createElement('div', common, content),
  heading: (node, content, common) => React.createElement(`h${node.props.level || 2}`, common, node.props.text),
  text: (node, content, common) => React.createElement('p', common, node.props.text),
  image: (node, content, common) => React.createElement('img', { ...common, src: node.props.src, alt: node.props.alt }),
  button: (node, content, common) => {
    const { onNavigate, resolveHref, ...attributes } = common;
    const href = resolveHref(node);
    return <a {...attributes} href={href || undefined} aria-disabled={href === null ? true : undefined} onClick={event => { if (common.onClick) { common.onClick(event); return; } if (onNavigate && href?.startsWith('/')) { event.preventDefault(); onNavigate(href); } }}>{node.props.text}</a>;
  },
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
  toggle: (node, content, common) => <ControlNode node={node} common={common} />,
  rating: (node, content, common) => <RangeNode node={node} common={common} />,
  slider: (node, content, common) => <RangeNode node={node} common={common} />,
  autocomplete: (node, content, common) => <AutocompleteNode node={node} common={common} />,
  transfer: (node, content, common) => <TransferNode node={node} common={common} />,
  fab: (node, content, common) => <FabNode node={node} common={common} />
};

function FabNode({ node, common }) {
  const p = node.props;
  const editing = Boolean(common.onClick);
  const { onNavigate, resolveHref, ...domCommon } = common;
  const href = p.action === 'link' ? resolveHref(node) : null;
  const attributes = { ...domCommon, className: 'builder-fab', 'data-corner': p.corner, 'data-shape': p.shape, 'data-edit': editing ? 'true' : undefined, 'data-visible-desktop': String(p.visibleDesktop), 'data-visible-tablet': String(p.visibleTablet), 'data-visible-mobile': String(p.visibleMobile), 'aria-label': editing ? common['aria-label'] : p.label, title: p.label, style: { '--fab-offset': `${p.offset}px` } };
  const icon = <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={iconPaths[p.icon]} /></svg>;
  if (p.action === 'link') return <a {...attributes} href={href || undefined} aria-disabled={href === null ? true : undefined} rel={href?.startsWith('https://') ? 'noopener noreferrer' : undefined} onClick={event => { if (editing) { common.onClick(event); return; } if (onNavigate && href?.startsWith('/')) { event.preventDefault(); onNavigate(href); } }}>{icon}</a>;
  return <button {...attributes} type="button" onClick={event => { if (editing) { common.onClick(event); return; } const stage = event.currentTarget.closest('.preview-stage'); (stage || window).scrollTo({ top: 0, behavior: 'smooth' }); }}>{icon}</button>;
}

function TransferNode({ node, common }) {
  const p = node.props;
  const editing = Boolean(common.onClick);
  const [rightIds, setRightIds] = useState(p.defaultRightIds);
  const [picked, setPicked] = useState([]);
  const right = editing ? p.defaultRightIds : rightIds;
  const selected = editing ? [] : picked;
  const leftOptions = p.options.filter(option => !right.includes(option.id));
  const rightOptions = p.options.filter(option => right.includes(option.id));
  const toggle = id => setPicked(ids => ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id]);
  const move = direction => {
    const moving = (direction === 'right' ? leftOptions : rightOptions).filter(option => selected.includes(option.id)).map(option => option.id);
    setRightIds(ids => direction === 'right' ? [...ids, ...moving] : ids.filter(id => !moving.includes(id)));
    setPicked(ids => ids.filter(id => !moving.includes(id)));
  };
  const group = (options, label) => <fieldset className="builder-transfer-group" disabled={editing || p.disabled}><legend>{label} <span className="builder-transfer-count">({options.length} items, {options.filter(option => selected.includes(option.id)).length} selected)</span></legend><ul>{options.length ? options.map(option => <li key={option.id}><label><input type="checkbox" aria-label={`${option.label} · ${option.value}`} checked={selected.includes(option.id)} onChange={() => toggle(option.id)} /><span>{option.label}</span><small>{option.value}</small></label></li>) : <li className="builder-transfer-empty">No items</li>}</ul></fieldset>;
  return <div {...common} className="builder-transfer" role="group" aria-label={p.label} data-edit={editing ? 'true' : undefined} data-disabled={p.disabled ? 'true' : undefined}><div className="builder-transfer-layout">{group(leftOptions, p.leftLabel)}<div className="builder-transfer-actions"><button type="button" disabled={editing || p.disabled || !leftOptions.some(option => selected.includes(option.id))} onClick={() => move('right')}>Move right →</button><button type="button" disabled={editing || p.disabled || !rightOptions.some(option => selected.includes(option.id))} onClick={() => move('left')}>← Move left</button></div>{group(rightOptions, p.rightLabel)}</div></div>;
}

function AutocompleteNode({ node, common }) {
  const p = node.props;
  const editing = Boolean(common.onClick);
  const initial = p.options.find(option => option.id === p.defaultOptionId);
  const [query, setQuery] = useState(initial?.label || '');
  const [selectedId, setSelectedId] = useState(p.defaultOptionId);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const shown = editing ? initial?.label || '' : query;
  const filtered = p.options.filter(option => `${option.label} ${option.value}`.toLocaleLowerCase().includes(shown.toLocaleLowerCase()));
  const listId = `autocomplete-${node.id}-list`;
  const optionId = id => `autocomplete-${node.id}-${id}`;
  const choose = option => { setSelectedId(option.id); setQuery(option.label); setOpen(false); setActive(-1); };
  return <div {...common} className="builder-autocomplete" data-disabled={p.disabled ? 'true' : undefined} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setActive(-1); } }}>
    <label htmlFor={`autocomplete-${node.id}-input`}>{p.label}</label>
    <input id={`autocomplete-${node.id}-input`} type="text" role="combobox" name={p.name} placeholder={p.placeholder} value={shown} disabled={editing || p.disabled} style={editing ? { pointerEvents: 'none' } : undefined} required={p.required} aria-required={p.required} aria-autocomplete="list" aria-expanded={!editing && open} aria-controls={!editing && open ? listId : undefined} aria-activedescendant={!editing && open && active >= 0 ? optionId(filtered[active].id) : undefined} autoComplete="off" onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setSelectedId(''); setOpen(true); setActive(-1); }} onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); setActive(-1); event.preventDefault(); } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); if (filtered.length) setActive(index => event.key === 'ArrowDown' ? (index + 1) % filtered.length : (index < 0 ? filtered.length - 1 : (index - 1 + filtered.length) % filtered.length)); } else if (event.key === 'Enter' && open && active >= 0 && filtered[active]) { event.preventDefault(); choose(filtered[active]); } }} />
    {!editing && open && <div id={listId} role="listbox" aria-label={`${p.label} options`} className="builder-autocomplete-list">{filtered.length ? filtered.map((option, index) => <div key={option.id} id={optionId(option.id)} role="option" aria-selected={selectedId === option.id} data-active={active === index ? 'true' : undefined} onPointerDown={event => event.preventDefault()} onClick={() => choose(option)}><span>{option.label}</span><small>{option.value}</small></div>) : <div className="builder-autocomplete-empty" role="status">{p.options.length ? p.noResultsText : p.emptyText}</div>}</div>}
  </div>;
}

function RangeNode({ node, common }) {
  const p = node.props;
  const rating = node.type === 'Rating';
  const editing = Boolean(common.onClick);
  const [value, setValue] = useState(p.defaultValue);
  const current = editing ? p.defaultValue : value;
  const max = rating ? p.items : p.max;
  const score = `${current} out of ${p.items}`;
  return <div {...common} className={rating ? 'builder-rating' : 'builder-slider'} data-disabled={p.disabled ? 'true' : undefined}>
    <label><span>{p.label}</span><input type="range" name={p.name} min={rating ? 0 : p.min} max={max} step={p.step} value={current} disabled={editing || p.disabled} aria-valuetext={rating ? score : undefined} aria-readonly={rating && p.readOnly ? 'true' : undefined} onKeyDown={event => { if (rating && p.readOnly) event.preventDefault(); }} onChange={event => { if (rating && p.readOnly) { event.currentTarget.value = String(current); return; } setValue(Number(event.target.value)); }} /></label>
    {rating && <span className="builder-rating-stars" aria-hidden="true">{Array.from({ length: p.items }, (_, index) => <span key={index} data-filled={index < current ? 'true' : undefined}>★</span>)}</span>}
    <output aria-live="polite">{rating ? score : current}</output>
  </div>;
}

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

function NodeView({ node, selectedId, onSelect, dropTarget, depth, resolveHref }) {
  const { ref } = useDroppable({ id: `canvas-node:${node.id}`, accept: ['palette', 'tree-node'], collisionDetector: pointerIntersection, collisionPriority: depth + 2 });
  const content = node.children?.map(child => <NodeView key={child.id} node={child} selectedId={selectedId} onSelect={onSelect} dropTarget={dropTarget} depth={depth + 1} resolveHref={resolveHref} />);
  const common = {
    ref,
    id: node.id,
    ...(['Button', 'Link', 'Floating Action Button'].includes(node.type) ? { resolveHref } : {}),
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

function RegionView({ region, nodes, selectedId, onSelect, dropTarget, resolveHref }) {
  const { ref } = useDroppable({ id: `canvas-region:${region}`, accept: ['palette', 'tree-node'], collisionDetector: pointerIntersection, collisionPriority: 1 });
  return React.createElement(region, {
    ref,
    className: `page-region region-${region}`,
    'data-region': region,
    'data-drop': dropTarget?.targetId === `canvas-region:${region}` && dropTarget.valid ? 'inside' : undefined,
    'data-drop-invalid': dropTarget?.targetId === `canvas-region:${region}` && !dropTarget.valid ? 'true' : undefined
  }, nodes.map(node => <NodeView key={node.id} node={node} selectedId={selectedId} onSelect={onSelect} dropTarget={dropTarget} depth={0} resolveHref={resolveHref} />));
}

export function PageView({ document, pages = [], selectedId, onSelect, onNavigate, dropTarget, breakpoint = 'desktop', interactive = true }) {
  const resolveHref = node => resolveLinkHref(node, pages);
  return <div className="page" data-node-id={document.id} data-breakpoint={breakpoint}>
    <style>{documentCss(document, undefined, breakpoint)}</style>
    {interactive ? regions.map(region => <RegionView key={region} region={region} nodes={document.regions[region]} selectedId={selectedId} onSelect={onSelect} dropTarget={dropTarget} resolveHref={resolveHref} />) : regions.map(region => React.createElement(region, { key: region, className: `page-region region-${region}` }, document.regions[region].map(node => <StaticNodeView key={node.id} node={node} onNavigate={onNavigate} resolveHref={resolveHref} />)))}
  </div>;
}

function StaticNodeView({ node, onNavigate, resolveHref }) {
  const content = node.children?.map(child => <StaticNodeView key={child.id} node={child} onNavigate={onNavigate} resolveHref={resolveHref} />);
  return renderers[registry[node.type].renderer](node, content, { id: node.id, 'data-node-id': node.id, ...(['Button', 'Link', 'Floating Action Button'].includes(node.type) ? { onNavigate, resolveHref } : {}) });
}
