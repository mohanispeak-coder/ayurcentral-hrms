/**
 * Payroll attendance bulk upload tests.
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

function loadPayrollBulk() {
  var bulkSrc = fs.readFileSync(path.join(payrollDir, 'PayrollBulkService.gs'), 'utf8');
  var ctx = {
    HRMS: { PAYROLL_STATUS: { LOCKED: 'LOCKED', DRAFT: 'DRAFT', CALCULATED: 'CALCULATED' } },
    Utilities: {
      parseCsv: function (text) {
        return text.split('\n').map(function (line) { return line.split(','); });
      }
    },
    validationError_: function (msg) { throw new Error(msg); }
  };
  vm.runInNewContext(bulkSrc, ctx);
  return ctx.PayrollBulkService;
}

var Bulk = loadPayrollBulk();
var bulkSrc = fs.readFileSync(path.join(payrollDir, 'PayrollBulkService.gs'), 'utf8');
var client = fs.readFileSync(path.join(payrollDir, 'PayrollClient.html'), 'utf8');

check('template-v3', /TEMPLATE_VERSION_ = '3'/.test(bulkSrc));
check('attendance-headers', /days_present/.test(bulkSrc) && /days_absent/.test(bulkSrc) && /leave_days/.test(bulkSrc));
check('employee-info-columns', /display_name/.test(bulkSrc) && /work_email/.test(bulkSrc) && /listTemplateEmployees_/.test(bulkSrc));
check('download-not-blocked-locked', /assertRunExists_/.test(bulkSrc) && /buildTemplateSpreadsheet_[\s\S]*assertRunExists_/.test(bulkSrc));
check('bind-download-always', /bindBulkUpload_[\s\S]*btn-dl-template[\s\S]*if \(!editable\)/.test(client));
check('derive-attendance', /deriveAttendanceDays_/.test(bulkSrc));
check('csv-supported', /Upload a \.csv or \.xlsx file/.test(bulkSrc));
check('no-csv-reject', !/CSV is not supported/.test(bulkSrc));
check('ui-csv-accept', /accept="\.xlsx,\.xls,\.csv/.test(client));
check('ui-validate-button', /btn-pr-bulk-validate/.test(client) && /Validate upload/.test(client));

var derived = Bulk.deriveAttendanceDays({ days_present: '24', days_absent: '1', leave_days: '1' }, 26);
check('paid-days-formula', derived.paid_days === 25 && derived.lop_days === 1);
check('attendance-mode', derived.mode === 'attendance');

var legacy = Bulk.deriveAttendanceDays({ paid_days: '25', lop_days: '1' }, 26);
check('legacy-mode', legacy.mode === 'legacy' && legacy.paid_days === 25);

var over = Bulk.deriveAttendanceDays({ days_present: '20', leave_days: '10' }, 26);
check('reject-over-paid', !!over.error);

var csv = 'employee_id,working_days,days_present,days_absent,leave_days\nSAPL-0001,26,24,1,1\n';
var rows = Bulk.parseCsvRows(csv);
check('parse-csv', rows.length === 1 && rows[0].working_days === '26');

if (failures.length) {
  console.log('\n' + failures.length + ' failed:');
  failures.forEach(function (f) { console.log(' - ' + f); });
  process.exit(1);
}
console.log('\nAll payroll-attendance-bulk checks passed (' + passed + ')');
