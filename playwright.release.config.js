import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'mobile-release.spec.js',
  outputDir: 'test-results-release',
  timeout: 60000,
  retries: 0,
  use: {
    ...devices['iPhone 13'],
    viewport: { width: 844, height: 390 },
    browserName: 'chromium',
    baseURL: 'http://127.0.0.1:4173',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: false,
  },
});
