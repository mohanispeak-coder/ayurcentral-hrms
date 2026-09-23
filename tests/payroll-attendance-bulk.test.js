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
    HRMS: { ACTIONS: { PAYROLL_RUN: 'PAYROLL_RUN' } },
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

check('register-service', /AttendanceRegisterService/.test(regSrc));
check('bulk-service', /AttendanceBulkService/.test(bulkSrc) && /TEMPLATE_VERSION_ = '4'/.test(bulkSrc));
check('template-header-styles', /applyAttendanceHeaderStyles_/.test(bulkSrc) && /setBackground/.test(bulkSrc));
check('list-active-via-service', /EmployeeService\.listActiveEmployees/.test(regSrc));
check('list-eligible-for-period', /listEmployeesForPayrollPeriod_/.test(regSrc));
check('api-attendance-auto-sync', /apiListAttendanceRegister[\s\S]*syncEligibleEmployees/.test(api));
var payrollSvc = fs.readFileSync(path.join(payrollDir, 'PayrollService.gs'), 'utf8');
check('payroll-sync-on-employee', /syncOpenPayrollRunsForEmployee/.test(payrollSvc));
check('template-headers', /buildTemplateHeaders_/.test(regSrc) && /SUMMARY_HEADERS_/.test(regSrc));
check('api-attendance-template', /apiDownloadAttendanceRegisterTemplate/.test(api));
check('api-attendance-validate', /apiValidateAttendanceRegisterUpload/.test(api));
check('api-list-register', /apiListAttendanceRegister/.test(api));
check('attendance-client-route', /registerRoute\('attendance-bulk-upload'/.test(attClient));
check('attendance-list-columns', /<th class="num">DAYS<\/th>/.test(attClient) && /WO/.test(attClient) && /ML/.test(attClient));
check('payroll-bulk-no-attendance-columns', /'employee_id', 'display_name', 'work_email'/.test(payrollBulkSrc) &&
  !/'working_days', 'days_present'/.test(payrollBulkSrc));

var sum = Reg.summarize_({ '01': 'P', '02': 'W/H', '03': 'A', '04': 'L', '05': 'S' }, 2026, 1);
check('summarize-present', sum.present === 1 && sum.absent === 1 && sum.leave_days === 2);

var derived = Reg.derivePayrollDays_(sum);
check('derive-paid-lop', derived.paid_days >= 1 && derived.lop_days === 1);

if (failures.length) {
  console.log('\n' + failures.length + ' failed:');
  failures.forEach(function (f) { console.log(' - ' + f); });
  process.exit(1);
}
console.log('\nAll payroll-attendance-bulk checks passed (' + passed + ')');
