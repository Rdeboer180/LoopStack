import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    // desktop/ has its own vitest config; its electron tests are node:test files; .claude/ holds repo copies.
    exclude: [...configDefaults.exclude, 'desktop/**', '.claude/**'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});
