/**
 * Public holiday vs leave apply rules.
 * Run: node tests/leave-public-holiday.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = path.join(__dirname, '..', 'apps-script', 'src');
const context = { HRMS: {}, Logger: { log: function () {} } };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(src, 'foundation', 'Constants.gs'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(src, 'leave', 'LeaveEngine.gs'), 'utf8'), context);

const LeaveEngine = context.LeaveEngine;
const failures = [];

function check(name, cond) {
  if (cond) console.log('PASS ' + name);
  else { failures.push(name); console.log('FAIL ' + name); }
}

var weekdayHol = { '2026-10-02': 'Gandhi Jayanti' };
check('blocks weekday holiday', LeaveEngine.publicHolidayConflicts(
  '2026-10-02', '2026-10-02', false, 'WEEKDAYS_ONLY', weekdayHol
).length === 1);
check('skips weekend-only holiday in range', LeaveEngine.publicHolidayConflicts(
  '2026-09-26', '2026-09-27', false, 'WEEKDAYS_ONLY', { '2026-09-27': 'Sunday holiday' }
).length === 0);
check('range picks holiday weekday', LeaveEngine.publicHolidayConflicts(
  '2026-10-01', '2026-10-03', false, 'CALENDAR_DAYS', weekdayHol
).length === 1);
check('half day on holiday', LeaveEngine.publicHolidayConflicts(
  '2026-10-02', '2026-10-02', true, 'WEEKDAYS_ONLY', weekdayHol
).length === 1);
check('message single', /Independence Day/.test(
  LeaveEngine.formatPublicHolidayConflictMessage([{ date: '2026-08-15', name: 'Independence Day' }])
));

const leaveSvc = fs.readFileSync(path.join(src, 'leave', 'LeaveService.gs'), 'utf8');
check('service asserts holiday conflict', /assertNoPublicHolidayConflict_/.test(leaveSvc));
check('draft and submit guarded', (leaveSvc.match(/assertNoPublicHolidayConflict_/g) || []).length >= 2);

if (failures.length) {
  console.log('\n' + failures.length + ' failed');
  process.exit(1);
}
console.log('\nAll leave-public-holiday checks passed');
