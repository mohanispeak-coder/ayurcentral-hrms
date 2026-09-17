// @ts-check
const { expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const AUTH_ENV = 'HRMS_STORAGE_STATE';

/**
 * Whether a Playwright storage-state file is configured (optional authenticated runs).
 * @returns {boolean}
 */
function hasAuthStorageConfigured() {
  const p = process.env[AUTH_ENV];
  if (!p) return false;
  return fs.existsSync(path.resolve(p));
}

/**
 * @param {import('@playwright/test').Page} page
 */
async function waitForShell(page) {
  await page.waitForSelector('#app.app-shell', { state: 'visible', timeout: 60_000 });
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<boolean>}
 */
async function isAuthenticated(page) {
  const app = page.locator('#app.app-shell.is-authed');
  return app.isVisible().catch(function () { return false; });
}

/**
 * Navigate via hash route (HRMS client router).
 * @param {import('@playwright/test').Page} page
 * @param {string} route
 */
async function gotoRoute(page, route) {
  const r = String(route || 'dashboard').replace(/^#/, '');
  await page.goto('/#' + r, { waitUntil: 'domcontentloaded' });
  await waitForShell(page);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').TestInfo} testInfo
 * @param {string} moduleSlug
 */
async function captureFailureScreenshot(page, testInfo, moduleSlug) {
  if (testInfo.status === testInfo.expectedStatus) return;
  const vp = (testInfo.project && testInfo.project.name) ? testInfo.project.name.replace(/^chromium-/, '') : 'unknown';
  const dir = path.join('test-results', 'screenshots', vp, moduleSlug || 'general');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, testInfo.title.replace(/[^\w.-]+/g, '_') + '.png');
  await page.screenshot({ path: file, fullPage: true }).catch(function () {});
  await testInfo.attach('failure-' + moduleSlug, { path: file, contentType: 'image/png' }).catch(function () {});
}

/**
 * documentElement.scrollWidth <= innerWidth (+1px tolerance for subpixel).
 * Also flags major layout containers that overflow horizontally.
 * @param {import('@playwright/test').Page} page
 */
async function assertNoHorizontalOverflow(page) {
  const result = await page.evaluate(function () {
    var tolerance = 1;
    var doc = document.documentElement;
    var pageOverflow = doc.scrollWidth > window.innerWidth + tolerance;
    var selectors = ['#app', '.main-wrap', '#main-content', '#page-content', '.content', '.header', '.app-header'];
    var containers = [];
    selectors.forEach(function (sel) {
      var el = document.querySelector(sel);
      if (!el) return;
      if (el.scrollWidth > el.clientWidth + tolerance) {
        containers.push({
          selector: sel,
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth
        });
      }
    });
    return {
      pageOverflow: pageOverflow,
      scrollWidth: doc.scrollWidth,
      innerWidth: window.innerWidth,
      containers: containers
    };
  });

  expect(
    result.pageOverflow,
    'Page horizontal overflow: scrollWidth=' + result.scrollWidth + ' innerWidth=' + result.innerWidth
  ).toBe(false);
  expect(
    result.containers,
    'Container overflow: ' + JSON.stringify(result.containers)
  ).toEqual([]);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} selector
 */
async function assertElementInViewport(page, selector) {
  const box = await page.locator(selector).boundingBox();
  expect(box, 'Element not found: ' + selector).not.toBeNull();
  const vp = page.viewportSize();
  expect(vp, 'viewportSize').not.toBeNull();
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 1);
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.y).toBeGreaterThanOrEqual(-1);
}

/**
 * @param {import('@playwright/test').Page} page
 */
async function waitForAuthenticatedWorkspace(page) {
  await waitForShell(page);
  await page.waitForSelector('#app.app-shell.is-authed', { timeout: 45_000 });
  await page.waitForSelector('#page-content:not(.hidden)', { timeout: 45_000 }).catch(function () {});
}

module.exports = {
  hasAuthStorageConfigured,
  waitForShell,
  isAuthenticated,
  gotoRoute,
  captureFailureScreenshot,
  assertNoHorizontalOverflow,
  assertElementInViewport,
  waitForAuthenticatedWorkspace,
  AUTH_ENV
};
