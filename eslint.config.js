import js from '@eslint/js';
import globals from 'globals';

export default [{
  ignores: ['**/dist/**', 'generated/**', 'node_modules/**']
}, {
  files: ['**/*.{js,jsx}'],
  languageOptions: {
    ecmaVersion: 'latest', sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
    globals: { ...globals.browser, ...globals.node }
  },
  rules: { ...js.configs.recommended.rules, 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }] }
}];
