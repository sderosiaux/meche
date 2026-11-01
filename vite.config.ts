import { defineConfig } from 'vitest/config';

// Relative base so dist/ works on GitHub Pages under /meche/.
export default defineConfig({
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
