import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config.js';

export default defineConfig({
  ...base,
  testMatch: 'compact-route-roster.spec.js',
  projects: [
    {
      name: 'iphone-se-landscape',
      use: { ...devices['iPhone SE'], viewport: { width: 667, height: 375 } },
    },
    {
      name: 'iphone-landscape',
      use: { ...devices['iPhone 13'], viewport: { width: 844, height: 390 } },
    },
  ],
});
