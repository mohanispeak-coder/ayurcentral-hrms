// @ts-check
const { expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const AUTH_ENV = 'HRMS_STORAGE_STATE';
const REPO_ROOT = path.join(__dirname, '..', '..');

function ensureEnvLoaded_() {
  try {
    require('./load-env').loadRepoEnv(REPO_ROOT);
  } catch (ignore) {}
}

/**
 * Full web app URL (Google Apps Script /exec). Required because page.goto('/')
 * against a path baseURL resolves to https://script.google.com/ — not your app.
 * @returns {string}
 */
function getHrmsBaseUrl() {
  ensureEnvLoaded_();
  return (process.env.HRMS_BASE_URL || '').trim().replace(/\/$/, '');
}

/**
 * @param {string=} hashPath '/' | '#dashboard' | '/#my-leave'
 * @returns {string}
 */
function buildHrmsUrl(hashPath) {
  var base = getHrmsBaseUrl();
  if (!base) {
    throw new Error('HRMS_BASE_URL is missing (set in repo-root .env).');
  }
  if (!hashPath || hashPath === '/') return base;
  var p = String(hashPath);
  if (p.charAt(0) === '#') return base + p;
  if (p.indexOf('/#') === 0) return base + p.slice(1);
  return base + p;
}

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
 * HRMS is usually rendered inside a GAS iframe; #app and sessionStorage live there.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<import('@playwright/test').Frame|null>}
 */
async function findHrmsAppFrame_(page) {
  var frames = page.frames();
  for (var i = 0; i < frames.length; i++) {
    var frame = frames[i];
    try {
      if ((await frame.locator('#app.app-shell').count()) > 0) return frame;
    } catch (ignore) {}
  }
  return null;
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ timeout?: number }} [opts]
 * @returns {Promise<import('@playwright/test').Frame>}
 */
async function getHrmsAppFrame(page, opts) {
  opts = opts || {};
  var timeout = opts.timeout != null ? opts.timeout : 90_000;
  var deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    var frame = await findHrmsAppFrame_(page);
    if (frame) return frame;
    await page.waitForTimeout(250);
  }
  throw new Error('HRMS app frame (#app.app-shell) not found in any frame.');
}

/**
 * Inspect every frame (for auth:save and diagnostics).
 * @param {import('@playwright/test').Page} page
 */
async function scanSessionStorageAcrossFrames(page) {
  var frames = [];
  var all = page.frames();
  for (var i = 0; i < all.length; i++) {
    var frame = all[i];
    var info = await frame
      .evaluate(function () {
        return {
          origin: location.origin,
          href: location.href,
          hasApp: !!document.getElementById('app'),
          authed: !!(
            document.getElementById('app') &&
            document.getElementById('app').classList.contains('is-authed')
          ),
          hasToken: !!sessionStorage.getItem('hrms_session_token')
        };
      })
      .catch(function () {
        return null;
      });
    if (info) frames.push(info);
  }
  return {
    topUrl: page.url(),
    frames: frames,
    hasToken: frames.some(function (f) {
      return f.hasToken;
    }),
    tokenFrame: frames.find(function (f) {
      return f.hasToken;
    }),
    authedFrame: frames.find(function (f) {
      return f.authed;
    })
  };
}

/**
 * Google Apps Script often shows a redirect / "Continue" page before the app HTML.
 * @param {import('@playwright/test').Page} page
 */
