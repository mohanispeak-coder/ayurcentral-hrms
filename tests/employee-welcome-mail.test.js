/**
 * Welcome email copy (template C) — mirrors EmployeeService.buildEmployeeWelcomeEmail_.
 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var employeeGs = fs.readFileSync(
  path.join(__dirname, '..', 'apps-script', 'src', 'employee', 'EmployeeService.gs'),
  'utf8'
);

function extractWelcomeBuilder(source) {
  var start = source.indexOf('function buildEmployeeWelcomeEmail_(record, loginEmail)');
  if (start < 0) throw new Error('buildEmployeeWelcomeEmail_ not found');
  var end = source.indexOf('function notifyEmployeeWelcome_', start);
  var fn = source.slice(start, end);
  return fn;
}

var ctx = {
  ConfigService: {
    getCompanyName: function () { return 'AyurCentral HRMS'; },
    getHrmsWebAppUrl: function () { return 'https://script.google.com/macros/s/example/exec'; }
  },
  trim_: function (v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
  }
};

vm.runInNewContext(extractWelcomeBuilder(employeeGs) + '\nbuildEmployeeWelcomeEmail_;', ctx);
var build = ctx.buildEmployeeWelcomeEmail_;

var mail = build({
  employee_id: 'SAPL-0042',
  display_name: 'Ravi Kumar',
  department: 'Operations'
}, 'ravi.kumar@example.com');

var fails = 0;
function check(name, ok) {
  if (!ok) { fails++; console.error('FAIL', name); } else console.log('PASS', name);
}

check('subject', mail.subject === 'AyurCentral HRMS — HRMS access for SAPL-0042');
check('portal line', mail.body.indexOf('https://script.google.com/macros/s/example/exec') >= 0);
check('login email', mail.body.indexOf('ravi.kumar@example.com') >= 0);
check('formal signoff', mail.body.indexOf('Human Resources') >= 0);

if (fails) process.exit(1);
console.log('All employee-welcome-mail tests passed');
