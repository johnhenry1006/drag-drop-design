import React, { useEffect, useState } from 'react';
import { findNode, getAncestors, iconIds, parseAdvancedCss, registry, safeFabHref } from '@builder/document';

const labelFor = node => node.props.label || node.props.text || node.type;
const boxSides = ['Top', 'Right', 'Bottom', 'Left'];

function inheritedValue(node, breakpoint, property) {
  if (breakpoint === 'mobile' && node.styles.tablet[property] !== undefined) return node.styles.tablet[property];
  if (breakpoint !== 'desktop' && node.styles.desktop[property] !== undefined) return node.styles.desktop[property];
  return '';
}

function StyleInput({ node, breakpoint, property, label, onChange, placeholder }) {
  const value = node.styles[breakpoint][property] ?? '';
  const inherited = inheritedValue(node, breakpoint, property);
  return <label className="field" data-style-field={property}><span>{label || property}</span><input value={value} placeholder={placeholder || (inherited ? `Inherits ${inherited}` : 'No override')} onChange={event => onChange(node.id, { styles: { [breakpoint]: { [property]: event.target.value || null } } })} /></label>;
}

function StyleSelect({ node, breakpoint, property, label, values, onChange }) {
  const value = node.styles[breakpoint][property] ?? '';
  return <label className="field" data-style-field={property}><span>{label || property}</span><select value={value} onChange={event => onChange(node.id, { styles: { [breakpoint]: { [property]: event.target.value || null } } })}><option value="">Inherit / default</option>{values.map(item => <option key={item} value={item}>{item}</option>)}</select></label>;
}

function BoxModel({ node, breakpoint, onChange }) {
  return <div className="box-model"><div className="box-margin"><strong>Margin · outside</strong><div className="box-fields">{boxSides.map(side => <StyleInput key={`margin${side}`} node={node} breakpoint={breakpoint} property={`margin${side}`} label={side} onChange={onChange} />)}</div>
    <div className="box-padding"><strong>Padding · inside</strong><div className="box-fields">{boxSides.map(side => <StyleInput key={`padding${side}`} node={node} breakpoint={breakpoint} property={`padding${side}`} label={side} onChange={onChange} />)}</div></div>
  </div></div>;
}

const structuredId = prefix => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
const swap = (values, index, nextIndex) => {
  const copy = [...values];
  [copy[index], copy[nextIndex]] = [copy[nextIndex], copy[index]];
  return copy;
};

function ListFields({ node, onChange }) {
  const { items } = node.props;
  const setItems = next => onChange(node.id, { props: { items: next } });
  return <><label className="field"><span>List mode</span><select value={node.props.mode} onChange={event => onChange(node.id, { props: { mode: event.target.value } })}><option value="unordered">Unordered</option><option value="ordered">Ordered</option></select></label><h3>Items</h3>
    {items.map((item, index) => <div className="structured-row" key={item.id}><label className="field"><span>Item {index + 1}</span><input value={item.text} onChange={event => setItems(items.map(current => current.id === item.id ? { ...current, text: event.target.value } : current))} /></label><div className="order-actions"><button aria-label={`Move item ${index + 1} up`} disabled={index === 0} onClick={() => setItems(swap(items, index, index - 1))}>↑</button><button aria-label={`Move item ${index + 1} down`} disabled={index === items.length - 1} onClick={() => setItems(swap(items, index, index + 1))}>↓</button><button aria-label={`Remove item ${index + 1}`} onClick={() => setItems(items.filter(current => current.id !== item.id))}>Remove</button></div></div>)}
    <button onClick={() => setItems([...items, { id: structuredId('item'), text: 'New item' }])} disabled={items.length >= 100}>Add item</button></>;
}