async function settleGasNavigation_(page) {
  await page.waitForURL(/script\.google\.com|googleusercontent\.com/i, { timeout: 45_000 }).catch(function () {});
  for (var attempt = 0; attempt < 8; attempt++) {
    if (await findHrmsAppFrame_(page)) {
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
async function waitForHrmsBootstrap_(page) {
  var frame = await getHrmsAppFrame(page);
  await frame.waitForFunction(
    function () {
      var app = document.getElementById('app');
      if (!app || !app.classList.contains('app-shell')) return false;
      if (app.classList.contains('is-authed')) return true;
      var authState = document.getElementById('auth-state');
      if (authState && !authState.classList.contains('hidden')) return true;
      var setup = document.getElementById('setup-state');
      if (setup && !setup.classList.contains('hidden')) return true;
      var unauth = document.getElementById('unauthorized-state');
      if (unauth && !unauth.classList.contains('hidden')) return true;
      return false;
    },
    { timeout: 90_000 }
  );
  var loading = frame.locator('#loading-state:not(.hidden)');
  if (await loading.isVisible().catch(function () { return false; })) {
    await loading.waitFor({ state: 'hidden', timeout: 90_000 }).catch(function () {});
  }
}

async function openHrms(page, hashPath) {
  hashPath = hashPath == null ? '/' : hashPath;
  var target = buildHrmsUrl(hashPath);
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await settleGasNavigation_(page);
  await waitForShell(page);
  await waitForHrmsBootstrap_(page);
}

/**
 * @param {import('@playwright/test').Page} page
 */
async function waitForShell(page) {
  try {
    var frame = await getHrmsAppFrame(page);
    await frame.locator('#app.app-shell').waitFor({ state: 'visible', timeout: 90_000 });
  } catch (err) {
    var title = await page.title().catch(function () { return ''; });
    var url = page.url();
    var body = await page.locator('body').innerText().catch(function () { return ''; });
    body = String(body).replace(/\s+/g, ' ').trim().slice(0, 240);
    var scan = await scanSessionStorageAcrossFrames(page).catch(function () {
      return { frames: [] };
    });
    throw new Error(
      'HRMS shell (#app.app-shell) not found in any frame.\nURL: ' +
        url +
        '\nTitle: ' +
        title +
        '\nBody: ' +
        body +
        '\nFrames scanned: ' +
        JSON.stringify(scan.frames, null, 2)
    );
  }
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<boolean>}
 */
async function isAuthenticated(page) {
  var frame = await findHrmsAppFrame_(page);
  if (!frame) return false;
  return frame.locator('#app.app-shell.is-authed').isVisible().catch(function () {
    return false;
  });
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
  var frame = await getHrmsAppFrame(page);
  const result = await frame.evaluate(function () {
    var tolerance = 4;
    var app = document.querySelector('#app.app-shell');
    var root = app || document.documentElement;
    var pageOverflow = root.scrollWidth > root.clientWidth + tolerance;
    var selectors = ['#app', '.main-wrap', '#main-content', '#page-content', '.content'];
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
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      innerWidth: window.innerWidth,
      containers: containers,
      scopedToApp: !!app
    };
  });

  expect(
    result.pageOverflow,
    'HRMS horizontal overflow (' + (result.scopedToApp ? '#app' : 'document') + '): scrollWidth=' +
      result.scrollWidth + ' clientWidth=' + result.clientWidth + ' innerWidth=' + result.innerWidth
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
  var frame = await getHrmsAppFrame(page);
  const box = await frame.locator(selector).boundingBox();
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
/**
 * Wait until OTP bootstrap finished (session token + is-authed).
 * @param {import('@playwright/test').Page} page
 */
async function waitForClientAuthed(page) {
  var frame = await getHrmsAppFrame(page, { timeout: 120_000 });
  await frame.waitForFunction(
    function () {
      var app = document.getElementById('app');
      if (app && app.classList.contains('is-authed')) return true;
      return !!sessionStorage.getItem('hrms_session_token');
    },
    { timeout: 120_000 }
  );
  await frame.locator('#app.app-shell.is-authed').waitFor({ state: 'visible', timeout: 120_000 });
  var hasToken = await frame.evaluate(function () {
    return !!sessionStorage.getItem('hrms_session_token');
  });
  if (!hasToken) {
    throw new Error(
      'UI looks signed in but hrms_session_token is missing in the HRMS iframe sessionStorage. ' +
        'Re-run npm run test:e2e:auth:save after login (see docs/BROWSER_TESTING.md).'
    );
  }
}

async function waitForAuthenticatedWorkspace(page) {
  await waitForShell(page);
  await waitForHrmsBootstrap_(page);
  await waitForClientAuthed(page);
  var frame = await getHrmsAppFrame(page);
  await frame.locator('#page-content:not(.hidden)').waitFor({ state: 'visible', timeout: 90_000 });
}

/**
 * Wait until client router has painted module content (post google.script.run).
 * @param {import('@playwright/test').Page} page
 * @param {RegExp|string=} textHint optional substring in #page-content
 */
async function waitForModulePaint(page, textHint) {
  var frame = await getHrmsAppFrame(page);
  await frame.locator('#page-content:not(.hidden)').waitFor({ state: 'visible', timeout: 60_000 });
  if (textHint) {
    await expect(frame.locator('#page-content')).toContainText(textHint, { timeout: 60_000 });
  }
  await frame.waitForFunction(
    function () {
      var el = document.getElementById('page-content');
      if (!el || el.classList.contains('hidden')) return false;
      return el.innerText && el.innerText.trim().length > 20;
    },
    { timeout: 60_000 }
  );
}

module.exports = {
  hasAuthStorageConfigured,
  getHrmsBaseUrl,
  buildHrmsUrl,
  openHrms,
  waitForShell,
  getHrmsAppFrame,
  scanSessionStorageAcrossFrames,
  isAuthenticated,
  gotoRoute,
  captureFailureScreenshot,
  assertNoHorizontalOverflow,
  assertElementInViewport,
  waitForAuthenticatedWorkspace,
  waitForClientAuthed,
  waitForModulePaint,
  AUTH_ENV
};
