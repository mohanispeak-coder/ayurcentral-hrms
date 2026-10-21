/**
 * Join-month leave grant bands (MonthlyLeaveService.joinMonthGrantForBase_).
 * Run: node tests/leave-join-grant.test.js
 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var root = path.join(__dirname, '..', 'apps-script', 'src');
var failures = [];
var passed = 0;

function check(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log('PASS ' + name + (detail ? ' — ' + detail : ''));
  } else {
    failures.push(name + (detail ? ': ' + detail : ''));
    console.log('FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}

var settings = {
  leave_join_grant_after_day: '20',
  leave_join_half_from_day: '10',
  leave_join_half_to_day: '20'
};

var ctx = {
  HRMS: { ATTENDANCE_LEAVE_BALANCE_MAX: { SAPL: 2, AOMS: 1, OTHERS: 2 }, SHEETS: { VERTICALS: 'Verticals', EMPLOYEES: 'Employees', LEAVE_MONTHLY_ADJUSTMENTS: 'Adj' } },
  DbService: { findOne: function () { return null; }, findRecords: function () { return []; }, appendRecord: function () {} },
  ConfigService: {
    getSetting: function (k, d) {
      return settings.hasOwnProperty(k) ? settings[k] : d;
    }
  },
  AttendanceRegisterService: null,
  LeaveService: null,
  LeavePolicyService: null,
  PermissionService: null,
  notFoundError_: function (m) { throw new Error(m); },
  validationError_: function (m) { throw new Error(m); },
  authorizationError_: function (m) { throw new Error(m); },
  Utilities: { getUuid: function () { return 'test-uuid'; } }
};

vm.runInNewContext(fs.readFileSync(path.join(root, 'leave', 'MonthlyLeaveService.gs'), 'utf8'), ctx);

var grant = ctx.MonthlyLeaveService.joinMonthGrantForBase_;

check('base-2-day-5-full', grant(2, 5) === 2);
check('base-2-day-15-half', grant(2, 15) === 1);
check('base-2-day-20-half', grant(2, 20) === 1);
check('base-2-day-21-zero', grant(2, 21) === 0);
check('base-1-day-5-full', grant(1, 5) === 1);
check('base-1-day-15-zero', grant(1, 15) === 0);
check('base-1-day-21-zero', grant(1, 21) === 0);
check('base-3-day-12-half', grant(3, 12) === 1.5);

check('source-half-settings', /leave_join_half_from_day/.test(
  fs.readFileSync(path.join(root, 'foundation', 'SchemaService.gs'), 'utf8')));

if (failures.length) {
  console.log('\n' + failures.length + ' failed:\n' + failures.join('\n'));
  process.exit(1);
}
console.log('\nAll leave join grant checks passed (' + passed + ').');