function TableFields({ node, onChange }) {
  const { columns, rows } = node.props;
  const set = patch => onChange(node.id, { props: patch });
  const addColumn = () => { const id = structuredId('col'); set({ columns: [...columns, { id, label: 'New column' }], rows: rows.map(row => ({ ...row, cells: { ...row.cells, [id]: '' } })) }); };
  const removeColumn = id => set({ columns: columns.filter(column => column.id !== id), rows: rows.map(row => { const cells = { ...row.cells }; delete cells[id]; return { ...row, cells }; }) });
  const addRow = () => set({ rows: [...rows, { id: structuredId('row'), cells: Object.fromEntries(columns.map(column => [column.id, ''])) }] });
  return <><label className="field"><span>Caption (optional)</span><input value={node.props.caption} onChange={event => set({ caption: event.target.value })} /></label><h3>Columns</h3>
    {columns.map((column, index) => <div className="structured-row" key={column.id}><label className="field"><span>Column {index + 1} header</span><input defaultValue={column.label} onBlur={event => { if (event.target.value.trim()) set({ columns: columns.map(current => current.id === column.id ? { ...current, label: event.target.value } : current) }); else event.target.value = column.label; }} /></label><div className="order-actions"><button aria-label={`Move column ${index + 1} left`} disabled={index === 0} onClick={() => set({ columns: swap(columns, index, index - 1) })}>←</button><button aria-label={`Move column ${index + 1} right`} disabled={index === columns.length - 1} onClick={() => set({ columns: swap(columns, index, index + 1) })}>→</button><button aria-label={`Remove column ${index + 1}`} disabled={columns.length === 1} onClick={() => removeColumn(column.id)}>Remove</button></div></div>)}
    <button onClick={addColumn} disabled={columns.length >= 20}>Add column</button><h3>Rows</h3>
    {rows.map((row, rowIndex) => <div className="structured-row" key={row.id}><strong>Row {rowIndex + 1}</strong>{columns.map(column => <label className="field" key={column.id}><span>{column.label}</span><input value={row.cells[column.id]} onChange={event => set({ rows: rows.map(current => current.id === row.id ? { ...current, cells: { ...current.cells, [column.id]: event.target.value } } : current) })} /></label>)}<div className="order-actions"><button aria-label={`Move row ${rowIndex + 1} up`} disabled={rowIndex === 0} onClick={() => set({ rows: swap(rows, rowIndex, rowIndex - 1) })}>↑</button><button aria-label={`Move row ${rowIndex + 1} down`} disabled={rowIndex === rows.length - 1} onClick={() => set({ rows: swap(rows, rowIndex, rowIndex + 1) })}>↓</button><button aria-label={`Remove row ${rowIndex + 1}`} onClick={() => set({ rows: rows.filter(current => current.id !== row.id) })}>Remove</button></div></div>)}
    <button onClick={addRow} disabled={rows.length >= 100}>Add row</button></>;
}

function ControlFields({ node, onChange }) {
  const props = node.props;
  const set = patch => onChange(node.id, { props: patch });
  const commit = (key, value, valid = Boolean(value.trim())) => { if (valid) set({ [key]: value }); };
  const optionChange = (optionId, patch) => set({ options: props.options.map(option => option.id === optionId ? { ...option, ...patch } : option) });
  return <><label className="field"><span>Field name</span><input key={`${node.id}-name-${props.name}`} defaultValue={props.name} onBlur={event => { const value = event.target.value; if (/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)) commit('name', value); else event.target.value = props.name; }} /></label>
    <label className="field"><span>Accessible label</span><input key={`${node.id}-label-${props.label}`} defaultValue={props.label} onBlur={event => { if (event.target.value.trim()) commit('label', event.target.value); else event.target.value = props.label; }} /></label>
    <label className="field"><span><input type="checkbox" checked={props.disabled} onChange={event => set({ disabled: event.target.checked })} /> Disabled</span></label>
    {Object.hasOwn(props, 'required') && <label className="field"><span><input type="checkbox" checked={props.required} onChange={event => set({ required: event.target.checked })} /> Required if placed in a form</span></label>}
    {Object.hasOwn(props, 'defaultChecked') && <label className="field"><span><input type="checkbox" checked={props.defaultChecked} onChange={event => set({ defaultChecked: event.target.checked })} /> Initially {node.type === 'Switch' ? 'on' : 'checked'}</span></label>}
    {Object.hasOwn(props, 'defaultPressed') && <label className="field"><span><input type="checkbox" checked={props.defaultPressed} onChange={event => set({ defaultPressed: event.target.checked })} /> Initially pressed</span></label>}
    {node.type === 'Radio Group' && <><h3>Options</h3>{props.options.map((option, index) => <div className="structured-row" key={option.id}><label className="field"><span>Option {index + 1} ID</span><input key={`${option.id}-id`} defaultValue={option.id} onBlur={event => { const value = event.target.value; if (/^[A-Za-z][A-Za-z0-9_-]*$/.test(value) && !props.options.some(other => other.id !== option.id && other.id === value)) optionChange(option.id, { id: value }); else event.target.value = option.id; }} /></label><label className="field"><span>Option {index + 1} label</span><input key={`${option.id}-label-${option.label}`} defaultValue={option.label} onBlur={event => { if (event.target.value.trim()) optionChange(option.id, { label: event.target.value }); else event.target.value = option.label; }} /></label><label className="field"><span>Option {index + 1} value</span><input key={`${option.id}-value-${option.value}`} defaultValue={option.value} onBlur={event => { const value = event.target.value; if (value.trim() && !props.options.some(other => other.id !== option.id && other.value === value)) set({ options: props.options.map(current => current.id === option.id ? { ...current, value } : current), ...(props.defaultValue === option.value ? { defaultValue: value } : {}) }); else event.target.value = option.value; }} /></label><div className="order-actions"><button aria-label={`Move option ${index + 1} up`} disabled={index === 0} onClick={() => set({ options: swap(props.options, index, index - 1) })}>↑</button><button aria-label={`Move option ${index + 1} down`} disabled={index === props.options.length - 1} onClick={() => set({ options: swap(props.options, index, index + 1) })}>↓</button><button aria-label={`Remove option ${index + 1}`} disabled={props.options.length === 1} onClick={() => { const options = props.options.filter(current => current.id !== option.id); set({ options, defaultValue: props.defaultValue === option.value ? options[0].value : props.defaultValue }); }}>Remove</button></div></div>)}<button disabled={props.options.length >= 50} onClick={() => { const id = structuredId('option'); set({ options: [...props.options, { id, label: 'New choice', value: id }] }); }}>Add option</button><label className="field"><span>Initially selected</span><select value={props.defaultValue} onChange={event => set({ defaultValue: event.target.value })}>{props.options.map(option => <option key={option.id} value={option.value}>{option.label}</option>)}</select></label></>}
    <p className="property-note">Preview and exports keep changes in local runtime state. No form submission or API action is configured.</p>
  </>;
}

