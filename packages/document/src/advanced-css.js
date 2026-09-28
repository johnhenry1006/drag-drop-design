import * as cssTree from 'css-tree';
import { styleName, supportedStyles } from './style-support.js';

export function parseAdvancedCss(source) {
  if (typeof source !== 'string') throw new Error('Advanced CSS must be text');
  if (!source.trim()) return '';
  if (/[{}@]/.test(source)) throw new Error('Advanced CSS accepts declarations only; selectors and at-rules are not allowed');
  let parseError;
  const ast = cssTree.parse(source, { context: 'declarationList', onParseError(error) { parseError = error; } });
  if (parseError) throw new Error(`Invalid Advanced CSS syntax: ${parseError.message}`);
  const declarations = [];
  ast.children.forEach(declaration => {
    if (declaration.type !== 'Declaration') throw new Error('Advanced CSS accepts property: value declarations only');
    const property = declaration.property.toLowerCase();
    if (!supportedStyles.has(styleName(property))) throw new Error(`CSS property ${property} cannot export consistently`);
    if (declaration.important) throw new Error('Advanced CSS does not allow !important');
    cssTree.walk(declaration.value, node => {
      if (node.type === 'Url' || (node.type === 'Function' && /^(url|image-set|expression|var|env)$/i.test(node.name))) {
        throw new Error('Advanced CSS cannot load resources or evaluate external values');
      }
    });
    const match = cssTree.lexer.matchProperty(property, declaration.value);
    if (match.error) throw new Error(`Invalid value for ${property}: ${match.error.message}`);
    declarations.push(cssTree.generate(declaration));
  });
  if (!declarations.length) throw new Error('Advanced CSS needs at least one declaration');
  return declarations.join(';');
}
