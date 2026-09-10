/**
 * Compensation bulk upload + mandatory structure tests.
 * Run: node tests/compensation-bulk.test.js
 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var payrollDir = path.join(__dirname, '..', 'apps-script', 'src', 'payroll');
var failures = [];
var passed = 0;

function read(rel) {
  return fs.readFileSync(path.join(payrollDir, rel), 'utf8');
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

var comp = read('CompensationService.gs');
var bulk = read('CompensationBulkService.gs');
var api = read('ApiPayroll.gs');
var client = read('PayrollClient.html');

check('required-component-specs', /REQUIRED_COMPONENT_SPECS_/.test(comp) && /EMPLOYER_PF/.test(comp));
check('ensure-required-components', /ensureRequiredComponents_/.test(comp));
check('effective-from-required', /effective_from is required/.test(comp));
check('ctc-required-zero-ok', /parseCtc_\(payload\.ctc_monthly, true\)/.test(comp));
check('bulk-row-builder', /buildComponentsFromBulkRow_/.test(comp));
check('bulk-service-exists', /var CompensationBulkService/.test(bulk));
check('bulk-csv-xlsx', /Upload a \.csv or \.xlsx file/.test(bulk));
check('bulk-all-headers-required', /REQUIRED_HEADERS_ = HEADERS_\.slice\(\)/.test(bulk));
check('bulk-duplicate-reject', /Duplicate employee row/.test(bulk));
check('bulk-api-template', /apiDownloadCompensationBulkTemplate/.test(api));
check('bulk-api-validate', /apiValidateCompensationBulkUpload/.test(api));
check('bulk-api-commit', /apiCommitCompensationBulkUpload/.test(api));
check('ui-comp-bulk', /comp-bulk-details/.test(client) && /apiValidateCompensationBulkUpload/.test(client));

function loadBulkService() {
  var ctx = {
    HRMS: {
      ACTIONS: { PAYROLL_RUN: 'PAYROLL_RUN' },
      SHEETS: {
        SALARY_STRUCTURES: 'SalaryStructures',
        SALARY_COMPONENTS: 'SalaryComponents',
        PAYROLL_RECORDS: 'PayrollRecords',
        PAYROLL_RUNS: 'PayrollRuns'
      },
      STRUCTURE_STATUS: { CURRENT: 'CURRENT' },
      PAYROLL_STATUS: { LOCKED: 'LOCKED' },
      CALC_METHOD: { FIXED: 'FIXED', PERCENT_OF_BASIC: 'PERCENT_OF_BASIC' }
    },
    CompensationService: {
      listEmployeeOptions: function () {
        return [{ employee_id: 'SAPL-0001', display_name: 'Ravi', status: 'ACTIVE' }];
      },
      buildComponentsFromBulkRow: function (row) {
        return [
          { component_code: 'BASIC', amount: Number(row.basic) || 0 },
          { component_code: 'HRA', percent: Number(row.hra_percent) || 0 }
        ];
      },
      saveStructure: function () { return { structure: { salary_structure_id: 'SS-1' } }; }
    },
    DbService: {
      getAllRecords: function () { return []; },
      findRecords: function () { return []; }
    },
    PermissionService: { require: function () {} },
    AuthService: { requireAuth: function () { return { email: 'hr@test.com' }; } },
    DriveApp: { createFile: function () { return { getBlob: function () {}, setTrashed: function () {} }; } },
    Drive: { Files: { create: function () { return { id: 'x' }; } } },
    MimeType: { GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet' },
    SpreadsheetApp: {},
    Utilities: {
      parseCsv: function (text) {
        return text.split('\n').map(function (line) { return line.split(','); });
      },
      getUuid: function () { return 'uuid-comp-1'; },
      base64Encode: function () { return 'abc'; },
      newBlob: function (c) { return { getBytes: function () { return Buffer.from(c); } }; }
    },
    CacheService: {
      getScriptCache: function () {
        return { put: function () {}, get: function () { return null; }, remove: function () {} };
      }
    },
    AuditService: { log: function () {} },
    withScriptLock_: function (fn) { return fn(); },
    validationError_: function (msg) { var e = new Error(msg); e.hrmsCode = 'VALIDATION'; throw e; },
    authorizationError_: function (msg) { throw new Error(msg); },
    configurationError_: function (msg) { throw new Error(msg); }
  };
  vm.runInNewContext(bulk, ctx);
  return ctx.CompensationBulkService;
}

var Bulk = loadBulkService();
var csv = 'employee_id,effective_from,ctc_monthly,basic,hra_percent,sa,pf_percent,esi,pt,employer_pf_percent\n' +
  'SAPL-0001,2026-01-01,25000,12000,40,0,12,0,200,12\n';
var rows = Bulk.parseCsvRows(csv);
check('parse-csv-rows', rows.length === 1 && rows[0].employee_id === 'SAPL-0001');
var valid = Bulk.validateRows(rows);
check('validate-valid-row', valid.validCount === 1 && valid.errorCount === 0);

var dupRows = rows.concat([{ rowNumber: 3, employee_id: 'SAPL-0001', effective_from: '2026-02-01', ctc_monthly: '0',
  basic: '0', hra_percent: '0', sa: '0', pf_percent: '0', esi: '0', pt: '0', employer_pf_percent: '0' }]);
var dup = Bulk.validateRows(dupRows);
check('reject-duplicate-employee', dup.errorCount >= 1);

var missingCtc = [{ rowNumber: 2, employee_id: 'SAPL-0001', effective_from: '2026-01-01', ctc_monthly: '',
  basic: '0', hra_percent: '0', sa: '0', pf_percent: '0', esi: '0', pt: '0', employer_pf_percent: '0' }];
var miss = Bulk.validateRows(missingCtc);
check('reject-missing-ctc', miss.errorCount === 1);

var zeroCtc = [{ rowNumber: 2, employee_id: 'SAPL-0001', effective_from: '2026-01-01', ctc_monthly: '0',
  basic: '0', hra_percent: '0', sa: '0', pf_percent: '0', esi: '0', pt: '0', employer_pf_percent: '0' }];
var zero = Bulk.validateRows(zeroCtc);
check('allow-zero-ctc', zero.validCount === 1);

if (failures.length) {
  console.log('\n' + failures.length + ' failed:');
  failures.forEach(function (f) { console.log(' - ' + f); });
  process.exit(1);
}
console.log('\nAll compensation-bulk checks passed (' + passed + ')');
