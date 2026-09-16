/**
 * Local LeaveEngine tests (11_TEST_PLAN.md P0 math + AuthZ rules).
 * Run: node tests/leave-engine.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', 'apps-script', 'src');
const context = {
  HRMS: {},
  Logger: { log: function () {} }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'foundation', 'Constants.gs'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'leave', 'LeaveEngine.gs'), 'utf8'), context);

const LeaveEngine = context.LeaveEngine;
const failures = [];

function check(name, cond, detail) {
  if (cond) {
    console.log('PASS ' + name + (detail ? ' — ' + detail : ''));
  } else {
    failures.push(name + (detail ? ': ' + detail : ''));
    console.log('FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}

check('LV weekdays Mon-Fri', LeaveEngine.computeTotalDays('2026-04-06', '2026-04-10', false, 'WEEKDAYS_ONLY') === 5);
check('LV skip weekend', LeaveEngine.computeTotalDays('2026-04-10', '2026-04-13', false, 'WEEKDAYS_ONLY') === 2);
check('LV calendar days', LeaveEngine.computeTotalDays('2026-04-10', '2026-04-13', false, 'CALENDAR_DAYS') === 4);
check('LV-10 half day', LeaveEngine.computeTotalDays('2026-04-08', '2026-04-08', true, 'WEEKDAYS_ONLY') === 0.5);
check('ERR-01 inverted range counts 0', LeaveEngine.computeTotalDays('2026-04-10', '2026-04-08', false, 'CALENDAR_DAYS') === 0);
check('leave year calendar', LeaveEngine.getLeaveYear('2026-03-15', 1) === '2026');
check('leave year FY April', LeaveEngine.getLeaveYear('2026-03-15', 4) === '2025');
check('leave year Jan 1', LeaveEngine.getLeaveYear('2026-01-01', 1) === '2026');
check('leave year Dec 31', LeaveEngine.getLeaveYear('2026-12-31', 1) === '2026');
check('leave year FY Apr on Apr 1', LeaveEngine.getLeaveYear('2026-04-01', 4) === '2026');
check('leave year FY Apr on Mar 31', LeaveEngine.getLeaveYear('2026-03-31', 4) === '2025');
check('leap day count calendar', LeaveEngine.computeTotalDays('2024-02-28', '2024-03-01', false, 'CALENDAR_DAYS') === 3);

check('leave years inclusive', JSON.stringify(LeaveEngine.leaveYearsInclusive('2024', '2026')) === '["2024","2025","2026"]');
check('leave years inverted empty', LeaveEngine.leaveYearsInclusive('2026', '2024').length === 0);
check('employee years join current', JSON.stringify(LeaveEngine.employeeLeaveYears('2026-01-15', '2026-09-15', 1)) === '["2026"]');
check('employee years join previous', JSON.stringify(LeaveEngine.employeeLeaveYears('2025-06-01', '2026-09-15', 1)) === '["2025","2026"]');
check('employee years join several ago', JSON.stringify(LeaveEngine.employeeLeaveYears('2023-01-01', '2026-02-01', 1)) === '["2023","2024","2025","2026"]');
check('employee years join Dec 31', JSON.stringify(LeaveEngine.employeeLeaveYears('2025-12-31', '2026-01-01', 1)) === '["2025","2026"]');
check('employee years join Jan 1', JSON.stringify(LeaveEngine.employeeLeaveYears('2026-01-01', '2026-01-01', 1)) === '["2026"]');
check('future joiner no years', LeaveEngine.employeeLeaveYears('2027-01-01', '2026-09-15', 1).length === 0);
check('eligible current year', LeaveEngine.isEligibleForLeaveYear('2025-12-31', '2026', 1) === true);
check('not eligible before join year', LeaveEngine.isEligibleForLeaveYear('2027-01-15', '2026', 1) === false);

check('status filter pending alias', LeaveEngine.matchesStatusFilter('PENDING_HR', 'SUBMITTED') === true);
check('status filter awaiting manager', LeaveEngine.matchesStatusFilter('PENDING_MANAGER', 'PENDING_MANAGER') === true);
check('status filter approved exact', LeaveEngine.matchesStatusFilter('APPROVED', 'APPROVED') === true);
check('status filter rejects mismatch', LeaveEngine.matchesStatusFilter('APPROVED', 'PENDING') === false);
check('LV-06 overlap', LeaveEngine.requestsOverlap(
  { start_date: '2026-04-06', end_date: '2026-04-10', is_half_day: false },
  { start_date: '2026-04-09', end_date: '2026-04-12', is_half_day: false }
));
check('LV-06 adjacent ok', !LeaveEngine.requestsOverlap(
  { start_date: '2026-04-06', end_date: '2026-04-08', is_half_day: false },
  { start_date: '2026-04-09', end_date: '2026-04-10', is_half_day: false }
));
check('AM/PM coexist', !LeaveEngine.requestsOverlap(
  { start_date: '2026-04-08', end_date: '2026-04-08', is_half_day: true, half_day_session: 'AM' },
  { start_date: '2026-04-08', end_date: '2026-04-08', is_half_day: true, half_day_session: 'PM' }
));
check('same AM overlap', LeaveEngine.requestsOverlap(
  { start_date: '2026-04-08', end_date: '2026-04-08', is_half_day: true, half_day_session: 'AM' },
  { start_date: '2026-04-08', end_date: '2026-04-08', is_half_day: true, half_day_session: 'AM' }
));
check('LV-07 April split', LeaveEngine.lopDaysInMonth('2026-04-29', '2026-05-02', false, 'CALENDAR_DAYS', 2026, 4) === 2);
check('LV-07 May split', LeaveEngine.lopDaysInMonth('2026-04-29', '2026-05-02', false, 'CALENDAR_DAYS', 2026, 5) === 2);
check('available days', LeaveEngine.availableDays({ entitled_days: 12, carried_forward_days: 2, used_days: 3, pending_days: 1 }) === 10);

const mgr = { authorized: true, role: 'MANAGER', employee_id: 'EMP002' };
const hr = { authorized: true, role: 'HR', employee_id: 'EMP001' };
const admin = { authorized: true, role: 'ADMIN', employee_id: 'EMP099' };

check('employee initial pending manager', LeaveEngine.initialPendingStatus('EMPLOYEE', true) === 'PENDING_MANAGER');
check('employee no manager → HR', LeaveEngine.initialPendingStatus('EMPLOYEE', false) === 'PENDING_HR');
check('manager applicant → HR first', LeaveEngine.initialPendingStatus('MANAGER', true) === 'PENDING_HR');
check('HR applicant → admin only', LeaveEngine.initialPendingStatus('HR', false) === 'PENDING_ADMIN');

check('LV-08 deny other team', LeaveEngine.canApproveRequest(mgr, 'EMP004', 'EMP099', 'PENDING_MANAGER', 'EMPLOYEE') === false);
check('LV-08 allow team manager stage', LeaveEngine.canApproveRequest(mgr, 'EMP003', 'EMP002', 'PENDING_MANAGER', 'EMPLOYEE') === true);
check('manager stage id trim/case', LeaveEngine.canApproveRequest(mgr, 'EMP003', ' emp002 ', 'PENDING_MANAGER', 'EMPLOYEE') === true);
check('assigned HR manager stage 1', LeaveEngine.canApproveRequest(
  { authorized: true, role: 'HR', employee_id: 'EMP002' }, 'EMP003', 'EMP002', 'PENDING_MANAGER', 'EMPLOYEE'
) === true);
check('HR not assigned manager stage 1', LeaveEngine.canApproveRequest(hr, 'EMP003', 'EMP002', 'PENDING_MANAGER', 'EMPLOYEE') === false);
check('manager cannot HR stage', LeaveEngine.canApproveRequest(mgr, 'EMP003', 'EMP002', 'PENDING_HR', 'EMPLOYEE') === false);
check('HR or admin can finalize employee stage 2', LeaveEngine.canApproveRequest(hr, 'EMP003', 'EMP002', 'PENDING_HR', 'EMPLOYEE') === true);
check('admin can finalize employee stage 2', LeaveEngine.canApproveRequest(admin, 'EMP003', 'EMP002', 'PENDING_HR', 'EMPLOYEE') === true);
check('HR only first stage for manager applicant', LeaveEngine.canApproveRequest(hr, 'EMP002', 'EMP001', 'PENDING_HR', 'MANAGER') === true);
check('admin not first stage for manager applicant', LeaveEngine.canApproveRequest(admin, 'EMP002', 'EMP001', 'PENDING_HR', 'MANAGER') === false);
check('admin second stage manager applicant', LeaveEngine.canApproveRequest(admin, 'EMP002', 'EMP001', 'PENDING_ADMIN', 'MANAGER') === true);
check('HR cannot admin-only stage', LeaveEngine.canApproveRequest(hr, 'EMP001', '', 'PENDING_ADMIN', 'HR') === false);

check('LV-09 self-approve deny', LeaveEngine.canApproveRequest(
  { authorized: true, role: 'EMPLOYEE', employee_id: 'EMP003' }, 'EMP003', 'EMP002', 'PENDING_MANAGER', 'EMPLOYEE'
) === false);
check('LV-09 HR cannot self-approve', LeaveEngine.canApproveRequest(
  hr, 'EMP001', '', 'PENDING_ADMIN', 'HR'
) === false);

check('stage after manager', LeaveEngine.statusAfterApproval('PENDING_MANAGER', 'EMPLOYEE').status === 'PENDING_HR');
check('stage after HR for employee is final', LeaveEngine.statusAfterApproval('PENDING_HR', 'EMPLOYEE').final === true);
check('stage after HR for manager applicant', LeaveEngine.statusAfterApproval('PENDING_HR', 'MANAGER').status === 'PENDING_ADMIN');

check('SEC-01 employee other leave', LeaveEngine.canViewEmployeeLeave(
  { authorized: true, role: 'EMPLOYEE', employee_id: 'EMP003' }, 'EMP004', 'EMP002'
) === false);

check('legacy SUBMITTED blocks overlap', LeaveEngine.isBlockingStatus('SUBMITTED') === true);
check('pending admin blocks', LeaveEngine.isBlockingStatus('PENDING_ADMIN') === true);

if (failures.length) {
  console.error('\n' + failures.length + ' failed');
  process.exit(1);
}
console.log('\nAll LeaveEngine checks passed');
