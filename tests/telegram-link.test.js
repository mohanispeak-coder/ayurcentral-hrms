/**
 * Telegram deep-link helpers (Node smoke).
 */
var fs = require('fs');
var path = require('path');

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
check('getMe-username', /getMe/.test(src) && /resolveBotUsername_/.test(src));
check('welcome-placeholder', /telegram_connect_line/.test(
  fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'src', 'foundation', 'HrmsContentTemplateService.gs'), 'utf8')
));
check('param-parse', /employeeIdFromStartParam_/.test(src) && /substring\(START_PREFIX_\.length\)/.test(src));
check('api-webhook', /apiInstallTelegramWebhook/.test(
  fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'src', 'foundation', 'ApiFoundation.gs'), 'utf8')
));

if (fails) process.exit(1);
console.log('All telegram-link checks passed');
