/**
 * Per-vertical payroll runs and scoped correction runs.
 * Run: node tests/payroll-vertical-runs.test.js
 */
const fs = require('fs');
const path = require('path');

const payroll = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'src', 'payroll', 'PayrollService.gs'), 'utf8');
const api = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'src', 'payroll', 'ApiPayroll.gs'), 'utf8');
const client = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'src', 'payroll', 'PayrollClient.html'), 'utf8');
const schema = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'src', 'foundation', 'SchemaService.gs'), 'utf8');
const att = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'src', 'payroll', 'AttendanceBulkService.gs'), 'utf8');
const attClient = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'src', 'payroll', 'AttendanceClient.html'), 'utf8');
const sst = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'src', 'payroll', 'SalaryStructureClient.html'), 'utf8');
const scripts = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'src', 'ui', 'Scripts.html'), 'utf8');
const failures = [];

function check(name, cond) {
  if (cond) console.log('PASS ' + name);
  else {
    failures.push(name);
    console.log('FAIL ' + name);
  }
}

check('schema-vertical-column', /vertical_name/.test(schema) && /PAYROLL_RUNS/.test(schema));
check('create-run-vertical', /createRunInsideLock_/.test(payroll) && /vertical_name: vertical/.test(payroll));
check('find-open-by-vertical', /findOpenRun_\(year, month, vertical\)/.test(payroll));
check('correction-by-vertical', /nextCorrectionIdFromSource_/.test(payroll) && /findOpenRun_\(year, month, vertical\)/.test(payroll));
check('eligible-filter-vertical', /employeeVertical_/.test(payroll) && /verticalFilter/.test(payroll));
check('api-all-verticals', /apiCreatePayrollRunsAllVerticals/.test(api));
check('ui-vertical-select', /id="pr-vertical"/.test(client) && /btn-create-all-verticals/.test(client));
check('ui-legacy-vertical', /LEGACY_VERTICAL_/.test(client) && /resolveTargetRunForPeriod_/.test(client));
check('ui-all-runs-list', /paintPreviousPayrolls_/.test(client) && /data-run-id/.test(client));
check('att-run-vertical-match', /assertRunVerticalMatches_/.test(att));
check('legacy-import-service', /importInputsFromLegacyRun/.test(payroll) && /findLegacyRunForPeriod_/.test(payroll));
check('legacy-import-api', /apiPayrollImportLegacyInputs/.test(api));
check('legacy-import-ui', /paintLegacyImportBanner_/.test(client) && /apiPayrollImportLegacyInputs/.test(client));
check('legacy-attendance-count', /attendance_input_count/.test(payroll) && /runAttendanceCount_/.test(client));
check('payroll-no-hijack-salary-structure-route', !/registerRoute\('salary-structure'/.test(client));
check('payroll-employee-salary-route', /registerRoute\('payroll-employee-salary'/.test(client) &&
  /payroll-employee-salary': 'payroll'/.test(scripts));
check('salary-structure-template-ui', /sst-new/.test(sst) && /registerRoute\('salary-structure'/.test(sst));
check('compensation-loads-structure-module', /compensation: 'payroll-structure'/.test(scripts));
const payrollUi = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'src', 'payroll', 'PayrollClient.html'), 'utf8');
check('payroll-period-reconcile', /reconcilePayrollPeriodWithRuns_/.test(scripts) &&
  /reconcilePeriodWithRuns_/.test(attClient) && /reconcilePayrollPeriodWithRuns/.test(payrollUi));
check('payroll-attendance-run-resolve', /resolveAttendanceRunIdForVertical_/.test(payrollUi));

if (failures.length) {
  console.error('\n' + failures.length + ' failed');
  process.exit(1);
}
console.log('\nAll payroll vertical run checks passed');
