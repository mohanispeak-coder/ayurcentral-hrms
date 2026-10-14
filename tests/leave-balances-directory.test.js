/**
 * Leave balances directory smoke tests.
 * Run: node tests/leave-balances-directory.test.js
 */
var fs = require('fs');
var path = require('path');

var root = path.join(__dirname, '..', 'apps-script', 'src');
var failures = [];
var passed = 0;

function check(name, cond) {
  if (cond) { passed++; console.log('PASS ' + name); }
  else { failures.push(name); console.log('FAIL ' + name); }
}

var emp = fs.readFileSync(path.join(root, 'employee', 'EmployeeService.gs'), 'utf8');
var leaveSvc = fs.readFileSync(path.join(root, 'leave', 'LeaveService.gs'), 'utf8');
var api = fs.readFileSync(path.join(root, 'employee', 'ApiEmployee.gs'), 'utf8');
var perm = fs.readFileSync(path.join(root, 'foundation', 'PermissionService.gs'), 'utf8');
var leaveUi = fs.readFileSync(path.join(root, 'leave', 'LeaveUi.html'), 'utf8');
var scripts = fs.readFileSync(path.join(root, 'ui', 'Scripts.html'), 'utf8');

check('list-leave-balances-service', /listLeaveBalancesDirectory/.test(emp));
check('api-leave-balances', /apiGetLeaveBalancesDirectory/.test(api));
check('nav-leave-balances', /leave-balances/.test(perm) && /leave-balances/.test(scripts));
check('leave-ui-balances-route', /renderLeaveBalances/.test(leaveUi) && /apiGetLeaveBalancesDirectory/.test(leaveUi));
check('leave-ui-self-registers-routes', /registerLeaveRoutesFromUi_/.test(leaveUi));
check('shell-leave-route-fallback', /invokeRegisteredRouteRender_/.test(scripts));
check('module-routes-all-registered', /keys\.every/.test(scripts));
check('leave-summary-month-lop', /month_lop/.test(emp) && /month_paid/.test(emp));
check('leave-year-used-from-requests', /summarizeLeaveYearFromRequests/.test(leaveSvc) && /summarizeLeaveYearFromRequests/.test(emp));
check('request-in-leave-year', /requestInLeaveYear_/.test(leaveSvc));
check('apply-request-totals-balances', /applyRequestTotalsToYearBalances_/.test(leaveSvc) &&
  /return balances \|\| \[\]/.test(leaveSvc));
check('profile-leave-summary-policy-sync', /syncCurrentYearBalanceFromPolicy/.test(emp) &&
  /yearsToMerge/.test(emp));
check('my-leave-matches-profile-payload', /buildLeaveSummaryPayload/.test(emp) &&
  /year_balances/.test(leaveSvc) && /monthly_snapshot/.test(leaveSvc));
check('my-leave-ui-profile-layout', /HrmsLeaveView/.test(fs.readFileSync(path.join(root, 'ui', 'LeaveViewShared.html'), 'utf8')) &&
  /employeeLeaveLayoutHtml/.test(leaveUi));
check('index-includes-leave-view-shared', /LeaveViewShared/.test(fs.readFileSync(path.join(root, 'ui', 'Index.html'), 'utf8')));
check('month-used-includes-approved', /approvedLeaveDaysInCalendarMonth_/.test(leaveSvc) &&
  /approvedLeaveDaysMapForCalendarMonth_/.test(leaveSvc) &&
  /monthLeaveUsedDays_/.test(fs.readFileSync(path.join(root, 'leave', 'MonthlyLeaveService.gs'), 'utf8')));
check('calendar-month-timezone', /getCurrentCalendarMonth_/.test(leaveSvc) &&
  /approvedLeaveDaysMapForCalendarMonth/.test(emp));
check('no-all-years-fallback', !/if \(!general\.length\) general = balances/.test(emp));
var monthly = fs.readFileSync(path.join(root, 'leave', 'MonthlyLeaveService.gs'), 'utf8');
check('monthly-lop-from-excess', /lopFromExcessLeave_/.test(monthly) && /lop_days/.test(monthly));
check('leave-balances-lop-column', /Month LOP/.test(leaveUi));

if (failures.length) {
  console.log('\n' + failures.length + ' failed');
  process.exit(1);
}
console.log('\nAll leave-balances-directory checks passed (' + passed + ')');
