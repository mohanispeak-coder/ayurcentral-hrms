/**
 * Salary statement module smoke tests.
 * Run: node tests/salary-statement.test.js
 */
var fs = require('fs');
var path = require('path');

var payrollDir = path.join(__dirname, '..', 'apps-script', 'src', 'payroll');
var svc = fs.readFileSync(path.join(payrollDir, 'SalaryStatementService.gs'), 'utf8');
var client = fs.readFileSync(path.join(payrollDir, 'SalaryStatementClient.html'), 'utf8');
var api = fs.readFileSync(path.join(payrollDir, 'ApiPayroll.gs'), 'utf8');
var perm = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'src', 'foundation', 'PermissionService.gs'), 'utf8');
var failures = [];

function check(name, cond) {
  if (cond) console.log('PASS ' + name);
  else { failures.push(name); console.log('FAIL ' + name); }
}

check('service', /SalaryStatementService/.test(svc));
check('list-api', /apiListSalaryStatement/.test(api));
check('download-api', /apiDownloadSalaryStatement/.test(api));
check('client-route', /registerRoute\('salary-statement'/.test(client));
check('nav-item', /salary-statement/.test(perm) && /Salary Statement/.test(perm));
check('ctc-calc', /PERCENT_OF_CTC/.test(svc) && /total_cost_to_company/.test(svc));
check('excel-export', /buildExcel_/.test(svc) && /HRMS_Salary_Statement_CTC/.test(svc));

if (failures.length) {
  console.log('\n' + failures.length + ' failed');
  process.exit(1);
}
console.log('\nAll salary-statement checks passed');
