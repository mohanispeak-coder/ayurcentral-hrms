// @ts-check
const { defineConfig } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const baseURL = process.env.HRMS_BASE_URL || '';
if (!baseURL) {
  console.error(
    '\nHRMS_BASE_URL is required for Playwright tests.\n' +
      'Example (PowerShell): $env:HRMS_BASE_URL="https://script.google.com/macros/s/…/exec"\n' +
      'Example (bash):       HRMS_BASE_URL="https://…" npm run test:e2e\n'
  );
  process.exit(1);
}

/** @type {import('@playwright/test').PlaywrightTestConfig['projects']} */
const VIEWPORTS = [
  { label: '320', width: 320, height: 800 },
  { label: '360', width: 360, height: 800 },
  { label: '375', width: 375, height: 812 },
  { label: '390', width: 390, height: 844 },
  { label: '414', width: 414, height: 896 },
  { label: '768', width: 768, height: 1024 },
  { label: '1024', width: 1024, height: 768 },
  { label: '1366', width: 1366, height: 768 }
];

const storagePath = process.env.HRMS_STORAGE_STATE || '';
const storageState =
  storagePath && fs.existsSync(path.resolve(storagePath)) ? path.resolve(storagePath) : undefined;

module.exports = defineConfig({
  testDir: path.join(__dirname, 'tests', 'browser'),
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }]
  ],
  outputDir: 'test-results',
  use: {
    baseURL,
    browserName: 'chromium',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
    ...(storageState ? { storageState } : {})
  },
  projects: VIEWPORTS.map(function (vp) {
    return {
      name: 'chromium-' + vp.label,
      use: {
        viewport: { width: vp.width, height: vp.height }
      }
    };
  })
});