function RangeFields({ node, onChange }) {
  const p = node.props;
  const rating = node.type === 'Rating';
  const set = patch => onChange(node.id, { props: patch });
  const valid = next => rating
    ? Number.isInteger(next.items) && next.items >= 1 && next.items <= 20 && Number.isInteger(next.step) && next.step >= 1 && next.items % next.step === 0 && Number.isFinite(next.defaultValue) && next.defaultValue >= 0 && next.defaultValue <= next.items && next.defaultValue % next.step === 0
    : [next.min, next.max, next.step, next.defaultValue].every(value => Number.isFinite(value) && Math.abs(value) <= 1000000) && next.min <= next.max && next.step > 0 && next.defaultValue >= next.min && next.defaultValue <= next.max && Math.abs((next.defaultValue - next.min) / next.step - Math.round((next.defaultValue - next.min) / next.step)) < 1e-8;
  const numberField = (key, label) => <label className="field" key={key}><span>{label}</span><input type="number" key={`${node.id}-${key}-${p[key]}`} defaultValue={p[key]} onBlur={event => { const raw = event.target.value; const value = Number(raw); if (raw.trim() && valid({ ...p, [key]: value })) set({ [key]: value }); else event.target.value = p[key]; }} /></label>;
  return <><label className="field"><span>Field name</span><input key={`${node.id}-name-${p.name}`} defaultValue={p.name} onBlur={event => { if (/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(event.target.value)) set({ name: event.target.value }); else event.target.value = p.name; }} /></label>
    <label className="field"><span>Accessible label</span><input key={`${node.id}-label-${p.label}`} defaultValue={p.label} onBlur={event => { if (event.target.value.trim() && event.target.value.length <= 200) set({ label: event.target.value }); else event.target.value = p.label; }} /></label>
    {rating ? numberField('items', 'Rating items (1–20)') : <>{numberField('min', 'Minimum')}{numberField('max', 'Maximum')}</>}
    {numberField('step', rating ? 'Whole-score step' : 'Step')}{numberField('defaultValue', 'Initial value')}
    <label className="field"><span><input type="checkbox" checked={p.disabled} onChange={event => set({ disabled: event.target.checked })} /> Disabled</span></label>
    {rating && <label className="field"><span><input type="checkbox" checked={p.readOnly} onChange={event => set({ readOnly: event.target.checked })} /> Read-only</span></label>}
    <p className="property-note">Values must fit the range and step. Preview and exports keep visitor changes in local runtime state; no submission is configured.</p>
  </>;
}

