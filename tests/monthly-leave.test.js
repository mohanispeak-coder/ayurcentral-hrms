/**
 * Monthly leave v2 smoke tests.
 * Run: node tests/monthly-leave.test.js
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

var monthlySrc = fs.readFileSync(path.join(root, 'leave', 'MonthlyLeaveService.gs'), 'utf8');
var regSrc = fs.readFileSync(path.join(root, 'payroll', 'AttendanceRegisterService.gs'), 'utf8');
var attClient = fs.readFileSync(path.join(root, 'payroll', 'AttendanceClient.html'), 'utf8');
var payrollClient = fs.readFileSync(path.join(root, 'payroll', 'PayrollClient.html'), 'utf8');
var bulkSrc = fs.readFileSync(path.join(root, 'payroll', 'AttendanceBulkService.gs'), 'utf8');

check('monthly-leave-service', /MonthlyLeaveService/.test(monthlySrc) && /getSnapshot/.test(monthlySrc));
check('schema-adjustments-sheet', /LEAVE_MONTHLY_ADJUSTMENTS/.test(
  fs.readFileSync(path.join(root, 'foundation', 'Constants.gs'), 'utf8')));
check('register-half-day', /'1\/2P'/.test(regSrc) && /HALFP/.test(regSrc));
check('attendance-preview-grid-wired', /paintPreviewGrid_/.test(attClient) &&
  /Validated attendance/.test(attClient) && /paintPreviewGrid_\(preview\.valid/.test(attClient));
check('payroll-preview-grid', /paintAttendanceValidGrid_/.test(payrollClient) &&
  /Validation result/.test(payrollClient));
check('bulk-preview-leave-fields', /monthly_grant/.test(bulkSrc) && /leave_balance/.test(bulkSrc));
check('template-leave-pool-column', /leave_pool/.test(regSrc) && /monthlyPoolForTemplateRow_/.test(regSrc));
check('template-leave-balance-no-absent-in-pool', /leave_pool/.test(regSrc) &&
  /function leaveBalanceFormula_/.test(regSrc) && !/leaveBalanceFormula_[\s\S]{0,400}COUNTIF\(.+,"A"\)/.test(regSrc));
check('template-version-10', /TEMPLATE_VERSION_ = '10'/.test(bulkSrc));
check('template-l-pool-capped', /poolLeave\.paidL/.test(regSrc));
check('template-a-includes-excess-leave', /A: '=COUNTIF\([\s\S]*poolLeave\.excess/.test(regSrc));
check('template-p-includes-half', /P: '=COUNTIF/.test(regSrc) && /halfDayCountExpr_\(range, true\)/.test(regSrc));
check('template-no-half-column', !/'1\/2P': '=/.test(regSrc));
check('validate-returns-period', /period_year: run\.period_year/.test(bulkSrc));

function loadRegister() {
  var ctx = {
    HRMS: { ATTENDANCE_LEAVE_BALANCE_MAX: { SAPL: 2, OTHERS: 2 } },
    DbService: { findOne: function () { return null; }, findRecords: function () { return []; } },
    ConfigService: { getSetting: function (k, d) { return d; } },
    MonthlyLeaveService: {
      availableAfterCounts_: function (emp, y, m, counts) {
        var used = (counts.L || 0) + (counts.ML || 0) + ((counts['1/2P'] || 0) * 0.5);
        return Math.max(0, 2 - used);
      },
      grantForEmployeeMonth_: function () { return 2; }
    },
    notFoundError_: function (m) { throw new Error(m); },
    validationError_: function (m) { throw new Error(m); }
  };
  vm.runInNewContext(regSrc, ctx);
  return ctx.AttendanceRegisterService;
}

var Reg = loadRegister();
var sum = Reg.summarize_({ '01': '1/2P', '02': 'L' }, 2026, 3, 'SAPL', { employee_id: 'SAPL-001', vertical_name: 'SAPL' });
check('half-day-leave-math', sum.leave_days === 1.5 && sum.present === 0.5 &&
  sum.leave_days_l_column === 1.5 && sum.absent_a_column === 0);
var derivedHalfLeave = Reg.derivePayrollDays_(sum);
check('half-day-leave-paid-within-pool', (derivedHalfLeave.paid_leave_days || 0) >= 1.5);
var sumAbsent = Reg.summarize_({ '01': 'A', '02': 'L' }, 2026, 3, 'SAPL', { employee_id: 'SAPL-001', vertical_name: 'SAPL' });
check('lop-absent-does-not-eat-leave-pool', sumAbsent.code_counts.A === 1 && sumAbsent.leave_balance === 1);
var derivedAbsent = Reg.derivePayrollDays_(sumAbsent);
check('absent-code-is-lop', derivedAbsent.lop_days === 1 && derivedAbsent.days_absent === 1);
var sumLeaveOnly = Reg.summarize_({ '01': 'L', '02': 'L', '03': 'L' }, 2026, 3, 'SAPL',
  { employee_id: 'SAPL-001', vertical_name: 'SAPL', joining_date: '2020-01-01' });
var derivedLeave = Reg.derivePayrollDays_(sumLeaveOnly);
check('excess-l-is-lop-not-a', (derivedLeave.lop_from_excess_leave || 0) >= 1 && derivedLeave.days_absent === 0);

if (failures.length) {
  console.log('\n' + failures.length + ' failed:');
  failures.forEach(function (f) { console.log(' - ' + f); });
  process.exit(1);
}
console.log('\nAll monthly-leave checks passed (' + passed + ')');
