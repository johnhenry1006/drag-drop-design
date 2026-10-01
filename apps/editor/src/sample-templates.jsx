import { useEffect, useState } from 'react';

const defaultDetails = template => ({ name: `${template.name} copy`, path: `/${template.sampleKey}-copy` });

export function SampleTemplates({ templates, busy, onView, onUse }) {
  if (!templates.length) return null;
  return <section className="sample-templates" aria-label="Sample templates"><h3>Sample templates</h3><p>System reference templates are read only. Use a template to make an editable copy in your project.</p><ul>{templates.map(template => <li key={template.id}><div><strong>{template.name}</strong> <span className="sample-badge">Sample · Read-only</span><small>{template.path}</small></div><div className="project-manager-actions"><button type="button" disabled={busy} onClick={() => onView(template.id)}>Preview / View</button><button type="button" disabled={busy} onClick={() => onUse(template.id)}>Use this template</button></div></li>)}</ul></section>;
}

export function TemplateCopyDialog({ templates, projects, initialId, busy, error, onClose, onCopy }) {
  const [selected, setSelected] = useState(() => new Set([initialId]));
  const [destinationId, setDestinationId] = useState(() => projects.find(project => !project.systemKey)?.id || '');
  const [details, setDetails] = useState(() => Object.fromEntries(templates.map(template => [template.id, defaultDetails(template)])));
  useEffect(() => { setSelected(new Set([initialId])); }, [initialId]);
  const editableProjects = projects.filter(project => !project.systemKey);
  const dependencies = templates.filter(template => selected.has(template.id)).flatMap(template => template.requires || []).filter(id => !selected.has(id));
  const toggle = id => setSelected(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const setDetail = (id, key, value) => setDetails(previous => ({ ...previous, [id]: { ...previous[id], [key]: value } }));
  const submit = event => {
    event.preventDefault();
    onCopy(destinationId, templates.filter(template => selected.has(template.id)).map(template => ({ samplePageId: template.id, ...details[template.id] })), initialId);
  };
  return <div className="project-manager-backdrop"><section className="project-manager template-copy-dialog" role="dialog" aria-modal="true" aria-label="Use sample template"><div className="project-manager-heading"><div><h2>Use sample template</h2><p>Choose the pages to copy. The originals stay read only.</p></div><button type="button" aria-label="Close template copy" onClick={onClose}>×</button></div>
    {error && <p className="field-error" role="alert">{error}</p>}
    <form onSubmit={submit}><label>Destination project<select value={destinationId} onChange={event => setDestinationId(event.target.value)} required><option value="">Choose a project</option>{editableProjects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>{!editableProjects.length && <p>Create an editable project in Projects, then return here to use a template.</p>}
      <fieldset><legend>Pages to copy</legend>{templates.map(template => <div className="template-copy-page" key={template.id}><label><input type="checkbox" checked={selected.has(template.id)} onChange={() => toggle(template.id)} /> {template.name} <span className="sample-badge">Sample · Read-only</span></label>{selected.has(template.id) && <div className="template-copy-fields"><label>Page name<input value={details[template.id].name} maxLength={120} required onChange={event => setDetail(template.id, 'name', event.target.value)} /></label><label>Page path<input value={details[template.id].path} required onChange={event => setDetail(template.id, 'path', event.target.value)} /></label></div>}</div>)}</fieldset>
      {dependencies.length > 0 && <p className="field-error">This selection links to {dependencies.map(id => templates.find(template => template.id === id)?.name || id).join(', ')}. Select those pages too.</p>}
      <div className="project-manager-actions"><button type="submit" disabled={busy || !destinationId || !selected.size || dependencies.length > 0}>{busy ? 'Copying…' : 'Create editable copy'}</button><button type="button" onClick={onClose}>Cancel</button></div>
    </form>
  </section></div>;
}
