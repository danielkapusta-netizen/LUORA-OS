import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Only exists inside the Workers runtime; see the stub.
      'cloudflare:workers': fileURLToPath(new URL('./tests/stubs/cloudflare-workers.ts', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    // Processed by Vite (not loaded natively by Node), so the `cloudflare:workers` alias above applies to it.
    server: { deps: { inline: ['@cloudflare/workers-oauth-provider'] } },
    // The database test resets tables, so files run one at a time.
    fileParallelism: false,
  },
});
