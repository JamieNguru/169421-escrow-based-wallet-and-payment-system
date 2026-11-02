import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: globals.node },
  },
  {
    rules: {
      // Firestore document data is untyped; surface it without failing CI.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['tests/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
