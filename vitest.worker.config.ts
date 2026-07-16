import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

const directory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      main: './worker/index.ts',
      miniflare: {
        compatibilityDate: '2026-07-16',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: ['DB'],
        r2Buckets: ['CARD_IMAGES'],
        serviceBindings: { ASSETS: () => new Response('Not found', { status: 404 }) },
        bindings: {
          ADMIN_PASSWORD: 'correct-horse-battery-staple',
          SESSION_SECRET: 'this-is-a-test-secret-with-more-than-32-characters',
          ALLOWED_ORIGIN: 'http://example.com',
          TEST_MIGRATIONS: await readD1Migrations(path.join(directory, 'migrations')),
        },
      },
    })),
  ],
  test: { include: ['test/worker/**/*.test.ts'], setupFiles: ['./test/worker/setup.ts'] },
});
