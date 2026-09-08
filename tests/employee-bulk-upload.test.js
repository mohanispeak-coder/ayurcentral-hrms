/**
 * Bulk upload parse + validation tests (Node, no deploy).
 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var employeeDir = path.join(__dirname, '..', 'apps-script', 'src', 'employee');
var foundationDir = path.join(__dirname, '..', 'apps-script', 'src', 'foundation');

function loadBulkService() {
  var ctx = {
    HRMS: {
      ACTIONS: { EMPLOYEE_CREATE: 'EMPLOYEE_CREATE', EMPLOYEE_DIRECTORY: 'EMPLOYEE_DIRECTORY' },
      ROLES: { HR: 'HR' }
    },
    EmployeeService: {
      listDirectory: function () {
        return { departments: ['Ops'], locations: ['HQ'] };
      },
      normalizeEmployeeId: function (id) { return String(id || '').trim().toUpperCase(); },
      isValidEmployeeIdFormat: function (id) { return /^(SAPL|AOPL|AOMS)-\d{4}$/.test(id); },
      parseCreateUserFlag: function (v) { return String(v).toUpperCase() === 'YES'; }
    },
    EmployeeRepository: {
      listAll: function () { return []; },
      findById: function () { return null; },
      findByWorkEmail: function () { return null; },
      findUserByEmail: function () { return null; }
    },
    PermissionService: { require: function () {} },
    DriveApp: {},
    Drive: { Files: { export: function () {}, create: function () {} } },
    MimeType: { GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet' },
    Utilities: {
      parseCsv: function (text) {
        return text.split('\n').map(function (line) {
          return line.split(',');
        });
      },
      base64Encode: function (bytes) { return Buffer.from(bytes).toString('base64'); },
      newBlob: function (content, mime, name) {
        return {
          getBytes: function () { return Buffer.from(content, 'utf8'); },
          getContentType: function () { return mime; }
        };
      },
      getUuid: function () { return 'uuid-1'; }
    },
    CacheService: {
      getScriptCache: function () {
        return { put: function () {}, get: function () { return null; }, remove: function () {} };
      }
    },
    AuditService: { log: function () {} },
    validationError_: function (msg) { var e = new Error(msg); e.hrmsCode = 'VALIDATION'; throw e; },
    authorizationError_: function (msg) { throw new Error(msg || 'denied'); },
    configurationError_: function (msg) { throw new Error(msg); },
    notFoundError_: function (msg) { throw new Error(msg); }
  };
  vm.runInNewContext(fs.readFileSync(path.join(employeeDir, 'EmployeeBulkService.gs'), 'utf8'), ctx);
  return ctx.EmployeeBulkService;
}

var Bulk = loadBulkService();
var fails = 0;

function check(name, ok, detail) {
  if (!ok) {
    fails++;
    console.error('FAIL', name, detail || '');
  } else {
    console.log('PASS', name);
  }
}

var csv = 'employee_id,first_name,last_name,work_email,department,designation,location,employment_type,joining_date,create_login\n' +
  'SAPL-0002,Ana,Shah,ana@example.com,Ops,Exec,HQ,PERMANENT,2026-01-01,NO\n';
var rows = Bulk.parseCsvRows(csv);
check('parse csv row count', rows.length === 1);
check('parse csv employee id', rows[0].employee_id === 'SAPL-0002');

var session = { email: 'hr@test', role: 'HR' };
var result = Bulk.validateRows(rows, session);
check('validate one valid row', result.validCount === 1 && result.errorCount === 0);

var badRows = [{ rowNumber: 2, employee_id: 'BAD', first_name: '', last_name: 'X', work_email: 'bad', department: '', designation: '', location: '', employment_type: '', joining_date: '', create_login: '' }];
var bad = Bulk.validateRows(badRows, session);
check('validate catches bad id', bad.errorCount === 1);

var csvTpl = Bulk.downloadCsvTemplate({ email: 'hr@test' });
check('csv template has base64', csvTpl.fileName.indexOf('.csv') >= 0 && csvTpl.base64.length > 10);

if (fails) {
  console.error(fails + ' test(s) failed');
  process.exit(1);
}
console.log('All bulk upload tests passed');
