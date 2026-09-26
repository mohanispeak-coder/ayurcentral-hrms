/**
 * Payslip view vs download contracts.
 * Run: node tests/payslip-view-download.test.js
 */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'apps-script', 'src');
const failures = [];

function read(rel) {
  return fs.readFileSync(path.join(src, rel), 'utf8');
}

function check(name, cond) {
  if (cond) console.log('PASS ' + name);
  else {
    failures.push(name);
    console.log('FAIL ' + name);
  }
}

const payslip = read('payroll/PayslipService.gs');
const apiPay = read('payroll/ApiPayroll.gs');
const apiEmp = read('employee/ApiEmployee.gs');
const payrollClient = read('payroll/PayrollClient.html');
const empClient = read('employee/EmployeeClient.html');

check('store-html-payslip', /Utilities\.newBlob\(html, 'text\/html/.test(payslip));
check('package-intent-view', /intent === 'view'/.test(payslip) && /payslipIntent_/.test(payslip));
check('api-payslip-intent', /apiGetPayslipDownload\(documentId, intent/.test(apiPay));
check('api-employee-doc-intent', /apiDownloadEmployeeDocument\(documentId, intent/.test(apiEmp));
check('client-view-arg', /apiGetPayslipDownload', \[btn\.getAttribute\('data-id'\), 'view'\]/.test(payrollClient));
check('client-download-arg', /apiGetPayslipDownload', \[btn\.getAttribute\('data-id'\), 'download'\]/.test(payrollClient));
check('profile-view-arg', /apiDownloadEmployeeDocument', id, 'view'/.test(empClient));

if (failures.length) {
  console.error('\n' + failures.length + ' failed');
  process.exit(1);
}
console.log('\nAll payslip view/download checks passed');
