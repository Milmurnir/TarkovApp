import { defineConfig } from 'vitest/config';

// Kept apart from vite.config.ts so the dev server's proxy setup stays out of tests.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
