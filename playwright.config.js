import { defineConfig } from '@playwright/test';
import { specSelection } from './tools/e2eLanes.js';

// E2E_PORT lets several checkouts (git worktrees) run their own dev servers side by
// side. With reuseExistingServer, a shared port would silently test another
// checkout's code.
const PORT = Number(process.env.E2E_PORT || 3000);

export default defineConfig({
  testDir: './tests/e2e',
  // Which specs: tests/e2e/lanes.json. `npm run test:e2e:lane -- <lane>` runs one CI
  // lane; without a lane this config runs every spec except those owned by another
  // config (production-build specs: playwright.release.config.js).
  ...specSelection('playwright.config.js'),
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: `http://localhost:${PORT}`,
    browserName: 'chromium',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    viewport: { width: 640, height: 480 },
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: true,
    timeout: 15_000,
  },
});
