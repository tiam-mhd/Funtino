import { FlatCompat } from '@eslint/eslintrc';
import { globalIgnores } from 'eslint/config';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

export default [
  globalIgnores([
    '**/.next/**',
    '**/node_modules/**',
    '**/out/**',
    '**/coverage/**',
    '**/dist/**',
    '**/generated/**',
    '**/next-env.d.ts',
  ]),
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      '@next/next/no-html-link-for-pages': 'off',
    },
  },
];
