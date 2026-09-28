import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DragDropProvider, useDraggable, useDroppable } from '@dnd-kit/react';
import { pointerIntersection } from '@dnd-kit/collision';
import { addNode, findNode, getAncestors, regions, registry, reorderNode, updateNode, validateDocument } from '@builder/document';
import { applyDrop, placementFromPointer } from './drop.js';
import { createPaletteNode, paletteItems } from './palette.js';
import { PageView } from './render.jsx';
import { PropertiesPanel } from './properties.jsx';
import './style.css';

const labelFor = node => node.props.label || node.props.text || node.type;

function PaletteButton({ item, onAdd }) {
  const { ref, isDragging } = useDraggable({ id: `palette:${item.key}`, type: 'palette' });
  return <button ref={ref} className="palette-item" data-palette={item.key} data-dragging={isDragging || undefined} onClick={() => onAdd(item.key)} title={`Click to add ${item.label}; drag to place it`}>
    <span className="palette-icon">{item.icon}</span><span>{item.label}</span><span className="palette-plus">＋</span>
  </button>;
}

function ElementsPanel({ onAdd }) {
  return <div className="panel-scroll"><div className="panel-heading"><span className="panel-kicker">BUILD</span><h2>Elements</h2><p>Drag onto the canvas or select a target and click to add.</p></div>
    {['Elements', 'Structure', 'Presets'].map(group => <section className="palette-group" key={group}><h3>{group}</h3>{paletteItems.filter(item => item.group === group).map(item => <PaletteButton key={item.key} item={item} onAdd={onAdd} />)}</section>)}
  </div>;
}

function LayerRow({ node, depth, selectedId, expanded, onToggle, onSelect, dropTarget }) {
  const { ref: dropRef } = useDroppable({ id: `layer-node:${node.id}`, accept: ['palette', 'tree-node'], collisionDetector: pointerIntersection, collisionPriority: depth + 2 });
  const { ref: dragRef, handleRef, isDragging } = useDraggable({ id: `node:${node.id}`, type: 'tree-node' });
  const combinedRef = useCallback(element => { dropRef(element); dragRef(element); }, [dropRef, dragRef]);
  const isContainer = registry[node.type].kind === 'container';
  const isOpen = expanded.has(node.id);
  const active = dropTarget?.targetId === `layer-node:${node.id}`;
  return <React.Fragment>
    <div ref={combinedRef} className={`layer-row ${selectedId === node.id ? 'active' : ''}`} data-layer-id={node.id} data-drop={active && dropTarget.valid ? dropTarget.placement : undefined} data-drop-invalid={active && !dropTarget.valid ? 'true' : undefined} data-dragging={isDragging || undefined} style={{ paddingLeft: 8 + depth * 15 }}>
      <button className="layer-toggle" onClick={() => isContainer && onToggle(node.id)} aria-label={isContainer ? `${isOpen ? 'Collapse' : 'Expand'} ${labelFor(node)}` : undefined} disabled={!isContainer}>{isContainer ? (isOpen ? '▾' : '▸') : '·'}</button>
      <button ref={handleRef} className="layer-handle" aria-label={`Drag ${labelFor(node)}`} title="Drag to move">⠿</button>
      <button className="layer-select" onClick={() => onSelect(node.id)} title={`${node.type}: ${labelFor(node)}`}><span className="layer-icon">{isContainer ? '▣' : '◇'}</span><span className="layer-name">{labelFor(node)}</span><small>{node.type}</small></button>
    </div>
    {isContainer && isOpen && node.children.map(child => <LayerRow key={child.id} node={child} depth={depth + 1} selectedId={selectedId} expanded={expanded} onToggle={onToggle} onSelect={onSelect} dropTarget={dropTarget} />)}
  </React.Fragment>;
}

function RegionLayer({ region, nodes, selectedRegion, selectedId, expanded, onToggle, onSelect, onSelectRegion, dropTarget }) {
  const { ref } = useDroppable({ id: `layer-region:${region}`, accept: ['palette', 'tree-node'], collisionDetector: pointerIntersection, collisionPriority: 1 });
  const active = dropTarget?.targetId === `layer-region:${region}`;
  return <section className="region-group"><div ref={ref} className={`region-row ${selectedRegion === region ? 'active' : ''}`} data-layer-region={region} data-drop={active && dropTarget.valid ? 'inside' : undefined} data-drop-invalid={active && !dropTarget.valid ? 'true' : undefined}>
    <button onClick={() => onSelectRegion(region)}><span>⌑</span>{region}<small>{nodes.length}</small></button>
  </div>{nodes.map(node => <LayerRow key={node.id} node={node} depth={0} selectedId={selectedId} expanded={expanded} onToggle={onToggle} onSelect={onSelect} dropTarget={dropTarget} />)}</section>;
}

