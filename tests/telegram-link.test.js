/**
 * Telegram deep-link helpers (Node smoke).
 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var src = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'src', 'notifications', 'TelegramLinkService.gs'), 'utf8');
var main = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'src', 'foundation', 'Main.gs'), 'utf8');
var fails = 0;

function check(name, ok) {
  if (ok) console.log('PASS ' + name);
  else { fails++; console.log('FAIL ' + name); }
}

check('doPost-telegram', /function doPost\(e\)/.test(main) && /TelegramLinkService\.processUpdate/.test(main));
check('start-prefix', /START_PREFIX_ = 'hrms_'/.test(src));
check('connect-url', /buildConnectUrl/.test(src));
check('queue-welcome', /queueWelcomeForLink_/.test(src));
check('email-append', /appendConnectLineToBody/.test(src));

var ctx = {
  HRMS: {},
  ConfigService: { getSetting: function () { return 'MyHrBot'; } }
};
vm.runInNewContext(
  "function trim_(v){return String(v||'').trim();}" +
  src.match(/function startParamForEmployee_[\s\S]*?function employeeIdFromStartParam_[\s\S]*?return trim_\(param\.substring\(START_PREFIX_\.length\)\);\s*\}/)[0] +
  "\nvar START_PREFIX_='hrms_';",
  ctx
);
check('roundtrip-id', ctx.startParamForEmployee_('SAPL-0001') === 'hrms_SAPL-0001');

if (fails) process.exit(1);
console.log('All telegram-link checks passed');
