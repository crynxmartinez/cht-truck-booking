import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The app imports through "@/", so tests of anything that does must resolve it.
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // Coverage is scoped to the pure rule modules so the 80% bar means
      // something. Gating on the whole repo would measure server actions and
      // pages that have no tests yet and say nothing about these changes.
      include: [
        'src/lib/pickup-schedule.ts',
        'src/lib/pickup-release.ts',
        'src/lib/truck-swap.ts',
        'src/lib/invariants.ts',
        'src/lib/overlap-guard.ts',
      ],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