function LayersPanel({ document, selectedId, selectedRegion, expanded, onToggle, onSelect, onSelectRegion, dropTarget }) {
  return <div className="panel-scroll"><div className="panel-heading"><span className="panel-kicker">STRUCTURE</span><h2>Layers</h2><p>Select, expand, or drag a row to move it.</p></div>
    {regions.map(region => <RegionLayer key={region} region={region} nodes={document.regions[region]} selectedId={selectedId} selectedRegion={selectedRegion} expanded={expanded} onToggle={onToggle} onSelect={onSelect} onSelectRegion={onSelectRegion} dropTarget={dropTarget} />)}
  </div>;
}

function sourceFromDrag(source, paletteNode) {
  if (!source) return null;
  const id = String(source.id);
  if (id.startsWith('palette:')) return { kind: 'palette', node: paletteNode || createPaletteNode(id.slice(8)) };
  if (id.startsWith('node:')) return { kind: 'node', id: id.slice(5) };
  return null;
}

function hitTarget(pointer, sourceId) {
  if (!Number.isFinite(pointer.x) || !Number.isFinite(pointer.y)) return null;
  for (const element of window.document.elementsFromPoint(pointer.x, pointer.y)) {
    const layer = element.closest('[data-layer-id]');
    if (layer && layer.dataset.layerId !== sourceId) return { id: `layer-node:${layer.dataset.layerId}`, element: layer };
    const layerRegion = element.closest('[data-layer-region]');
    if (layerRegion) return { id: `layer-region:${layerRegion.dataset.layerRegion}`, element: layerRegion };
    const canvasNode = element.closest('.page [data-node-id]');
    if (canvasNode && !canvasNode.classList.contains('page') && canvasNode.dataset.nodeId !== sourceId) return { id: `canvas-node:${canvasNode.dataset.nodeId}`, element: canvasNode };
    const canvasRegion = element.closest('.page [data-region]');
    if (canvasRegion) return { id: `canvas-region:${canvasRegion.dataset.region}`, element: canvasRegion };
  }
  return null;
}

