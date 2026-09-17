// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const {
  hasAuthStorageConfigured,
  openHrms,
  gotoRoute,
  captureFailureScreenshot,
  assertNoHorizontalOverflow,
  assertElementInViewport,
  waitForAuthenticatedWorkspace,
  isAuthenticated
} = require('./helpers');

const authStoragePath = (function () {
  var p = process.env.HRMS_STORAGE_STATE;
  if (!p) return null;
  var abs = path.resolve(p);
  return fs.existsSync(abs) ? abs : null;
})();

test.describe('HRMS browser smoke', function () {
  test.afterEach(async function ({ page }, testInfo) {
    const title = testInfo.title.toLowerCase();
    var mod = 'general';
    if (title.indexOf('leave') >= 0) mod = 'my-leave';
    else if (title.indexOf('dashboard') >= 0) mod = 'dashboard';
    else if (title.indexOf('employee') >= 0) mod = 'employees';
    else if (title.indexOf('navigation') >= 0 || title.indexOf('sidebar') >= 0) mod = 'navigation';
    else if (title.indexOf('ask hr') >= 0) mod = 'ask-hr';
    await captureFailureScreenshot(page, testInfo, mod);
  });

  test('HRMS loads successfully', async function ({ page }) {
    await openHrms(page, '/');
    await expect(page.locator('#app')).toBeVisible();
    const authed = await isAuthenticated(page);
    if (authed) {
      await expect(page.locator('#main-content')).toBeVisible();
    } else {
      await expect(page.locator('#auth-step-email, #setup-state, #unauthorized-state').first()).toBeVisible();
    }
  });

  test('no horizontal page overflow on load', async function ({ page }) {
    await openHrms(page, '/');
    await page.waitForTimeout(500);
    await assertNoHorizontalOverflow(page);
  });

  test.describe('authenticated workspace', function () {
    if (authStoragePath) {
      test.use({ storageState: authStoragePath });
    }

    test.beforeEach(async function ({ page }, testInfo) {
      if (!hasAuthStorageConfigured()) {
        testInfo.skip(true, 'Set HRMS_STORAGE_STATE to a Playwright storage file (see docs/BROWSER_TESTING.md).');
      }
      await openHrms(page, '/#dashboard');
      const authed = await isAuthenticated(page);
      if (!authed) {
        testInfo.skip(true, 'Storage state missing or expired — re-run auth capture (docs/BROWSER_TESTING.md).');
      }
      await waitForAuthenticatedWorkspace(page);
    });

    test('sidebar opens and closes on mobile', async function ({ page }) {
      const toggle = page.locator('#sidebar-toggle');
      await expect(toggle).toBeVisible();
      await toggle.click();
      await expect(page.locator('#sidebar.open, .app-sidebar.open')).toBeVisible();
      const backdrop = page.locator('#sidebar-backdrop.open');
      await expect(backdrop).toBeVisible();
      await backdrop.click();
      await expect(page.locator('#sidebar.open, .app-sidebar.open')).toHaveCount(0);
      await assertNoHorizontalOverflow(page);
    });

    test('dashboard renders without overflow', async function ({ page }) {
      await gotoRoute(page, 'dashboard');
      await page.waitForSelector('#page-content:not(.hidden)', { timeout: 45_000 });
      await expect(page.locator('#page-content')).toBeVisible();
      await page.waitForTimeout(800);
      await assertNoHorizontalOverflow(page);
    });

    test('my leave renders without overflow', async function ({ page }) {
      await gotoRoute(page, 'my-leave');
      await page.waitForSelector('#page-content:not(.hidden)', { timeout: 45_000 });
      await expect(page.locator('#page-content')).toContainText(/leave/i);
      await page.waitForTimeout(1200);
      await assertNoHorizontalOverflow(page);
    });

    test('employee directory renders if accessible', async function ({ page }) {
      await gotoRoute(page, 'employees');
      await page.waitForTimeout(1500);
      const denied = page.locator('#unauthorized-state:not(.hidden), .alert-danger');
      const pageContent = page.locator('#page-content:not(.hidden)');
      if (await denied.isVisible().catch(function () { return false; })) {
        test.skip(true, 'Current session cannot access Employees (RBAC).');
      }
      await expect(pageContent).toBeVisible();
      await assertNoHorizontalOverflow(page);
    });

    test('Ask HR button stays inside viewport', async function ({ page }) {
      await gotoRoute(page, 'dashboard');
      await page.waitForTimeout(1000);
      const fab = page.locator('#ask-hr-fab:not(.hidden)');
      if (!(await fab.isVisible().catch(function () { return false; }))) {
        test.skip(true, 'Ask HR FAB not visible for this role/session.');
      }
      await assertElementInViewport(page, '#ask-hr-fab:not(.hidden)');
    });

    test('main content does not extend beyond viewport', async function ({ page }) {
      await gotoRoute(page, 'dashboard');
      await page.waitForSelector('#page-content:not(.hidden)', { timeout: 45_000 });
      const metrics = await page.evaluate(function () {
        var main = document.querySelector('#page-content') || document.querySelector('.content');
        if (!main) return { ok: false, reason: 'no main' };
        var rect = main.getBoundingClientRect();
        return {
          ok: rect.right <= window.innerWidth + 1 && rect.left >= -1,
          right: rect.right,
          innerWidth: window.innerWidth
        };
      });
      expect(metrics.ok, JSON.stringify(metrics)).toBe(true);
      await assertNoHorizontalOverflow(page);
    });
  });
});
