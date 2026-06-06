import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  // Tests share a single backend container with global SQLite state, so they
  // must run serially to avoid trade/position races between specs.
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://localhost:8000',
    headless: true,
  },
  reporter: [['list'], ['html', { open: 'never' }]],
});
