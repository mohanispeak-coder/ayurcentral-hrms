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
 * Google Apps Script often shows a redirect / "Continue" page before the app HTML.
 * @param {import('@playwright/test').Page} page
 */
async function settleGasNavigation_(page) {
  for (var attempt = 0; attempt < 6; attempt++) {
    if (await page.locator('#app.app-shell').isVisible().catch(function () { return false; })) {
      return;
    }
    var url = page.url();
    if (/accounts\.google\.com/i.test(url)) {
      throw new Error(
        'Browser opened Google Sign-In instead of HRMS. ' +
          'For basic load tests, temporarily remove HRMS_STORAGE_STATE from .env, or refresh auth with npm run test:e2e:auth. ' +
          'URL: ' + url
      );
    }
    var gasLink = page.locator('a[href*="googleusercontent.com"], a[href*="/macros/echo"]').first();
    if (await gasLink.isVisible({ timeout: 2500 }).catch(function () { return false; })) {
      await gasLink.click();
      await page.waitForLoadState('domcontentloaded');
      continue;
    }
    var textLink = page.getByRole('link', { name: /continue|open|go to|click here|advanced/i }).first();
    if (await textLink.isVisible({ timeout: 1500 }).catch(function () { return false; })) {
      await textLink.click();
      await page.waitForLoadState('domcontentloaded');
      continue;
    }
    await page.waitForTimeout(1200);
  }
}

/**
 * Open HRMS home (handles GAS redirect interstitial).
 * @param {import('@playwright/test').Page} page
 * @param {string=} hashPath e.g. '/' or '/#dashboard'
 */
async function openHrms(page, hashPath) {
  hashPath = hashPath == null ? '/' : hashPath;
  await page.goto(hashPath, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await settleGasNavigation_(page);
  await waitForShell(page);
}

/**
 * @param {import('@playwright/test').Page} page
 */
async function waitForShell(page) {
  try {
    await page.waitForSelector('#app.app-shell', { state: 'visible', timeout: 90_000 });
  } catch (err) {
    var title = await page.title().catch(function () { return ''; });
    var url = page.url();
    var body = await page.locator('body').innerText().catch(function () { return ''; });
    body = String(body).replace(/\s+/g, ' ').trim().slice(0, 240);
    throw new Error(
      'HRMS shell (#app.app-shell) not found.\nURL: ' + url + '\nTitle: ' + title + '\nBody: ' + body
    );
  }
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
  await openHrms(page, '/#' + r);
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
  openHrms,
  waitForShell,
  isAuthenticated,
  gotoRoute,
  captureFailureScreenshot,
  assertNoHorizontalOverflow,
  assertElementInViewport,
  waitForAuthenticatedWorkspace,
  AUTH_ENV
};
