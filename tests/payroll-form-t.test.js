/**
 * Form T export tests.
 * Run: node tests/payroll-form-t.test.js
 */
var fs = require('fs');
var path = require('path');

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

var formTSrc = fs.readFileSync(path.join(payrollDir, 'FormTService.gs'), 'utf8');
var formTClient = fs.readFileSync(path.join(payrollDir, 'FormTClient.html'), 'utf8');
var api = fs.readFileSync(path.join(payrollDir, 'ApiPayroll.gs'), 'utf8');
var apiFoundation = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'src', 'foundation', 'ApiFoundation.gs'), 'utf8');
var templatePath = path.join(__dirname, '..', 'apps-script', 'assets', 'templates', 'FormT.xlsx');

check('form-t-service', /FormTService/.test(formTSrc) && /canGenerateFormT_/.test(formTSrc));
check('form-t-build', /buildFormT/.test(formTSrc) && /applyFormTHeader_/.test(formTSrc));
check('form-t-emp-columns', /trim_\(emp\.employee_id\)/.test(formTSrc) && !/employeeRowValues_\(rowNum/.test(formTSrc));
check('form-t-dynamic-month', /MONTH_NAMES_/.test(formTSrc) && /excelSerialFromYmd_/.test(formTSrc));
check('form-t-establishment-block', /ROW_EST_NAME_/.test(formTSrc) && /COL_EST_BLOCK_/.test(formTSrc));
check('form-t-summary-cols', /SUMMARY_COLS_/.test(formTSrc) && /counts\.ML/.test(formTSrc));
check('form-t-days-total', /sum\.days_total/.test(formTSrc));
check('form-t-export-reuse', /AttendanceBulkService\.exportSpreadsheetXlsx_/.test(formTSrc));
check('api-form-t-status', /apiGetFormTStatus/.test(api));
check('api-form-t-download', /apiDownloadFormT/.test(api));
check('form-t-client-route', /registerRoute\('attendance-form-t'/.test(formTClient));
check('form-t-module-ui', /payroll\/FormTClient/.test(apiFoundation));
check('form-t-template-asset', fs.existsSync(templatePath));

if (failures.length) {
  console.log('\n' + failures.length + ' failed:');
  failures.forEach(function (f) { console.log(' - ' + f); });
  process.exit(1);
}
console.log('\nAll payroll-form-t checks passed (' + passed + ')');
