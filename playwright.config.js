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
  // Tests, not files, are the unit of work: a long spec file is spread over the
  // workers and shards instead of holding one worker for its whole length. Every test
  // has its own browser context and no spec shares state between tests (no serial
  // groups, no beforeAll), so the order inside a file never matters.
  fullyParallel: true,
  reporter: [[process.env.CI ? 'dot' : 'list'], ['./tools/e2eDurationReporter.js']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    browserName: 'chromium',
    headless: true,
    screenshot: 'only-on-failure',
    // A trace is recorded for every attempt and kept only when it fails. Its DOM
    // snapshots (one before and after each action) cost about a fifth of a test's time
    // on a software-rendered page; the screencast, actions, console and network stay,
    // and a failure still gets its screenshot.
    trace: { mode: 'retain-on-failure', snapshots: false },
    viewport: { width: 640, height: 480 },
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: true,
    timeout: 15_000,
  },
});
