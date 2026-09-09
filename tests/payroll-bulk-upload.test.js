/**
 * Payroll bulk upload + finalize UX tests.
 * Run: node tests/payroll-bulk-upload.test.js
 */
var fs = require('fs');
var path = require('path');

var root = path.join(__dirname, '..', 'apps-script', 'src');
var failures = [];
var passed = 0;

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function check(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log('PASS ' + name + (detail ? ' — ' + detail : ''));
  } else {
    failures.push(name + (detail ? ': ' + detail : ''));
    console.log('FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}

var bulk = read('payroll/PayrollBulkService.gs');
var payroll = read('payroll/PayrollService.gs');
var api = read('payroll/ApiPayroll.gs');
var client = read('payroll/PayrollClient.html');
var perm = read('foundation/PermissionService.gs');
var scripts = read('ui/Scripts.html');
var employee = read('employee/EmployeeClient.html');
var payslip = read('payroll/PayslipService.gs');

check('bulk-service-exists', /var PayrollBulkService/.test(bulk));
check('bulk-xlsx-only', /CSV is not supported/.test(bulk) && /Only \.xlsx files are supported/.test(bulk));
check('bulk-no-auto-create', /cannot be created from Excel/.test(bulk));
check('bulk-duplicate-reject', /Duplicate employee row/.test(bulk));
check('bulk-stage-cache', /STAGE_PREFIX_/.test(bulk) && /validateUpload/.test(bulk) && /commitUpload/.test(bulk));
check('bulk-atomic-lock', /withScriptLock_/.test(bulk));
check('bulk-preview-no-save', !/commitUpload[\s\S]{0,200}validateUpload/.test(bulk));

check('finalize-method', /function finalizePayroll/.test(payroll));
check('finalize-skips-payslips', /generatePayslips: false/.test(payroll));
check('humanize-exceptions', /humanizeExceptionFlag_/.test(payroll) && /Salary structure is not configured/.test(payroll));
check('exception-summary', /exceptionSummary/.test(payroll));
check('ui-phase', /uiPhaseForStatus_/.test(payroll));

check('api-finalize', /apiFinalizePayroll/.test(api));
check('api-bulk-template', /apiDownloadPayrollTemplate/.test(api));
check('api-bulk-validate', /apiValidatePayrollUpload/.test(api));
check('api-bulk-commit', /apiCommitPayrollUpload/.test(api));

check('one-page-ui', /paintUnifiedPayroll_/.test(client));
check('finalize-button', /apiFinalizePayroll/.test(client) && /Finalize payroll/i.test(client));
check('excel-upload-ui', /apiValidatePayrollUpload/.test(client) && /Download Excel Template/.test(client));
check('generate-all-payslips', /Generate all payslips/i.test(client));
check('no-run-id-in-previous-payrolls', !/paintPreviousPayrolls_[\s\S]{0,600}payroll_run_id/.test(client));
check('compensation-delegates', /renderCompensation[\s\S]*openSalaryStructure: true/.test(client));
check('payroll-run-delegates', /renderPayrollRun[\s\S]*renderPayrollHome/.test(client));

check('compensation-removed-nav', !/route:\s*'compensation'/.test(perm));
check('payroll-route-alias', /'payroll-run':\s*'payroll'/.test(scripts) && /compensation:\s*'payroll'/.test(scripts));
check('compensation-open-param', /openSalaryStructure = true/.test(scripts));

check('employee-payslip-copy', /No payslips available yet/.test(employee) && !/after payroll is locked/.test(employee));
check('my-payslips-copy', /No payslips available yet/.test(client) && /View payslip/.test(client));

check('payslip-redesign', /amountInWords_/.test(payslip) && /Salary Payslip/.test(payslip));
check('employee-search-helper', /matchesEmployeeSearch_/.test(client) && /employeeSearchHay_/.test(client));
check('directory-search-expanded', /matchesEmployeeSearch_/.test(read('employee/EmployeeService.gs')));
check('bulk-drive-v3-export', /drive\/v3\/files/.test(bulk) && /SpreadsheetApp\.flush/.test(bulk));
check('bulk-csv-fallback', /buildTemplateCsv_/.test(bulk) && /CSV fallback/.test(bulk));
check('bulk-sync-eligible', /syncEligibleEmployees/.test(payroll) && /syncEligibleEmployees\(runId\)/.test(bulk));
check('bulk-template-all-employees', /templateDataRows_/.test(bulk));
check('comp-editor-bundle-api', /apiGetCompensationEditorBundle/.test(api) && /getEditorBundle/.test(read('payroll/CompensationService.gs')));
check('finalize-blockers-detail', /finalizeBlockers/.test(payroll) && /buildFinalizeBlockers_/.test(payroll));
check('fix-structure-actions', /js-fix-structure/.test(client) && /openSalaryStructureForEmployee_/.test(client));
check('fix-pan-actions', /js-fix-pan/.test(client) && /tab:\s*'personal'/.test(client));
check('per-employee-payslip', /js-gen-payslip/.test(client) && /apiRegeneratePayslipForEmployee/.test(api) &&
  /regeneratePayslipForEmployee/.test(payroll));
check('per-employee-payslip-notify', /notifyPayslipsAvailable[\s\S]*\[snapshot\.record\]/.test(payroll) &&
  /Generate & notify/.test(client));
check('structure-gap-hint', /explainStructureGap/.test(read('payroll/CompensationService.gs')) &&
  /enrichExceptionMessage_/.test(payroll));
check('comp-editor-fallback', /renderCompEditor_/.test(client) && /loadWarning/.test(client));
check('comp-serialize-bundle', /serializeEditorBundle_/.test(read('payroll/CompensationService.gs')));

if (failures.length) {
  console.log('\n' + failures.length + ' failed:');
  failures.forEach(function (f) { console.log(' - ' + f); });
  process.exit(1);
}
console.log('\nAll payroll-bulk-upload checks passed (' + passed + ')');