function Editor({ document, setDocument, selectedId, setSelectedId, selectedRegion, setSelectedRegion, breakpoint, setBreakpoint, onStatus }) {
  const [leftTab, setLeftTab] = useState('elements');
  const [expanded, setExpanded] = useState(() => new Set());
  const [dropTarget, setDropTarget] = useState(null);
  const pointer = useRef({ x: null, y: null });
  const paletteNode = useRef(null);
  useEffect(() => {
    const track = event => { pointer.current = { x: event.clientX, y: event.clientY }; };
    window.addEventListener('pointermove', track, true);
    return () => window.removeEventListener('pointermove', track, true);
  }, []);
  const select = id => { setSelectedId(id); setSelectedRegion(null); };
  const selectRegion = region => { setSelectedId(null); setSelectedRegion(region); };
  const toggle = id => setExpanded(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const expandAncestors = (page, id) => setExpanded(previous => new Set([...previous, ...getAncestors(page, id)]));
  const change = (id, patch) => {
    try { setDocument(updateNode(document, id, patch)); onStatus('Page JSON updated', 'success'); }
    catch (error) { onStatus(error.message, 'error'); }
  };
  const reorder = (id, index) => {
    try { setDocument(reorderNode(document, id, index)); onStatus('Node reordered', 'success'); }
    catch (error) { onStatus(error.message, 'error'); }
  };
  const add = key => {
    try {
      const node = createPaletteNode(key);
      let parent = selectedRegion || 'main';
      let index = document.regions[parent].length;
      if (selectedId) {
        const location = findNode(document, selectedId);
        if (registry[location.node.type].kind === 'container') { parent = selectedId; index = location.node.children.length; }
        else { parent = location.parentId || location.region; index = location.index + 1; }
      }
      const next = addNode(document, parent, index, node);
      setDocument(next); select(node.id); expandAncestors(next, node.id); onStatus(`${key === 'Columns3' ? 'Three columns' : key} added to ${parent}`, 'success');
    } catch (error) { onStatus(error.message, 'error'); }
  };
  const inspectDrop = event => {
    const source = sourceFromDrag(event.operation.source, paletteNode.current);
    const target = hitTarget(pointer.current, source?.kind === 'node' ? source.id : null) || event.operation.target;
    if (!source || !target) { setDropTarget(null); return null; }
    const targetId = String(target.id);
    const placement = placementFromPointer(targetId, pointer.current.y, target.element?.getBoundingClientRect());
    try {
      applyDrop(document, source, targetId, placement);
      const info = { source, targetId, placement, valid: true };
      setDropTarget(info); return info;
    } catch (error) {
      const info = { source, targetId, placement, valid: false, reason: error.message };
      setDropTarget(info); onStatus(error.message, 'error'); return info;
    }
  };
  const finishDrop = event => {
    if (event.canceled) { setDropTarget(null); paletteNode.current = null; onStatus('Drag canceled', 'info'); return; }
    const info = inspectDrop(event);
    setDropTarget(null); paletteNode.current = null;
    if (!info) { onStatus('Drop onto a region or node', 'error'); return; }
    if (!info.valid) { onStatus(info.reason, 'error'); return; }
    try {
      const next = applyDrop(document, info.source, info.targetId, info.placement);
      const id = info.source.kind === 'palette' ? info.source.node.id : info.source.id;
      setDocument(next); select(id); expandAncestors(next, id); onStatus(`Placed ${findNode(next, id).node.type} ${info.placement} ${info.targetId.split(':')[1]}`, 'success');
    } catch (error) { onStatus(error.message, 'error'); }
  };
  return <DragDropProvider onDragStart={event => { const id = String(event.operation.source?.id || ''); paletteNode.current = id.startsWith('palette:') ? createPaletteNode(id.slice(8)) : null; onStatus('Drag over a region or node', 'info'); }} onDragMove={inspectDrop} onDragOver={inspectDrop} onDragEnd={finishDrop}>
    <div className="workspace">
      <aside className="sidebar left-sidebar"><div className="left-tabs"><button className={leftTab === 'elements' ? 'active' : ''} onClick={() => setLeftTab('elements')}>Elements</button><button className={leftTab === 'layers' ? 'active' : ''} onClick={() => setLeftTab('layers')}>Layers</button></div>
        {leftTab === 'elements' ? <ElementsPanel onAdd={add} /> : <LayersPanel document={document} selectedId={selectedId} selectedRegion={selectedRegion} expanded={expanded} onToggle={toggle} onSelect={select} onSelectRegion={selectRegion} dropTarget={dropTarget} />}
      </aside>
      <main className="canvas-area"><div className="canvas-toolbar"><div><span className="canvas-dot" /> Canvas <span className="canvas-size">{breakpoint === 'desktop' ? 'Fluid desktop' : breakpoint === 'tablet' ? '768px tablet' : '390px mobile'}</span></div><div className="breakpoint-switch" role="group" aria-label="Canvas breakpoint">{['desktop', 'tablet', 'mobile'].map(mode => <button key={mode} className={breakpoint === mode ? 'active' : ''} aria-pressed={breakpoint === mode} onClick={() => setBreakpoint(mode)}>{mode}</button>)}</div></div><div className="canvas-scroll"><PageView document={document} selectedId={selectedId} onSelect={select} dropTarget={dropTarget} breakpoint={breakpoint} /></div></main>
      <aside className="sidebar properties"><PropertiesPanel document={document} selectedId={selectedId} selectedRegion={selectedRegion} breakpoint={breakpoint} onSelect={select} onSelectRegion={selectRegion} onChange={change} onReorder={reorder} /></aside>
    </div>
  </DragDropProvider>;
}

function App() {
  const [document, setDocument] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedRegion, setSelectedRegion] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState({ message: 'Select a region or drag an element to begin', tone: 'info' });
  const [preview, setPreview] = useState(false);
  const [breakpoint, setBreakpoint] = useState('desktop');
  useEffect(() => {
    fetch('/api/sample-page').then(response => { if (!response.ok) throw new Error(`API returned ${response.status}`); return response.json(); })
      .then(page => setDocument(validateDocument(page)))
      .catch(cause => setError(cause.message));
  }, []);
  const download = () => {
    const blob = new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement('a'); link.href = url; link.download = 'page.json'; link.click(); URL.revokeObjectURL(url);
  };
  return <div className="app-shell">
    <header className="app-header"><div className="app-brand"><span className="brand-mark">✦</span><strong>Northstar Builder</strong><span className="divider" /><span className="project-name">Sample page</span></div>
      <div className="header-actions"><span className="status-dot" /><span className="status-text">Local document</span><button className="toolbar-button" disabled={!document} onClick={download}>Download JSON</button><button className="view-button" disabled={!document} onClick={() => setPreview(value => !value)}>{preview ? 'Back to editor' : 'Preview page'}</button></div></header>
    <div className={`status-bar ${status.tone}`} role="status">{status.message}</div>
    {error ? <div className="error">Could not load the sample page: {error}. Start the API with <code>npm run dev</code>.</div> : !document ? <div className="loading">Loading sample page…</div> : preview ? <div className="preview-wrap"><PageView document={document} interactive={false} breakpoint={breakpoint} /></div> : <Editor document={document} setDocument={setDocument} selectedId={selectedId} setSelectedId={setSelectedId} selectedRegion={selectedRegion} setSelectedRegion={setSelectedRegion} breakpoint={breakpoint} setBreakpoint={setBreakpoint} onStatus={(message, tone) => setStatus({ message, tone })} />}
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