function AutocompleteFields({ node, onChange }) {
  const p = node.props;
  const set = patch => onChange(node.id, { props: patch });
  const commit = (key, required = true) => <label className="field" key={key}><span>{{ name: 'Field name', label: 'Accessible label', placeholder: 'Placeholder', emptyText: 'Empty-list text', noResultsText: 'No-results text' }[key]}</span><input key={`${node.id}-${key}-${p[key]}`} defaultValue={p[key]} onBlur={event => { const value = event.target.value; const valid = key === 'name' ? /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value) : value.length <= 200 && (!required || Boolean(value.trim())); if (valid) set({ [key]: value }); else event.target.value = p[key]; }} /></label>;
  const optionChange = (id, patch) => set({ options: p.options.map(option => option.id === id ? { ...option, ...patch } : option) });
  return <>{commit('name')}{commit('label')}{commit('placeholder', false)}{commit('emptyText')}{commit('noResultsText')}
    <label className="field"><span><input type="checkbox" checked={p.required} onChange={event => set({ required: event.target.checked })} /> Required</span></label>
    <label className="field"><span><input type="checkbox" checked={p.disabled} onChange={event => set({ disabled: event.target.checked })} /> Disabled</span></label>
    <h3>Options</h3>{p.options.map((option, index) => <div className="structured-row" key={option.id}><strong>Option {index + 1} · {option.id}</strong><label className="field"><span>Option {index + 1} label</span><input key={`${option.id}-label-${option.label}`} defaultValue={option.label} onBlur={event => { if (event.target.value.trim() && event.target.value.length <= 200) optionChange(option.id, { label: event.target.value }); else event.target.value = option.label; }} /></label><label className="field"><span>Option {index + 1} value</span><input key={`${option.id}-value-${option.value}`} defaultValue={option.value} onBlur={event => { if (event.target.value.trim() && event.target.value.length <= 100) optionChange(option.id, { value: event.target.value }); else event.target.value = option.value; }} /></label><div className="order-actions"><button aria-label={`Move option ${index + 1} up`} disabled={index === 0} onClick={() => set({ options: swap(p.options, index, index - 1) })}>↑</button><button aria-label={`Move option ${index + 1} down`} disabled={index === p.options.length - 1} onClick={() => set({ options: swap(p.options, index, index + 1) })}>↓</button><button aria-label={`Remove option ${index + 1}`} onClick={() => set({ options: p.options.filter(current => current.id !== option.id), defaultOptionId: p.defaultOptionId === option.id ? '' : p.defaultOptionId })}>Remove</button></div></div>)}
    <button disabled={p.options.length >= 100} onClick={() => { const id = structuredId('option'); set({ options: [...p.options, { id, label: 'New option', value: id }] }); }}>Add option</button>
    <label className="field"><span>Initial selection</span><select value={p.defaultOptionId} onChange={event => set({ defaultOptionId: event.target.value })}><option value="">None</option>{p.options.map(option => <option key={option.id} value={option.id}>{option.label} · {option.value}</option>)}</select></label>
    <p className="property-note">Filtering uses these options locally. Visitor text and selection stay in runtime state; no remote search or submission is configured.</p>
  </>;
}

