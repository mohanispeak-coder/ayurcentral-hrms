/**
 * Runs every tests/*.test.js file with the system Node runtime and prints a
 * combined summary. Exits non-zero if any executed suite fails.
 *
 * A few suites (the Ask HR Knowledge Hub contracts) assert against an external
 * sibling repository checked out at ../ayurveda-ai. When that repo is not
 * present they are reported as SKIPPED instead of failing, so the local
 * HRMS suite stays green on its own.
 *
 * Run: node tests/run-all.js
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const testsDir = __dirname;
const repoRoot = path.join(testsDir, '..');
const externalHubDir = path.join(repoRoot, '..', 'ayurveda-ai');
const hasExternalHub = fs.existsSync(externalHubDir);

const files = fs
  .readdirSync(testsDir)
  .filter((f) => f.endsWith('.test.js'))
  .sort();

const results = { passed: [], failed: [], skipped: [] };

for (const file of files) {
  const full = path.join(testsDir, file);
  const source = fs.readFileSync(full, 'utf8');
  const needsExternalHub = source.includes('ayurveda-ai');

  if (needsExternalHub && !hasExternalHub) {
    results.skipped.push(file);
    console.log(`SKIP ${file} — requires external repo ../ayurveda-ai (not present)`);
    continue;
  }

  console.log(`\n===== ${file} =====`);
  const run = spawnSync(process.execPath, [full], { stdio: 'inherit' });
  if (run.status === 0) {
    results.passed.push(file);
  } else {
    results.failed.push(file);
  }
}

console.log('\n============================================');
console.log(
  `Suites: ${results.passed.length} passed, ` +
    `${results.failed.length} failed, ` +
    `${results.skipped.length} skipped`
);
if (results.skipped.length) {
  console.log('Skipped: ' + results.skipped.join(', '));
}
if (results.failed.length) {
  console.log('Failed: ' + results.failed.join(', '));
  process.exit(1);
}
console.log('All executed suites passed.');
