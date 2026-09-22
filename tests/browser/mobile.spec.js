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
  waitForModulePaint,
  isAuthenticated,
  getHrmsAppFrame
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
    const hrms = await getHrmsAppFrame(page);
    await expect(hrms.locator('#app')).toBeVisible();
    const authed = await isAuthenticated(page);
    if (authed) {
      await expect(hrms.locator('#main-content')).toBeVisible();
      await expect(hrms.locator('#page-content, #auth-state').first()).toBeVisible();
    } else {
      await expect(
        hrms.locator('#auth-step-email, #setup-state, #unauthorized-state').first()
      ).toBeVisible({ timeout: 15_000 });
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
      try {
        await waitForAuthenticatedWorkspace(page);
      } catch (err) {
        testInfo.skip(true, (err && err.message) ? err.message : 'Session not restored — npm run test:e2e:auth');
      }
    });

    test('sidebar opens and closes on mobile', async function ({ page }) {
      const hrms = await getHrmsAppFrame(page);
      const toggle = hrms.locator('#sidebar-toggle');
      await expect(toggle).toBeVisible();
      await toggle.click();
      await expect(hrms.locator('#sidebar.open, .app-sidebar.open')).toBeVisible({ timeout: 10_000 });
      const backdrop = hrms.locator('#sidebar-backdrop.open');
      await expect(backdrop).toBeVisible();
      await backdrop.click({ force: true });
      await expect(hrms.locator('#sidebar.open, .app-sidebar.open')).toHaveCount(0, { timeout: 10_000 });
      await assertNoHorizontalOverflow(page);
    });

    test('dashboard renders without overflow', async function ({ page }) {
      await gotoRoute(page, 'dashboard');
      await waitForModulePaint(page);
      await assertNoHorizontalOverflow(page);
    });

    test('my leave renders without overflow', async function ({ page }) {
      await gotoRoute(page, 'my-leave');
      await waitForModulePaint(page, /leave/i);
      await assertNoHorizontalOverflow(page);
    });

    test('employee directory renders if accessible', async function ({ page }, testInfo) {
      await gotoRoute(page, 'employees');
      await page.waitForTimeout(2000);
      const hrms = await getHrmsAppFrame(page);
      const denied = hrms.locator('#unauthorized-state:not(.hidden)');
      if (await denied.isVisible().catch(function () { return false; })) {
        testInfo.skip(true, 'Current session cannot access Employees (RBAC).');
      }
      try {
        await waitForModulePaint(page);
      } catch (err) {
        testInfo.skip(true, 'Employees module did not paint (RBAC or slow RPC).');
      }
      await assertNoHorizontalOverflow(page);
    });

    test('Ask HR button stays inside viewport', async function ({ page }, testInfo) {
      await gotoRoute(page, 'dashboard');
      await waitForModulePaint(page);
      const hrms = await getHrmsAppFrame(page);
      const fab = hrms.locator('#ask-hr-fab:not(.hidden)');
      try {
        await fab.waitFor({ state: 'visible', timeout: 30_000 });
      } catch (err) {
        testInfo.skip(true, 'Ask HR FAB not visible for this role/session.');
      }
      await assertElementInViewport(page, '#ask-hr-fab:not(.hidden)');
    });

    test('main content does not extend beyond viewport', async function ({ page }) {
      await gotoRoute(page, 'dashboard');
      await waitForModulePaint(page);
      const hrms = await getHrmsAppFrame(page);
      const metrics = await hrms.evaluate(function () {
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
