import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config.js';
import { specSelection } from './tools/e2eLanes.js';

// Landscape-phone device matrix for the lanes in tests/e2e/lanes.json that name this
// config.
export default defineConfig({
  ...base,
  ...specSelection('playwright.compact.config.js'),
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
