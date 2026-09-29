const containerChildren = ['Section', 'Container', 'Layout', 'Navigation', 'Heading', 'Text', 'Image', 'Button', 'Link', 'Card'];

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
  Link: { kind: 'element', tag: 'a', defaults: { text: 'Link', href: '#' }, editable: ['text', 'href'], children: [], renderer: 'button', exports: ['html', 'react', 'vue'], exportNote: 'Exports as a link; actions and state are not supported.' }
});

export const breakpoints = ['desktop', 'tablet', 'mobile'];
export const regions = ['header', 'main', 'footer'];