function TransferFields({ node, onChange }) {
  const p = node.props;
  const set = patch => onChange(node.id, { props: patch });
  const textField = (key, label) => <label className="field" key={key}><span>{label}</span><input key={`${node.id}-${key}-${p[key]}`} defaultValue={p[key]} onBlur={event => { if (event.target.value.trim() && event.target.value.length <= 200) set({ [key]: event.target.value }); else event.target.value = p[key]; }} /></label>;
  const optionChange = (id, patch) => set({ options: p.options.map(option => option.id === id ? { ...option, ...patch } : option) });
  return <>{textField('label', 'Transfer label')}{textField('leftLabel', 'Left group label')}{textField('rightLabel', 'Right group label')}
    <label className="field"><span><input type="checkbox" checked={p.disabled} onChange={event => set({ disabled: event.target.checked })} /> Disabled</span></label>
    <h3>Options</h3>{p.options.map((option, index) => <div className="structured-row" key={option.id}><strong>Option {index + 1} · {option.id}</strong><label className="field"><span>Option {index + 1} label</span><input key={`${option.id}-label-${option.label}`} defaultValue={option.label} onBlur={event => { if (event.target.value.trim() && event.target.value.length <= 200) optionChange(option.id, { label: event.target.value }); else event.target.value = option.label; }} /></label><label className="field"><span>Option {index + 1} value</span><input key={`${option.id}-value-${option.value}`} defaultValue={option.value} onBlur={event => { const value = event.target.value; if (value.trim() && value.length <= 100 && !p.options.some(other => other.id !== option.id && other.value === value)) optionChange(option.id, { value }); else event.target.value = option.value; }} /></label><label className="field"><span><input type="checkbox" checked={p.defaultRightIds.includes(option.id)} onChange={event => set({ defaultRightIds: event.target.checked ? [...p.defaultRightIds, option.id] : p.defaultRightIds.filter(id => id !== option.id) })} /> Initially on right</span></label><div className="order-actions"><button aria-label={`Move option ${index + 1} up`} disabled={index === 0} onClick={() => set({ options: swap(p.options, index, index - 1) })}>↑</button><button aria-label={`Move option ${index + 1} down`} disabled={index === p.options.length - 1} onClick={() => set({ options: swap(p.options, index, index + 1) })}>↓</button><button aria-label={`Remove option ${index + 1}`} onClick={() => set({ options: p.options.filter(current => current.id !== option.id), defaultRightIds: p.defaultRightIds.filter(id => id !== option.id) })}>Remove</button></div></div>)}
    <button disabled={p.options.length >= 100} onClick={() => { const id = structuredId('option'); set({ options: [...p.options, { id, label: 'New item', value: id }] }); }}>Add option</button>
    <p className="property-note">Visitor movement stays local to Preview or the exported page. No remote persistence, search, or form submission is configured.</p>
  </>;
}

