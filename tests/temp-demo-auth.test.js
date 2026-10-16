/**
 * Temporary demo login (User ID + password).
 * Run: node tests/temp-demo-auth.test.js
 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var constantsSrc = fs.readFileSync(
  path.join(__dirname, '..', 'apps-script', 'src', 'foundation', 'Constants.gs'),
  'utf8'
);
var sessionSrc = fs.readFileSync(
  path.join(__dirname, '..', 'apps-script', 'src', 'foundation', 'AuthSessionService.gs'),
  'utf8'
);
var tempSrc = fs.readFileSync(
  path.join(__dirname, '..', 'apps-script', 'src', 'foundation', 'TempDemoAuth.gs'),
  'utf8'
);
var authSrc = fs.readFileSync(
  path.join(__dirname, '..', 'apps-script', 'src', 'foundation', 'AuthService.gs'),
  'utf8'
);

var crypto = require('crypto');
var Utilities = {
  DigestAlgorithm: { SHA_256: 'SHA-256' },
  computeDigest: function (algo, data) {
    var buf = crypto.createHash('sha256').update(String(data)).digest();
    var arr = [];
    for (var i = 0; i < buf.length; i++) arr.push(buf[i] > 127 ? buf[i] - 256 : buf[i]);
    return arr;
  },
  base64EncodeWebSafe: function (digest) {
    var buf = Buffer.from(digest.map(function (b) { return b < 0 ? b + 256 : b; }));
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  getUuid: function () { return '00000000-0000-4000-8000-000000000001'; }
};

var failures = [];

function check(name, cond, detail) {
  if (cond) console.log('PASS ' + name + (detail ? ' — ' + detail : ''));
  else {
    failures.push(name);
    console.log('FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}

eval(constantsSrc);
eval(sessionSrc);
eval(tempSrc);

var store = {};
var memoryStore = hrmsAuthCreateStoreAdapter_(store, true);
var salt = 'test-salt';
var hash = hrmsTempDemoHashPassword_('secret12', salt);

var ok = hrmsTempDemoVerifyLogin_('demo', 'secret12', {
  enabled: true,
  expectedUserId: 'demo',
  passwordSalt: salt,
  passwordHash: hash,
  store: store,
  memoryOnly: true,
  now: Date.now()
});
check('verify-success', ok.ok === true && !!ok.sessionToken, ok.reason);
check('session-email', ok.email === HRMS.TEMP_DEMO.SESSION_EMAIL);

var emailFromToken = hrmsAuthSessionGetEmail_(ok.sessionToken, store, true);
check('session-token-email', emailFromToken === HRMS.TEMP_DEMO.SESSION_EMAIL);

var bad = hrmsTempDemoVerifyLogin_('demo', 'wrong', {
  enabled: true,
  expectedUserId: 'demo',
  passwordSalt: salt,
  passwordHash: hash,
  store: store,
  memoryOnly: true,
  now: Date.now()
});
check('verify-bad-password', bad.ok === false && bad.reason === 'INVALID');

var off = hrmsTempDemoVerifyLogin_('demo', 'secret12', {
  enabled: false,
  expectedUserId: 'demo',
  passwordSalt: salt,
  passwordHash: hash,
  store: store,
  memoryOnly: true,
  now: Date.now()
});
check('verify-disabled', off.ok === false && off.reason === 'DISABLED');

var resolveFn = authSrc.match(/function hrmsResolveAuthAccess_\([\s\S]*?\n\}/);
if (resolveFn) {
  var sandbox = { HRMS: HRMS, console: console };
  vm.runInNewContext(resolveFn[0], sandbox);
  var session = sandbox.hrmsResolveAuthAccess_({
    email: HRMS.TEMP_DEMO.SESSION_EMAIL,
    tempDemoLogin: true,
    tempDemoRole: 'ADMIN'
  });
  check('resolve-temp-demo-admin', session.authorized === true && session.role === 'ADMIN');
}

check('api-endpoint-defined', /function apiVerifyTempDemoLogin/.test(
  fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'src', 'foundation', 'ApiFoundation.gs'), 'utf8')
));
check('ui-demo-card', /auth-step-demo/.test(
  fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'src', 'ui', 'Index.html'), 'utf8')
));

if (failures.length) {
  console.log('\nFailed: ' + failures.join(', '));
  process.exit(1);
}
console.log('\nAll temp-demo-auth checks passed.');
