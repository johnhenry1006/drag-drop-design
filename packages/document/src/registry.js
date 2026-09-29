const containerChildren = ['Section', 'Container', 'Layout', 'Navigation', 'Heading', 'Text', 'Image', 'Button', 'Link', 'Card', 'Avatar', 'Badge', 'Chip', 'Icons'];

export const registry = Object.freeze({
  Section: { kind: 'container', tag: 'section', defaults: { label: 'Section' }, editable: ['label'], children: containerChildren, renderer: 'container', exports: ['html', 'react', 'vue'] },
  Container: { kind: 'container', tag: 'div', defaults: { label: 'Container' }, editable: ['label'], children: containerChildren, renderer: 'container', exports: ['html', 'react', 'vue'] },
  Layout: { kind: 'container', tag: 'div', defaults: { label: 'Layout' }, editable: ['label'], children: containerChildren, renderer: 'layout', exports: ['html', 'react', 'vue'] },
  Card: { kind: 'container', tag: 'article', defaults: { label: 'Card' }, editable: ['label'], children: containerChildren, renderer: 'container', exports: ['html', 'react', 'vue'], exportNote: 'Static article with editable children; no built-in interaction.' },
  Navigation: { kind: 'container', tag: 'nav', defaults: { label: 'Navigation' }, editable: ['label'], children: containerChildren, renderer: 'container', exports: ['html', 'react', 'vue'] },
  Heading: { kind: 'element', tag: 'h2', defaults: { text: 'Heading', level: 2 }, editable: ['text', 'level'], children: [], renderer: 'heading', exports: ['html', 'react', 'vue'] },
  Text: { kind: 'element', tag: 'p', defaults: { text: 'Text' }, editable: ['text'], children: [], renderer: 'text', exports: ['html', 'react', 'vue'] },
  Image: { kind: 'element', tag: 'img', defaults: { src: '', alt: '' }, editable: ['src', 'alt'], children: [], renderer: 'image', exports: ['html', 'react', 'vue'] },
  Button: { kind: 'element', tag: 'a', defaults: { text: 'Button', href: '#' }, editable: ['text', 'href'], children: [], renderer: 'button', exports: ['html', 'react', 'vue'], exportNote: 'Exports as a link; actions, form submission, and state are not supported.' },
  Link: { kind: 'element', tag: 'a', defaults: { text: 'Link', href: '#' }, editable: ['text', 'href'], children: [], renderer: 'button', exports: ['html', 'react', 'vue'], exportNote: 'Exports as a link; actions and state are not supported.' },
  Avatar: { kind: 'element', tag: 'span', defaults: { src: '', alt: '', name: 'Alex Morgan', initials: 'AM', shape: 'circle', size: 48 }, editable: ['src', 'alt', 'name', 'initials', 'shape', 'size'], children: [], renderer: 'avatar', exports: ['html', 'react', 'vue'], exportNote: 'Image and initials fallback are supported. Remote images still depend on their host.' },
  Badge: { kind: 'element', tag: 'span', defaults: { content: 'Inbox', text: '', count: 3, maxCount: 99, color: '#d4344a', placement: 'topRight' }, editable: ['content', 'text', 'count', 'maxCount', 'color', 'placement'], children: [], renderer: 'badge', exports: ['html', 'react', 'vue'], exportNote: 'Display-only badge anchored to its own text; arbitrary child anchors are not supported.' },
  Chip: { kind: 'element', tag: 'span', defaults: { label: 'Featured', icon: 'star' }, editable: ['label', 'icon'], children: [], renderer: 'chip', exports: ['html', 'react', 'vue'], exportNote: 'Display-only chip with an optional bundled icon. Dismissal is not supported.' },
  Icons: { kind: 'element', tag: 'svg', defaults: { icon: 'star', name: 'Star', size: 24, color: '#334155' }, editable: ['icon', 'name', 'size', 'color'], children: [], renderer: 'icon', exports: ['html', 'react', 'vue'], exportNote: 'Five bundled CC0 icons; icon IDs are fixed and custom SVG is not supported.' }
});

export const breakpoints = ['desktop', 'tablet', 'mobile'];
export const regions = ['header', 'main', 'footer'];
