/**
 * Inspect Playwright storage state (no secrets printed).
 * Run: node tests/browser/check-storage.js
 */
const fs = require('fs');
const path = require('path');
const { loadRepoEnv } = require('./load-env');

const root = path.join(__dirname, '..', '..');
loadRepoEnv(root);

const storagePath = process.env.HRMS_STORAGE_STATE || 'tests/browser/.auth/user.json';
const abs = path.isAbsolute(storagePath) ? storagePath : path.join(root, storagePath);

if (!fs.existsSync(abs)) {
  console.error('Storage file not found:', abs);
  console.error('Run: npm run test:e2e:auth');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
const origins = data.origins || [];
console.log('Storage file:', abs);
console.log('Origins saved:', origins.length);
origins.forEach(function (o) {
  var keys = Object.keys(o.sessionStorage || {});
  var hasHrms = keys.indexOf('hrms_session_token') >= 0;
  console.log(' -', o.origin);
  console.log('   sessionStorage keys:', keys.length ? keys.join(', ') : '(none)');
  console.log('   hrms_session_token:', hasHrms ? 'present' : 'MISSING');
});

const base = (process.env.HRMS_BASE_URL || '').trim();
console.log('\nHRMS_BASE_URL host:', base ? new URL(base).host : '(not set)');
console.log(
  '\nIf hrms_session_token is MISSING, re-run npm run test:e2e:auth after OTP,\n' +
    'when the dashboard is visible (copy the address bar URL into .env if it differs from /exec).'
);
