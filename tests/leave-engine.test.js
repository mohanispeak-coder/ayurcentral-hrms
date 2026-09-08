/**
 * Local LeaveEngine tests (11_TEST_PLAN.md P0 math + AuthZ rules).
 * Run: node tests/leave-engine.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', 'apps-script');
const context = {
  HRMS: {},
  Logger: { log: function () {} }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'Constants.gs'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'LeaveEngine.gs'), 'utf8'), context);

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
check('LV-08 deny other team', LeaveEngine.canApproveRequest(mgr, 'EMP004', 'EMP099') === false);
check('LV-08 allow team', LeaveEngine.canApproveRequest(mgr, 'EMP003', 'EMP002') === true);
check('LV-09 self-approve deny', LeaveEngine.canApproveRequest(
  { authorized: true, role: 'EMPLOYEE', employee_id: 'EMP003' }, 'EMP003', 'EMP002'
) === false);
check('LV-09 HR cannot self-approve', LeaveEngine.canApproveRequest(
  { authorized: true, role: 'HR', employee_id: 'EMP001' }, 'EMP001', ''
) === false);
check('HR override others', LeaveEngine.canApproveRequest(
  { authorized: true, role: 'HR', employee_id: 'EMP001' }, 'EMP003', 'EMP002'
) === true);
check('SEC-01 employee other leave', LeaveEngine.canViewEmployeeLeave(
  { authorized: true, role: 'EMPLOYEE', employee_id: 'EMP003' }, 'EMP004', 'EMP002'
) === false);

if (failures.length) {
  console.error('\n' + failures.length + ' failed');
  process.exit(1);
}
console.log('\nAll LeaveEngine checks passed (' + (20) + ')');
