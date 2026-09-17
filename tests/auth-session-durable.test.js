/**
 * OTP sessions must survive ScriptCache eviction (concurrent DEMO users).
 * Run: node tests/auth-session-durable.test.js
 */
var fs = require('fs');
var path = require('path');

var src = fs.readFileSync(
  path.join(__dirname, '..', 'apps-script', 'src', 'foundation', 'AuthSessionService.gs'),
  'utf8'
);
var lockSrc = fs.readFileSync(
  path.join(__dirname, '..', 'apps-script', 'src', 'foundation', 'LockUtil.gs'),
  'utf8'
);
var failures = [];

function check(name, cond, detail) {
  if (cond) console.log('PASS ' + name + (detail ? ' — ' + detail : ''));
  else {
    failures.push(name);
    console.log('FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}

check('session-write-durable', /function hrmsAuthSessionWriteDurable_/.test(src));
check('session-read-durable', /function hrmsAuthSessionReadDurable_/.test(src));
check('verify-writes-durable', /hrmsAuthSessionWriteDurable_\(sessionKey/.test(src));
check('get-falls-back-durable', /hrmsAuthSessionReadDurable_\(sessionKey\)/.test(src));
check('invalidate-removes-durable', /hrmsAuthSessionRemoveDurable_\(sessionKey\)/.test(src));
check('rehydrate-cache', /hrmsAuthSessionRehydrateCache_/.test(src));
check('lock-uses-hasLock', /lock\.hasLock/.test(lockSrc));
check('lock-no-global-depth', !/scriptLockDepth_/.test(lockSrc));

if (failures.length) {
  console.log('\nFailed: ' + failures.join(', '));
  process.exit(1);
}
console.log('\nAll auth-session-durable checks passed.');
