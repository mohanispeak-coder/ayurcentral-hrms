/**
 * Holiday calendar smoke tests.
 * Run: node tests/holiday-calendar.test.js
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

var svc = fs.readFileSync(path.join(root, 'foundation', 'HolidayCalendarService.gs'), 'utf8');
var bulk = fs.readFileSync(path.join(root, 'payroll', 'AttendanceBulkService.gs'), 'utf8');
var client = fs.readFileSync(path.join(root, 'payroll', 'HolidayCalendarClient.html'), 'utf8');

check('holiday-service', /HolidayCalendarService/.test(svc) && /dayCodesForMonth/.test(svc));
check('holiday-sheet', /HOLIDAY_CALENDAR/.test(fs.readFileSync(path.join(root, 'foundation', 'Constants.gs'), 'utf8')));
check('attendance-prefill', /HolidayCalendarService\.dayCodesForMonth/.test(bulk));
check('holiday-ui-route', /holiday-calendar/.test(client) && /apiHolidayValidateImport/.test(client));
check('year-excel-template', /downloadYearTemplate/.test(svc) && /apiHolidayDownloadYearTemplate/.test(fs.readFileSync(path.join(root, 'foundation', 'ApiHoliday.gs'), 'utf8')));
check('leave-calendar-holidays', /public_holidays/.test(fs.readFileSync(path.join(root, 'leave', 'LeaveService.gs'), 'utf8')));

if (failures.length) {
  console.log('\n' + failures.length + ' failed');
  process.exit(1);
}
console.log('\nAll holiday-calendar checks passed (' + passed + ')');
