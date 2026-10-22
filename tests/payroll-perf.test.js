/**
 * Source-level contracts for payroll performance (Phase 1).
 * Run: node tests/payroll-perf.test.js
 */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'apps-script', 'src');
const failures = [];

function read(rel) {
  return fs.readFileSync(path.join(src, rel), 'utf8');
}

function fnBlock(source, name, nextName) {
  const start = source.indexOf('function ' + name);
  if (start < 0) return '';
  if (!nextName) return source.slice(start);
  const end = source.indexOf('function ' + nextName, start + 1);
  return end < 0 ? source.slice(start) : source.slice(start, end);
}

function check(name, cond, detail) {
  if (cond) {
    console.log('PASS ' + name + (detail ? ' — ' + detail : ''));
  } else {
    failures.push(name + (detail ? ': ' + detail : ''));
    console.log('FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}

const db = read('foundation/DbService.gs');
const payroll = read('payroll/PayrollService.gs');
const payslip = read('payroll/PayslipService.gs');
const lop = read('leave/LeaveLopService.gs');
const bridge = read('payroll/PayrollLeaveBridge.gs');
const api = read('payroll/ApiPayroll.gs');
const client = read('payroll/PayrollClient.html');
const compensation = read('payroll/CompensationService.gs');

check('db-replace-records', /function replaceRecords/.test(db) && /rewriteSheetData_/.test(db));
check('db-delete-no-deleterow', !/\.deleteRow\(/.test(db));
check('db-rewrite-setvalues', /function rewriteSheetData_[\s\S]*setValues\(values\)/.test(db));
check('db-exports-replace', /replaceRecords:\s*replaceRecords/.test(db));

const saveFn = fnBlock(payroll, 'saveInputs', 'refreshLopFromLeave');
check('save-lock', /withScriptLock_/.test(saveFn));
check('save-batch-update', /DbService\.updateRecords\(HRMS\.SHEETS\.PAYROLL_INPUTS/.test(saveFn));
check('save-no-per-row-update', !/DbService\.updateRecord\(/.test(saveFn));
check('save-validate-before-write', /items\.push\(/.test(saveFn) && /if \(items\.length\)/.test(saveFn));
check('save-skip-resync', /DETAIL_AFTER_MUTATION_/.test(saveFn));

const refreshFn = fnBlock(payroll, 'refreshLopFromLeave', 'applyLeaveLopToDays');
check('lop-refresh-batch', /updateRecords\(HRMS\.SHEETS\.PAYROLL_INPUTS/.test(refreshFn));
check('lop-refresh-map', /getApprovedLopMapForPayroll/.test(refreshFn));
check('lop-refresh-no-per-row', !/updateRecord\(/.test(refreshFn) && !/getApprovedLopForPayroll\(/.test(refreshFn));

const applyFn = fnBlock(payroll, 'applyLeaveLopToDays', 'calculate');
check('lop-apply-batch', /updateRecords\(HRMS\.SHEETS\.PAYROLL_INPUTS/.test(applyFn));
check('lop-apply-map', /getApprovedLopMapForPayroll/.test(applyFn));
check('lop-apply-no-per-row', !/updateRecord\(/.test(applyFn));

const calcFn = fnBlock(payroll, 'calculate', 'submitForReview');
check('calc-replace-records', /replaceRecords\(HRMS\.SHEETS\.PAYROLL_RECORDS/.test(calcFn));
check('calc-no-deleterecords', !/deleteRecords\(/.test(calcFn));
check('calc-skip-resync', /DETAIL_AFTER_MUTATION_/.test(calcFn));
check('calc-lock', /withScriptLock_/.test(calcFn));
check('calc-still-rewrites-on-calculated', /DRAFT/.test(calcFn) && /CALCULATED/.test(calcFn));

check('detail-skip-sync-option', /options\.skipSync/.test(payroll));
check('sync-already-locked', /options\.alreadyLocked/.test(fnBlock(payroll, 'syncEligibleEmployees', 'isEmployeeEligibleForPeriod')));
check('seed-uses-lop-map', /function seedInputs_[\s\S]*getApprovedLopMapForPayroll/.test(payroll));
check('api-get-run-still-syncs', /PayrollService\.getRunDetail\(runId\)/.test(api));
check('payload-omits-breakdown', /delete out\.component_breakdown/.test(payroll));
check('ui-does-not-read-breakdown', !/component_breakdown/.test(client));

const genFn = fnBlock(payslip, 'generateForRun', 'generateForEmployee');
check('payslip-folder-once', (genFn.match(/getPayslipMonthFolder/g) || []).length === 1);
check('payslip-batch-docs-insert', /insertRecords\(HRMS\.SHEETS\.DOCUMENTS/.test(genFn));
check('payslip-batch-docs-update', /updateRecords\(HRMS\.SHEETS\.DOCUMENTS/.test(genFn));
check('payslip-batch-record-update', /updateRecords\(HRMS\.SHEETS\.PAYROLL_RECORDS/.test(genFn));
check('payslip-no-per-row-sheet-write', !/updateRecord\(/.test(genFn) && !/insertRecord\(/.test(genFn));
check('payslip-still-writes-drive-files', /writePayslipFile_/.test(payslip) && /createFile\(/.test(payslip) && /setTrashed\(/.test(payslip));
check('payslip-one-path', /generateForEmployee[\s\S]*generateForRun\(run, \[record\]/.test(payslip));

check('lop-map-fn', /function computeLopMapForPeriod/.test(lop));
check('lop-map-exported', /computeLopMapForPeriod:\s*computeLopMapForPeriod/.test(lop));
check('bridge-map', /function getApprovedLopMapForPayroll/.test(bridge));
check('comp-replace-batch', /replaceRecords\(HRMS\.SHEETS\.SALARY_COMPONENTS/.test(compensation));

if (failures.length) {
  console.error('\n' + failures.length + ' failed');
  process.exit(1);
}
console.log('\nAll payroll-perf contracts passed');
