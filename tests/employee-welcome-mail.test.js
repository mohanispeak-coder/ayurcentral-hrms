/**
 * Welcome message copy — mirrors EmployeeWelcomeService.buildWelcomeContent.
 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var source = fs.readFileSync(
  path.join(__dirname, '..', 'apps-script', 'src', 'employee', 'EmployeeWelcomeService.gs'),
  'utf8'
);
var start = source.indexOf('function buildWelcomeContent(record, loginEmail)');
var end = source.indexOf('function telegramEnabled_');
var fnBlock = source.slice(start, end);

var ctx = {
  ConfigService: {
    getCompanyName: function () { return 'AyurCentral HRMS'; },
    getHrmsWebAppUrl: function () { return 'https://script.google.com/macros/s/example/exec'; }
  }
};
vm.runInNewContext(fnBlock + '\nthis.buildWelcomeContent = buildWelcomeContent;', ctx);

var mail = ctx.buildWelcomeContent({
  employee_id: 'SAPL-0042',
  display_name: 'Ravi Kumar',
  department: 'Operations'
}, 'ravi.kumar@example.com');

var fails = 0;
function check(name, ok) {
  if (!ok) { fails++; console.error('FAIL', name); } else console.log('PASS', name);
}

check('welcome line', mail.body.indexOf('Welcome to AyurCentral HRMS') >= 0);
check('subject', mail.subject.indexOf('Welcome') >= 0);
check('portal', mail.body.indexOf('https://script.google.com/macros/s/example/exec') >= 0);
check('formal close', mail.body.indexOf('Human Resources') >= 0);

if (fails) process.exit(1);
console.log('All employee-welcome-mail tests passed');
