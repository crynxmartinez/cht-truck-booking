import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // Coverage is scoped to the pure scheduling logic so the 80% bar means
      // something. Gating on the whole repo would measure server actions and
      // pages that have no tests yet and say nothing about this change.
      include: ['src/lib/pickup-schedule.ts'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
