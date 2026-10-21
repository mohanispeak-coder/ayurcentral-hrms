/**
 * Attendance register bulk upload tests.
 * Run: node tests/payroll-attendance-bulk.test.js
 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var payrollDir = path.join(__dirname, '..', 'apps-script', 'src', 'payroll');
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

var regSrc = fs.readFileSync(path.join(payrollDir, 'AttendanceRegisterService.gs'), 'utf8');
var bulkSrc = fs.readFileSync(path.join(payrollDir, 'AttendanceBulkService.gs'), 'utf8');
var payrollBulkSrc = fs.readFileSync(path.join(payrollDir, 'PayrollBulkService.gs'), 'utf8');
var attClient = fs.readFileSync(path.join(payrollDir, 'AttendanceClient.html'), 'utf8');
var api = fs.readFileSync(path.join(payrollDir, 'ApiPayroll.gs'), 'utf8');

function loadRegister() {
  var ctx = {
    HRMS: {
      ACTIONS: { PAYROLL_RUN: 'PAYROLL_RUN' },
      ATTENDANCE_LEAVE_BALANCE_MAX: { AOPL: 2, SAPL: 2, AOMS: 1, OTHERS: 2 }
    },
    PermissionService: { require: function () {} },
    DbService: { findOne: function () { return null; }, findRecords: function () { return []; } },
    EmployeeRepository: { listAll: function () { return []; } },
    notFoundError_: function (m) { throw new Error(m); },
    validationError_: function (m) { throw new Error(m); }
  };
  vm.runInNewContext(regSrc, ctx);
  return ctx.AttendanceRegisterService;
}

var Reg = loadRegister();

var permSrc = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'src', 'foundation', 'PermissionService.gs'), 'utf8');
check('permission-attendance-access', /requireAttendanceAccess/.test(permSrc) &&
  /isModuleEnabledForRole\(session\.role, 'attendance'\)/.test(permSrc));
check('register-uses-central-attendance-access', /PermissionService\.requireAttendanceAccess/.test(regSrc));
check('register-service', /AttendanceRegisterService/.test(regSrc));
check('bulk-service', /AttendanceBulkService/.test(bulkSrc) && /TEMPLATE_VERSION_ = '13'/.test(bulkSrc));
check('days-formula-sums-summary-p-through-h', /DAYS: '=SUM\('/.test(regSrc) && /sumColH = sumColP \+ 6/.test(regSrc));
check('attendance-payroll-extra-columns', /TDS, Advance, LCD, LWF/.test(bulkSrc) &&
  /AttendancePayrollExtras/.test(regSrc));
check('template-header-styles', /applyAttendanceHeaderStyles_/.test(bulkSrc) && /setBackground/.test(bulkSrc));
check('list-active-via-service', /EmployeeService\.listActiveEmployees/.test(regSrc));
check('list-eligible-for-period', /listEmployeesForPayrollPeriod_/.test(regSrc));
check('api-attendance-sync-optional', /syncEmployeesOrToken/.test(api) &&
  /syncEmployees = syncEmployeesOrToken === true/.test(api) && /includeRegister:\s*false/.test(api));
check('attendance-list-cache', /listCacheByRun_/.test(attClient) && /fetchAttendanceList_/.test(attClient));
check('register-list-run-vertical', /runVerticalFromRun_/.test(regSrc) &&
  /filterEmployeesByVertical_\(employees, runVertical\)/.test(regSrc));
check('attendance-register-no-full-payroll-on-open',
  /apiListAttendanceRegister/.test(attClient) && !/apiGetPayrollRun/.test(attClient));
var payrollSvc = fs.readFileSync(path.join(payrollDir, 'PayrollService.gs'), 'utf8');
check('payroll-sync-on-employee', /syncOpenPayrollRunsForEmployee/.test(payrollSvc));
check('payroll-refresh-days-on-calculate', /refreshAttendanceDerivedDays_/.test(payrollSvc) &&
  /applyDerivedDaysToInput_/.test(regSrc));
check('template-headers', /buildTemplateHeaders_/.test(regSrc) && /SUMMARY_HEADERS_/.test(regSrc));
check('api-attendance-template', /apiDownloadAttendanceRegisterTemplate\(runId, verticalName, sessionToken\)/.test(api));
check('api-attendance-validate', /apiValidateAttendanceRegisterUpload\(runId, verticalName, meta, sessionToken\)/.test(api));
check('api-list-register', /apiListAttendanceRegister/.test(api));
check('attendance-client-route', /registerRoute\('attendance-bulk-upload'/.test(attClient));
check('attendance-client-validate-step', /att-validate-upload/.test(attClient) &&
  /apiValidateAttendanceRegisterUpload/.test(attClient) && /att-commit/.test(attClient) &&
  /apiCommitAttendanceRegisterUpload/.test(attClient));
check('attendance-list-columns', /<th class="num">DAYS<\/th>/.test(attClient) && /WO/.test(attClient) && /ML/.test(attClient));
check('attendance-register-p-merged', !attClient.match(/codes = \['P', 'W\/H', 'A', 'L', 'WO', 'ML', 'H', '1\/2P'\]/) &&
  /days_present/.test(attClient));
check('normalize-half-day-space', Reg.normalizeCode_('1/2 P') === '1/2P' && Reg.normalizeCode_('1/2p') === '1/2P');
check('excel-half-summary-formula', /halfDayCountExpr_/.test(regSrc) && /CHAR\(47\)/.test(regSrc));
check('template-pool-aware-l-a', /poolAwareLeaveExprs_/.test(regSrc) &&
  /A: '=COUNTIF\([\s\S]*poolLeave\.excess/.test(regSrc));
check('template-formulas-grid-range', /setFormulas\(formulaGrid\)/.test(bulkSrc));
check('upload-uses-display-values', /getDisplayValues\(\)/.test(bulkSrc));
check('payroll-bulk-no-attendance-columns', /'employee_id', 'display_name', 'work_email'/.test(payrollBulkSrc) &&
  !/'working_days', 'days_present'/.test(payrollBulkSrc));

var sum = Reg.summarize_({ '01': 'P', '02': 'W/H', '03': 'A', '04': 'L', '05': 'S' }, 2026, 1);
check('summarize-present', sum.present === 1 && sum.absent === 1 && sum.leave_days === 2);

var derived = Reg.derivePayrollDays_(sum);
check('derive-paid-lop', derived.paid_days >= 1 && derived.lop_days === 1);

var sumExcess = Reg.summarize_({
  '01': 'L', '02': 'L', '03': 'L', '04': 'P'
}, 2026, 1, 'AOPL', { employee_id: 'AOPL-1', vertical_name: 'AOPL', joining_date: '2020-01-01' });
var derivedExcess = Reg.derivePayrollDays_(sumExcess);
check('excess-leave-lop', (derivedExcess.lop_from_excess_leave || 0) >= 1 &&
  derivedExcess.lop_days >= (derivedExcess.lop_from_excess_leave || 0));

var sumHalf = Reg.summarize_({
  '01': '1/2P', '02': 'P', '03': 'A', '04': 'A', '05': 'A'
}, 2026, 9, 'SAPL', { employee_id: 'SAPL-1', vertical_name: 'SAPL', joining_date: '2020-01-01' });
check('half-day-present-split', sumHalf.present === 1.5 && sumHalf.leave_days === 0.5 &&
  sumHalf.code_counts['1/2P'] === 1);
var derivedHalf = Reg.derivePayrollDays_(sumHalf);
check('working-equals-paid-plus-lop', Math.abs(derivedHalf.working_days - (derivedHalf.paid_days + derivedHalf.lop_days)) < 0.001,
  'working=' + derivedHalf.working_days + ' paid=' + derivedHalf.paid_days + ' lop=' + derivedHalf.lop_days);

var sumAL = Reg.summarize_({ '01': 'A', '02': 'L' }, 2026, 9, 'SAPL',
  { employee_id: 'SAPL-1', vertical_name: 'SAPL', joining_date: '2020-01-01' });
var derivedAL = Reg.derivePayrollDays_(sumAL);
check('a-counts-as-lop-only', derivedAL.lop_days >= 1 && derivedAL.days_absent === 1);

var staleInp = {
  employee_id: 'SAPL-1',
  daily_attendance_json: JSON.stringify({ '01': '1/2P', '02': 'P', '03': 'P' }),
  working_days: 30,
  paid_days: 30,
  lop_days: 0
};
var empHalf = { employee_id: 'SAPL-1', vertical_name: 'SAPL', joining_date: '2020-01-01' };
var refreshedInp = Reg.applyDerivedDaysToInput_(staleInp, 2026, 9, 'SAPL', empHalf);
check('payroll-refresh-half-day-paid', refreshedInp.paid_days === 3 &&
  refreshedInp.paid_days !== staleInp.paid_days,
  'paid=' + refreshedInp.paid_days + ' (2.5 present + 0.5 paid leave from ½P)');

var rockyReg = {
  '01': '1/2P', '02': '1/2P', '03': 'L', '04': 'A', '05': 'A', '06': 'A'
};
var rockySum = Reg.summarize_(rockyReg, 2026, 9, 'SAPL',
  { employee_id: 'SAPL-0077', vertical_name: 'SAPL', joining_date: '2020-01-01' });
check('half-leave-in-l-when-pool-ok', rockySum.leave_days_l_column === 2 && rockySum.absent_a_column === 3,
  'L=' + rockySum.leave_days_l_column + ' A=' + rockySum.absent_a_column);

var poolFullReg = { '01': 'L', '02': 'L', '03': '1/2P', '04': 'A' };
var poolFullSum = Reg.summarize_(poolFullReg, 2026, 9, 'SAPL',
  { employee_id: 'SAPL-1', vertical_name: 'SAPL', joining_date: '2020-01-01' });
check('half-over-pool-goes-to-a', poolFullSum.leave_days_l_column === 2 && poolFullSum.absent_a_column === 1.5,
  'L=' + poolFullSum.leave_days_l_column + ' A=' + poolFullSum.absent_a_column);

var arvindReg = {
  '01': 'P', '02': 'H', '03': 'P', '04': 'W/H', '05': 'P', '06': 'P', '07': 'P', '08': 'P', '09': 'P', '10': 'P',
  '11': 'W/H', '12': 'P', '13': 'P', '14': 'P', '15': 'P', '16': 'P', '17': 'P', '18': 'W/H', '19': 'H', '20': 'H',
  '21': 'H', '22': 'P', '23': 'L', '24': 'P', '25': 'W/H', '26': 'P', '27': '1/2P', '28': 'P', '29': 'P', '30': '1/2P', '31': 'P'
};
var arvindSum = Reg.summarize_(arvindReg, 2026, 1, 'SAPL',
  { employee_id: 'SAPL-0315', vertical_name: 'SAPL', joining_date: '2020-01-01' });
check('days-total-counts-half-days-as-full-cells', arvindSum.days_total === 31 && arvindSum.days_in_month === 31,
  'days_total=' + arvindSum.days_total);
check('days-total-equals-summary-p-through-h', arvindSum.days_total ===
  arvindSum.present + arvindSum.week_off_holiday + arvindSum.absent_a_column +
  arvindSum.leave_days_l_column + arvindSum.week_off + arvindSum.medical_leave_l_column + arvindSum.holiday);

if (failures.length) {
  console.log('\n' + failures.length + ' failed:');
  failures.forEach(function (f) { console.log(' - ' + f); });
  process.exit(1);
}
console.log('\nAll payroll-attendance-bulk checks passed (' + passed + ')');