function ContentTab({ node, location, siblingCount, onChange, onReorder, onRemove, onUploadAsset, assets }) {
  const props = node.props;
  const textLabel = node.type === 'Button' ? 'Button label' : node.type === 'Link' ? 'Link label' : node.type === 'Heading' ? 'Heading text' : 'Text';
  const field = (key, label, type = 'text') => <label className="field" key={key}><span>{label}</span><input type={type} value={props[key]} onChange={event => onChange(node.id, { props: { [key]: type === 'number' ? Number(event.target.value) : event.target.value } })} /></label>;
  const choice = (key, label, values) => <label className="field" key={key}><span>{label}</span><select value={props[key]} onChange={event => onChange(node.id, { props: { [key]: event.target.value } })}>{values.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>;
  const iconChoice = (key, optional = false) => choice(key, 'Icon', [...(optional ? [['', 'None']] : []), ...iconIds.map(id => [id, id])]);
  return <div className="property-body">
    {Object.hasOwn(props, 'label') && !['Chip', 'Checkbox', 'Radio Group', 'Switch', 'Toggle Button', 'Floating Action Button'].includes(node.type) && <label className="field"><span>Layer name</span><input value={props.label} onChange={event => onChange(node.id, { props: { label: event.target.value } })} /></label>}
    {Object.hasOwn(props, 'text') && <label className="field"><span>{textLabel}</span><textarea rows={node.type === 'Text' ? 4 : 2} value={props.text} onChange={event => onChange(node.id, { props: { text: event.target.value } })} /></label>}
    {node.type === 'Heading' && <label className="field"><span>Heading level</span><select value={props.level} onChange={event => onChange(node.id, { props: { level: Number(event.target.value) } })}>{[1, 2, 3, 4, 5, 6].map(level => <option key={level} value={level}>H{level}</option>)}</select></label>}
    {(node.type === 'Image' || node.type === 'Avatar') && <><label className="field"><span>Image source</span><input value={props.src} placeholder="/api/assets/… or https://…" onChange={event => onChange(node.id, { props: { src: event.target.value } })} /></label><label className="field"><span>Upload image</span><input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={event => { const file = event.target.files?.[0]; if (file) onUploadAsset(node.id, file); event.target.value = ''; }} /></label>{assets.length > 0 && <label className="field"><span>Saved assets</span><select value={assets.some(asset => asset.url === props.src) ? props.src : ''} onChange={event => { if (event.target.value) onChange(node.id, { props: { src: event.target.value } }); }}><option value="">Choose an image</option>{assets.map(asset => <option key={asset.id} value={asset.url}>{asset.filename}</option>)}</select></label>}{field('alt', 'Alternative text')}</>}
    {node.type === 'Avatar' && <>{field('name', 'Name')}{field('initials', 'Initials fallback')}{choice('shape', 'Shape', [['circle', 'Circle'], ['rounded', 'Rounded'], ['square', 'Square']])}{field('size', 'Size in pixels', 'number')}</>}
    {node.type === 'Badge' && <>{field('content', 'Anchor text')}{field('text', 'Badge text (overrides count)')}{field('count', 'Count', 'number')}{field('maxCount', 'Maximum shown (0 disables)', 'number')}{field('color', 'Badge color', 'color')}{choice('placement', 'Placement', [['topRight', 'Top right'], ['topLeft', 'Top left'], ['bottomRight', 'Bottom right'], ['bottomLeft', 'Bottom left']])}</>}
    {node.type === 'Chip' && <>{field('label', 'Chip label')}{iconChoice('icon', true)}</>}
    {node.type === 'Icons' && <>{iconChoice('icon')}{field('name', 'Accessible name')}{field('size', 'Size in pixels', 'number')}{field('color', 'Icon color', 'color')}</>}
    {node.type === 'Lists' && <ListFields node={node} onChange={onChange} />}
    {node.type === 'Table' && <TableFields node={node} onChange={onChange} />}
    {node.type === 'Tooltip' && <>{['trigger', 'content'].map(key => <label className="field" key={key}><span>{key === 'trigger' ? 'Trigger label' : 'Tooltip content'}</span><input defaultValue={props[key]} key={`${node.id}-${key}-${props[key]}`} onBlur={event => { if (event.target.value.trim()) onChange(node.id, { props: { [key]: event.target.value } }); else event.target.value = props[key]; }} /></label>)}{choice('placement', 'Placement', [['top', 'Top'], ['bottom', 'Bottom'], ['left', 'Left'], ['right', 'Right']])}</>}
    {['Checkbox', 'Radio Group', 'Switch', 'Toggle Button'].includes(node.type) && <ControlFields node={node} onChange={onChange} />}
    {['Rating', 'Slider'].includes(node.type) && <RangeFields node={node} onChange={onChange} />}
    {node.type === 'Autocomplete' && <AutocompleteFields node={node} onChange={onChange} />}
    {node.type === 'Transfer List' && <TransferFields node={node} onChange={onChange} />}
    {node.type === 'Floating Action Button' && <><label className="field"><span>Accessible label</span><input key={`${node.id}-fab-label-${props.label}`} defaultValue={props.label} onBlur={event => { if (event.target.value.trim() && event.target.value.length <= 200) onChange(node.id, { props: { label: event.target.value } }); else event.target.value = props.label; }} /></label>{iconChoice('icon')}<label className="field"><span>Action</span><select value={props.action} onChange={event => onChange(node.id, { props: { action: event.target.value, href: event.target.value === 'link' ? '/' : '' } })}><option value="scrollTop">Scroll to top</option><option value="link">Open link</option></select></label>{props.action === 'link' && <label className="field"><span>Destination</span><input key={`${node.id}-fab-href-${props.href}`} defaultValue={props.href} placeholder="/about or https://example.com" onBlur={event => { const value = event.target.value.trim(); if (safeFabHref(value)) onChange(node.id, { props: { href: value } }); else event.target.value = props.href; }} /></label>}{choice('corner', 'Screen corner', [['bottomRight', 'Bottom right'], ['bottomLeft', 'Bottom left'], ['topRight', 'Top right'], ['topLeft', 'Top left']])}<label className="field"><span>Offset in pixels (16–120)</span><input type="number" min="16" max="120" key={`${node.id}-fab-offset-${props.offset}`} defaultValue={props.offset} onBlur={event => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 16 && value <= 120) onChange(node.id, { props: { offset: value } }); else event.target.value = props.offset; }} /></label>{choice('shape', 'Shape', [['circle', 'Circle'], ['rounded', 'Rounded'], ['square', 'Square']])}{[['visibleDesktop', 'Desktop'], ['visibleTablet', 'Tablet'], ['visibleMobile', 'Mobile']].map(([key, label]) => <label className="field" key={key}><span><input type="checkbox" checked={props[key]} onChange={event => onChange(node.id, { props: { [key]: event.target.checked } })} /> Show on {label}</span></label>)}<p className="property-note">Edit mode keeps this node in flow for selection. Preview and exports place it at the viewport corner. Mobile is hidden by default.</p></>}
    {(node.type === 'Button' || node.type === 'Link') && <label className="field"><span>Link destination</span><input value={props.href} placeholder="#section or https://…" onChange={event => onChange(node.id, { props: { href: event.target.value } })} /></label>}
    <p className="property-note">Export: {registry[node.type].exports.join(', ').toUpperCase()}. {registry[node.type].exportNote || 'Static content and styles are supported.'}</p>
    <div className="property-divider" /><h3>Order in parent</h3><div className="order-actions"><button disabled={location.index === 0} onClick={() => onReorder(node.id, location.index - 1)}>↑ Move up</button><button disabled={location.index >= siblingCount - 1} onClick={() => onReorder(node.id, location.index + 1)}>↓ Move down</button></div><button className="remove-node" onClick={() => onRemove(node.id)}>Remove selected node</button>
  </div>;
}

