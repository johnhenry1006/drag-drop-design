import { useState } from 'react';

const dateLabel = value => new Date(value).toLocaleString();

export function ProjectManager({ projects, currentProjectId, onClose, onCreate, onOpen, onRename, onDelete, busy, error }) {
  const [search, setSearch] = useState('');
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [deletingId, setDeletingId] = useState(null);
  const [confirmation, setConfirmation] = useState('');
  const visible = projects.filter(project => project.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const submitCreate = async event => { event.preventDefault(); if (await onCreate(newName.trim())) setNewName(''); };
  const keepFocus = event => {
    if (event.key === 'Escape') { onClose(); return; }
    if (event.key !== 'Tab') return;
    const controls = [...event.currentTarget.querySelectorAll('button:not(:disabled), input:not(:disabled)')];
    if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
    else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
  };
  return <div className="project-manager-backdrop"><section className="project-manager" role="dialog" aria-modal="true" aria-label="Manage projects" onKeyDown={keepFocus}>
    <div className="project-manager-heading"><div><h2>Projects</h2><p>Create, open, rename, or delete a project.</p></div><button type="button" aria-label="Close projects" onClick={onClose}>×</button></div>
    {error && <p className="field-error" role="alert">{error}</p>}
    <form className="project-manager-create" onSubmit={submitCreate}><label>Project name<input value={newName} onChange={event => setNewName(event.target.value)} maxLength={120} required /></label><button type="submit" disabled={busy || !newName.trim()}>Create project</button></form>
    <label className="project-manager-search">Search projects<input type="search" autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder="Search by name" /></label>
    {!projects.length ? <p className="project-manager-empty">No projects yet. Create one to start building.</p> : !visible.length ? <p className="project-manager-empty">No projects match “{search}”.</p> : <ul className="project-manager-list">{visible.map(project => <li key={project.id} className={project.id === currentProjectId ? 'active' : ''}>
      <div className="project-manager-row"><div><strong>{project.name}</strong><span>{project.pageCount} {project.pageCount === 1 ? 'page' : 'pages'} · Updated {dateLabel(project.lastUpdatedAt)} · {project.access}</span></div><div className="project-manager-actions"><button type="button" disabled={busy || project.id === currentProjectId} onClick={() => onOpen(project.id)}>Open</button><button type="button" disabled={busy || Boolean(project.systemKey)} onClick={() => { setEditingId(project.id); setEditName(project.name); setDeletingId(null); }}>Rename</button><button type="button" className="danger" disabled={busy || Boolean(project.systemKey)} onClick={() => { setDeletingId(project.id); setConfirmation(''); setEditingId(null); }}>Delete</button></div></div>
      {editingId === project.id && <form className="project-manager-inline" onSubmit={async event => { event.preventDefault(); if (await onRename(project, editName.trim())) setEditingId(null); }}><label>New name<input value={editName} maxLength={120} required onChange={event => setEditName(event.target.value)} /></label><button disabled={busy || !editName.trim()}>Save name</button><button type="button" onClick={() => setEditingId(null)}>Cancel</button></form>}
      {deletingId === project.id && <div className="project-manager-delete"><p>Delete “{project.name}”? This permanently removes {project.pageCount} {project.pageCount === 1 ? 'page' : 'pages'}, {project.revisionCount} {project.revisionCount === 1 ? 'revision' : 'revisions'}, and {project.assetCount} {project.assetCount === 1 ? 'asset' : 'assets'}. Exported copies are unaffected. Type the project name to confirm.</p><label>Confirm project name<input value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label><div><button type="button" className="danger" disabled={busy || confirmation !== project.name} onClick={async () => { if (await onDelete(project, confirmation)) { setDeletingId(null); setConfirmation(''); } }}>Delete project permanently</button><button type="button" onClick={() => setDeletingId(null)}>Cancel</button></div></div>}
    </li>)}</ul>}
  </section></div>;
}
