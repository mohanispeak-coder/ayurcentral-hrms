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
check('holiday-ui-when-app-ready', /whenAppReady/.test(client) && /registerRoute\('holiday-calendar'/.test(client));
check('holiday-hr-admin-access', /isHrOrAdmin/.test(svc) && /holiday-calendar/.test(svc));
check('year-excel-template', /downloadYearTemplate/.test(svc) && /apiHolidayDownloadYearTemplate/.test(fs.readFileSync(path.join(root, 'foundation', 'ApiHoliday.gs'), 'utf8')));
check('leave-calendar-holidays', /public_holidays/.test(fs.readFileSync(path.join(root, 'leave', 'LeaveService.gs'), 'utf8')));
check('holiday-date-parser', /parseHolidayDate_/.test(svc) && /canonicalImportHeader_/.test(svc));
check('holiday-skip-blank-import-rows', /!trim_\(r\.holiday_date\) && !trim_\(r\.name\)/.test(svc));

check('holiday-preset-national', /IN_NATIONAL_FIXED/.test(svc) && /Republic Day/.test(svc));
check('holiday-import-feedback-ui', /hol-import-feedback/.test(client) && /paintImportPreview_/.test(client));
check('holiday-status-banner', /hol-status-banner/.test(client) && /holNotify_/.test(client));
check('holiday-preset-hyphen', /India - fixed national holidays/.test(svc) && !/India — fixed/.test(svc));
check('holiday-template-one-example', /exampleTemplateRow_/.test(svc) && !/blankRows = 54/.test(svc));
check('holiday-leave-year-list', /listHolidaysForLeaveYear/.test(svc));
check('leave-my-leave-public-holidays', /public_holidays/.test(fs.readFileSync(path.join(root, 'leave', 'LeaveService.gs'), 'utf8')));

if (failures.length) {
  console.log('\n' + failures.length + ' failed');
  process.exit(1);
}
console.log('\nAll holiday-calendar checks passed (' + passed + ')');
