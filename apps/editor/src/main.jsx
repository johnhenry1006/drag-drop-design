import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { regions, registry, validateDocument } from '@builder/document';
import { PageView } from './render.jsx';
import './style.css';

function findNode(document, id) {
  const walk = nodes => {
    for (const node of nodes) {
      if (node.id === id) return node;
      const found = node.children && walk(node.children);
      if (found) return found;
    }
    return null;
  };
  for (const region of regions) {
    const found = walk(document.regions[region]);
    if (found) return found;
  }
  return null;
}

function updateProps(document, id, key, value) {
  const visit = nodes => nodes.map(node => ({
    ...node,
    props: node.id === id ? { ...node.props, [key]: value } : node.props,
    ...(node.children ? { children: visit(node.children) } : {})
  }));
  return validateDocument({ ...document, regions: Object.fromEntries(regions.map(region => [region, visit(document.regions[region])])) });
}

function TreeNodes({ nodes, selectedId, onSelect, depth = 0 }) {
  return nodes.map(node => <React.Fragment key={node.id}>
    <button className={`tree-node ${selectedId === node.id ? 'active' : ''}`} style={{ paddingLeft: 16 + depth * 18 }} onClick={() => onSelect(node.id)}>
      <span className="tree-icon">{registry[node.type].kind === 'container' ? '▣' : '◇'}</span>
      <span>{node.props.label || node.props.text || node.type}</span>
      <small>{node.type}</small>
    </button>
    {node.children && <TreeNodes nodes={node.children} selectedId={selectedId} onSelect={onSelect} depth={depth + 1} />}
  </React.Fragment>);
}

function App() {
  const [document, setDocument] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    fetch('/api/sample-page').then(response => { if (!response.ok) throw new Error(`API returned ${response.status}`); return response.json(); })
      .then(page => setDocument(validateDocument(page)))
      .catch(cause => setError(cause.message));
  }, []);
  const selected = document && findNode(document, selectedId);
  return <div className="app-shell">
    <header className="app-header">
      <div className="app-brand"><span className="brand-mark">✦</span><strong>Northstar Builder</strong><span className="divider" /> <span className="project-name">Sample page</span></div>
      <div className="header-actions"><span className="status-dot" /> <span className="status-text">Local preview</span><button className="view-button" onClick={() => setPreview(value => !value)}>{preview ? 'Back to editor' : 'Preview page'}</button></div>
    </header>
    {error ? <div className="error">Could not load the sample page: {error}. Start the API with <code>npm run dev</code>.</div> : !document ? <div className="loading">Loading sample page…</div> : preview ?
      <div className="preview-wrap"><PageView document={document} /></div> :
      <div className="workspace">
        <aside className="sidebar layers"><div className="panel-heading"><span className="panel-kicker">STRUCTURE</span><h2>Layers</h2><p>Select a node to edit its content.</p></div>
          {regions.map(region => <div className="region-group" key={region}><div className="region-title"><span>⌑</span>{region}</div><TreeNodes nodes={document.regions[region]} selectedId={selectedId} onSelect={setSelectedId} /></div>)}
        </aside>
        <main className="canvas-area"><div className="canvas-toolbar"><div><span className="canvas-dot" /> Desktop canvas <span className="canvas-size">1440px</span></div><span className="canvas-hint">Click any element to select</span></div><div className="canvas-scroll"><PageView document={document} selectedId={selectedId} onSelect={setSelectedId} /></div></main>
        <aside className="sidebar properties"><div className="panel-heading"><span className="panel-kicker">INSPECTOR</span><h2>Properties</h2><p>Content for the selected node.</p></div>{selected ? <div className="property-body"><div className="selection-label"><span>{selected.type}</span><code>{selected.id}</code></div>{registry[selected.type].editable.map(key => <label className="field" key={key}><span>{key}</span>{key === 'level' ? <select value={selected.props.level || 2} onChange={event => setDocument(updateProps(document, selectedId, key, Number(event.target.value)))}>{[1,2,3,4,5,6].map(level => <option key={level} value={level}>H{level}</option>)}</select> : <input value={selected.props[key] || ''} onChange={event => setDocument(updateProps(document, selectedId, key, event.target.value))} />}</label>)}</div> : <div className="empty-selection"><div>◇</div><strong>Nothing selected</strong><p>Choose an item from Layers or click one on the canvas.</p></div>}</aside>
      </div>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