function LayoutTab({ node, breakpoint, onChange }) {
  return <div className="property-body"><p className="property-note">{breakpoint === 'desktop' ? 'Base styles for every screen.' : `Only ${breakpoint} overrides are saved. Clear a field to inherit.`}</p>
    <h3>Display</h3><StyleSelect node={node} breakpoint={breakpoint} property="display" values={['block', 'inline-block', 'flex', 'grid', 'none']} onChange={onChange} />
    <div className="field-grid"><StyleInput node={node} breakpoint={breakpoint} property="width" onChange={onChange} /><StyleInput node={node} breakpoint={breakpoint} property="maxWidth" label="Max width" onChange={onChange} /><StyleInput node={node} breakpoint={breakpoint} property="minHeight" label="Min height" onChange={onChange} /><StyleInput node={node} breakpoint={breakpoint} property="gap" onChange={onChange} /></div>
    <div className="property-divider" /><h3>Grid</h3><StyleInput node={node} breakpoint={breakpoint} property="gridTemplateColumns" label="Columns" placeholder="e.g. 1fr 1fr" onChange={onChange} /><StyleInput node={node} breakpoint={breakpoint} property="gridTemplateRows" label="Rows" onChange={onChange} />
    <div className="property-divider" /><h3>Flex & alignment</h3><div className="field-grid"><StyleSelect node={node} breakpoint={breakpoint} property="flexDirection" label="Direction" values={['row', 'column', 'row-reverse', 'column-reverse']} onChange={onChange} /><StyleSelect node={node} breakpoint={breakpoint} property="flexWrap" label="Wrap" values={['nowrap', 'wrap']} onChange={onChange} /><StyleSelect node={node} breakpoint={breakpoint} property="justifyContent" label="Justify" values={['start', 'center', 'end', 'space-between', 'space-around', 'space-evenly']} onChange={onChange} /><StyleSelect node={node} breakpoint={breakpoint} property="alignItems" label="Align" values={['start', 'center', 'end', 'stretch', 'baseline']} onChange={onChange} /></div>
    <div className="property-divider" /><h3>Box model</h3><p className="property-note">Margin adds space outside the node; padding adds space between its edge and content.</p><BoxModel node={node} breakpoint={breakpoint} onChange={onChange} />
  </div>;
}

