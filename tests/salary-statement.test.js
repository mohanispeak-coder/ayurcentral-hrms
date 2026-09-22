/**
 * Salary statement SAPL template smoke tests.
 * Run: node tests/salary-statement.test.js
 */
var fs = require('fs');
var path = require('path');

var src = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'src', 'payroll', 'SalaryStatementService.gs'), 'utf8');
var client = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'src', 'payroll', 'SalaryStatementClient.html'), 'utf8');
var failures = [];

function check(name, cond) {
  if (cond) console.log('PASS ' + name);
  else {
    failures.push(name);
    console.log('FAIL ' + name);
  }
}

check('service-exists', /SalaryStatementService/.test(src));
check('sapl-title', /Salary statement for the month of/.test(src));
check('rate-of-pay', /RATE OF PAY/.test(src));
check('earned-pay', /EARNED PAY/.test(src));
check('deduction-header', /DEDUCTION/.test(src));
check('compensation-fallback', /getStructureInForce/.test(src));
check('client-route', /registerRoute\('salary-statement'/.test(client));
check('client-download', /apiDownloadSalaryStatement/.test(client));

if (failures.length) {
  console.log('\n' + failures.length + ' failed');
  process.exit(1);
}
console.log('\nAll salary-statement checks passed');
