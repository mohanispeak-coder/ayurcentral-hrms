/**
 * Save Playwright storage AFTER you finish OTP login (more reliable than codegen for GAS).
 *
 * 1. Browser opens your HRMS_BASE_URL from .env
 * 2. You sign in (email + OTP) until the dashboard appears
 * 3. Press Enter in this terminal
 * 4. Storage is written to HRMS_STORAGE_STATE (default: tests/browser/.auth/user.json)
 *
 * Run: npm run test:e2e:auth:save
 */
const readline = require('readline');
const path = require('path');
const fs = require('fs');
const { chromium } = require('@playwright/test');
const { loadRepoEnv } = require('./load-env');
const { buildHrmsUrl, scanSessionStorageAcrossFrames } = require('./helpers');

const root = path.join(__dirname, '..', '..');
loadRepoEnv(root);

const storageRel =
  (process.env.HRMS_STORAGE_STATE || 'tests/browser/.auth/user.json').trim();
const storageAbs = path.isAbsolute(storageRel)
  ? storageRel
  : path.join(root, storageRel);

async function main() {
  var target;
  try {
    target = buildHrmsUrl('/');
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(storageAbs), { recursive: true });

  console.log('\nOpening HRMS:\n  ' + target);
  console.log('\nWhen the dashboard is visible (signed in), return here and press Enter.\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 120_000 });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise(function (resolve) {
    rl.question('Press Enter after you are logged in… ', function () {
      rl.close();
      resolve();
    });
  });

  const scan = await scanSessionStorageAcrossFrames(page);

  console.log('\nTop-level URL:', scan.topUrl);
  console.log('Frames:');
  scan.frames.forEach(function (f, idx) {
    console.log(
      '  [' +
        idx +
        '] origin=' +
        f.origin +
        ' hasApp=' +
        f.hasApp +
        ' is-authed=' +
        f.authed +
        ' hrms_session_token=' +
        (f.hasToken ? 'yes' : 'no')
    );
    if (f.href && f.href.length < 120) console.log('      ' + f.href);
  });

  const tokenFrame = scan.tokenFrame;
  console.log('\nhrms_session_token (any frame):', scan.hasToken ? 'yes' : 'NO');

  if (!scan.hasToken) {
    console.error(
      '\nNo session token in any frame. Finish OTP until the dashboard shows inside the app, then run this script again.\n' +
        'If you see the dashboard but token is still missing, confirm you completed HRMS email + OTP (not only Google account login).\n'
    );
    await browser.close();
    process.exit(1);
  }

  if (tokenFrame && tokenFrame.origin.indexOf('googleusercontent.com') >= 0) {
    console.log(
      '\nTip: sessionStorage is on the iframe origin. Use HRMS_BASE_URL that opens the same deployment;\n' +
        'iframe URL: ' +
        tokenFrame.href +
        '\n'
    );
  }

  await context.storageState({ path: storageAbs });
  console.log('\nSaved:', storageAbs);
  console.log('Run: npm run test:e2e:check-storage');
  console.log('Then: npm run test:e2e:debug\n');

  await browser.close();
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