function StyleTab({ node, breakpoint, onChange }) {
  const [draft, setDraft] = useState('');
  const [advancedError, setAdvancedError] = useState('');
  useEffect(() => { setDraft(node.advancedCss?.[breakpoint] || ''); setAdvancedError(''); }, [node.id, breakpoint, node.advancedCss?.[breakpoint]]);
  const applyAdvanced = () => {
    try {
      const declarations = parseAdvancedCss(draft);
      onChange(node.id, { advancedCss: { [breakpoint]: declarations || null } });
      setAdvancedError('');
    } catch (error) { setAdvancedError(error.message); }
  };
  return <div className="property-body"><p className="property-note">{breakpoint === 'desktop' ? 'Base styles for every screen.' : `Only ${breakpoint} overrides are saved. Clear a field to inherit.`}</p>
    <h3>Typography</h3><div className="field-grid"><StyleInput node={node} breakpoint={breakpoint} property="fontFamily" label="Font family" onChange={onChange} /><StyleInput node={node} breakpoint={breakpoint} property="fontSize" label="Font size" onChange={onChange} /><StyleInput node={node} breakpoint={breakpoint} property="fontWeight" label="Weight" onChange={onChange} /><StyleInput node={node} breakpoint={breakpoint} property="lineHeight" label="Line height" onChange={onChange} /></div><StyleSelect node={node} breakpoint={breakpoint} property="textAlign" label="Text align" values={['left', 'center', 'right', 'justify']} onChange={onChange} />
    <div className="property-divider" /><h3>Color & surface</h3><div className="field-grid"><StyleInput node={node} breakpoint={breakpoint} property="color" label="Text color" onChange={onChange} /><StyleInput node={node} breakpoint={breakpoint} property="backgroundColor" label="Background" onChange={onChange} /></div>
    <div className="property-divider" /><h3>Border & shadow</h3><StyleInput node={node} breakpoint={breakpoint} property="border" placeholder="1px solid #ddd" onChange={onChange} /><div className="field-grid"><StyleInput node={node} breakpoint={breakpoint} property="borderRadius" label="Radius" onChange={onChange} /><StyleInput node={node} breakpoint={breakpoint} property="boxShadow" label="Shadow" onChange={onChange} /></div>
    <div className="property-divider" /><h3>Advanced CSS</h3><p className="property-note">Declarations only, such as <code>letter-spacing: .1em;</code>. They apply only to this node and override fields above at this breakpoint.</p><label className="field"><span>Declarations</span><textarea data-advanced-css rows={5} value={draft} onChange={event => setDraft(event.target.value)} placeholder="letter-spacing: .1em;" /></label>{advancedError && <p className="field-error" role="alert">{advancedError}</p>}<button className="apply-css" onClick={applyAdvanced}>Apply declarations</button>
  </div>;
}

export function PropertiesPanel({ document, selectedId, selectedRegion, breakpoint, onSelect, onSelectRegion, onChange, onReorder, onRemove, onUploadAsset, assets = [] }) {
  const [tab, setTab] = useState('content');
  const location = selectedId ? findNode(document, selectedId) : null;
  const selected = location?.node;
  const region = selected ? location.region : selectedRegion;
  const ancestors = selected ? getAncestors(document, selectedId) : [];
  const siblingCount = location ? (location.parentId ? findNode(document, location.parentId).node.children.length : document.regions[location.region].length) : 0;
  useEffect(() => setTab('content'), [selectedId]);
  return <div className="panel-scroll"><div className="panel-heading"><span className="panel-kicker">INSPECTOR</span><h2>Properties</h2><p>Content, layout, and style for one node.</p></div>
    {region && <nav className="breadcrumbs" aria-label="Selection breadcrumbs"><button onClick={() => onSelectRegion(region)}>{region}</button>{[...ancestors, ...(selected ? [selectedId] : [])].map(id => <React.Fragment key={id}><span>›</span><button onClick={() => onSelect(id)}>{labelFor(findNode(document, id).node)}</button></React.Fragment>)}</nav>}
    {selected ? <><div className="selection-label"><span>{selected.type}</span><code>{selected.id}</code></div><div className="property-tabs" role="tablist" aria-label="Properties tabs">{['content', 'layout', 'style'].map(name => <button key={name} role="tab" aria-selected={tab === name} className={tab === name ? 'active' : ''} onClick={() => setTab(name)}>{name}</button>)}</div>
      {tab === 'content' && <ContentTab node={selected} location={location} siblingCount={siblingCount} onChange={onChange} onReorder={onReorder} onRemove={onRemove} onUploadAsset={onUploadAsset} assets={assets} />}
      {tab === 'layout' && <LayoutTab node={selected} breakpoint={breakpoint} onChange={onChange} />}
      {tab === 'style' && <StyleTab node={selected} breakpoint={breakpoint} onChange={onChange} />}
    </> : <div className="empty-selection"><div>◇</div><strong>{selectedRegion ? `${selectedRegion[0].toUpperCase()}${selectedRegion.slice(1)} selected` : 'Nothing selected'}</strong><p>{selectedRegion ? 'Choose an element to add directly to this region.' : 'Select a node from Layers or the canvas to edit its content, layout, and style.'}</p></div>}
  </div>;
}
