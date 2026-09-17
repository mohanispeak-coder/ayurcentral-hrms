/**
 * Opens Playwright codegen using HRMS_BASE_URL from repo-root .env
 * Run: npm run test:e2e:auth
 */
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { loadRepoEnv } = require('./load-env');

const root = path.join(__dirname, '..', '..');
const envResult = loadRepoEnv(root);

const url = (process.env.HRMS_BASE_URL || '').trim();
if (!url) {
  console.error('\nHRMS_BASE_URL is missing.');
  console.error('Expected file:', envResult.path);
  console.error('File exists:', fs.existsSync(envResult.path));
  if (envResult.loaded && envResult.keys.length) {
    console.error('Keys found in .env:', envResult.keys.join(', '));
  } else if (envResult.loaded) {
    console.error('.env is empty or has no KEY=value lines.');
  } else {
    console.error('Create .env in the repo root with:');
    console.error('HRMS_BASE_URL=https://script.google.com/macros/s/…/exec');
  }
  console.error('');
  process.exit(1);
}

if (url.indexOf('/exec') < 0 && url.indexOf('script.google.com') >= 0) {
  console.warn('Warning: URL may be incomplete — use the full Web app URL ending in /exec');
}

const storage =
  (process.env.HRMS_STORAGE_STATE || 'tests/browser/.auth/user.json').trim();
const storageAbs = path.isAbsolute(storage) ? storage : path.join(root, storage);
fs.mkdirSync(path.dirname(storageAbs), { recursive: true });

console.log('Opening:', url);
console.log('Saving storage to:', storageAbs);

const result = spawnSync(
  'npx',
  ['playwright', 'codegen', '--save-storage=' + storageAbs, url],
  { cwd: root, stdio: 'inherit', shell: true }
);
process.exit(result.status == null ? 1 : result.status);
