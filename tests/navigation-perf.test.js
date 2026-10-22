/**
 * Navigation / page-switch performance contracts.
 * Run: node tests/navigation-perf.test.js
 */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'apps-script', 'src');
const failures = [];

function read(rel) {
  return fs.readFileSync(path.join(src, rel), 'utf8');
}

function check(name, cond, detail) {
  if (cond) {
    console.log('PASS ' + name + (detail ? ' — ' + detail : ''));
  } else {
    failures.push(name + (detail ? ': ' + detail : ''));
    console.log('FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}

const scripts = read('ui/Scripts.html');
const payroll = read('payroll/PayrollClient.html');
const payrollSvc = read('payroll/PayrollService.gs');
const apiPay = read('payroll/ApiPayroll.gs');
const emp = read('employee/EmployeeClient.html');

check('nav-start-perf', /kind:\s*'nav-start'/.test(scripts));
check('nav-fast-restore', /kind:\s*'nav-fast-restore'/.test(scripts));
check('nav-skip-ensure-when-loaded', /moduleLoaded_\[moduleId\][\s\S]{0,120}moduleRoutesRegistered_[\s\S]{0,200}invokeRegisteredRouteRender_/.test(scripts));

check('payroll-light-fetch', /fetchPayrollRunDetail_/.test(payroll) && /light:\s*true/.test(payroll));
check('payroll-full-hydrate', /queueFullPayrollRunDetail_/.test(payroll) && /full:\s*true/.test(payroll));
check('payroll-refresh-full', /apiGetPayrollRun',\s*\[runId,\s*\{\s*full:\s*true\s*\}\]/.test(payroll));

check('api-run-light-default', /options\.light\s*=\s*true/.test(apiPay) && /options\.skipSync\s*=\s*true/.test(apiPay));
check('api-run-full-flag', /options\.full/.test(apiPay) && /options\.light\s*=\s*false/.test(apiPay));
check('api-sync-full-detail', /apiSyncPayrollEmployees[\s\S]{0,200}getRunDetail\(runId,\s*\{\s*skipSync:\s*false\s*\}\)/.test(apiPay));

check('get-run-detail-light', /options\.light/.test(payrollSvc) && /buildSummaryLight_/.test(payrollSvc));
check('list-runs-attendance-map', /attendanceInputCountMap_/.test(payrollSvc));

check('emp-list-background-refresh', /hasCachedList/.test(emp) && /background:\s*true/.test(emp));

if (failures.length) {
  console.error('\n' + failures.length + ' failed');
  process.exit(1);
}
console.log('\nAll navigation-perf contracts passed');
