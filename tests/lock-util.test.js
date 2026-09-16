/**
 * Script lock re-entrancy contract.
 * Run: node tests/lock-util.test.js
 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var src = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'src', 'foundation', 'LockUtil.gs'), 'utf8');
var failures = [];

function check(name, cond) {
  if (cond) console.log('PASS ' + name);
  else {
    failures.push(name);
    console.log('FAIL ' + name);
  }
}

check('lock-depth-guard', /scriptLockDepth_/.test(src));
check('nested-skip-acquire', /if \(scriptLockDepth_ > 0\)/.test(src));

if (failures.length) {
  process.exit(1);
}
console.log('\nAll lock-util checks passed.');
