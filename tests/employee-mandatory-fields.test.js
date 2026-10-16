/**
 * Employee mandatory field config + integration with bulk validation.
 * Run: node tests/employee-mandatory-fields.test.js
 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var employeeDir = path.join(__dirname, '..', 'apps-script', 'src', 'employee');
var foundationDir = path.join(__dirname, '..', 'apps-script', 'src', 'foundation');

var fails = 0;

function check(name, ok, detail) {
  if (!ok) {
    fails++;
    console.error('FAIL', name, detail || '');
  } else {
    console.log('PASS', name);
  }
}

function loadMandatoryService(storedJson) {
  var settingsStore = storedJson || '';
  var ctx = {
    HRMS: {
      ACTIONS: { EMPLOYEE_CREATE: 'EMPLOYEE_CREATE' },
      SHEETS: { SETTINGS: 'Settings' }
    },
    ConfigService: {
      getSetting: function (key, def) {
        if (key === 'employee_mandatory_fields_json') return settingsStore;
        return def;
      },
      clearSettingsCache: function () {}
    },
    DbService: {
      findOne: function () {
        return { setting_key: 'employee_mandatory_fields_json', setting_value: settingsStore };
      },
      updateRecord: function (sheet, pk, key, patch) {
        settingsStore = patch.setting_value;
      }
    },
    SchemaService: { seedMissingDefaultSettings: function () {} },
    AuthService: { getSession: function () { return { email: 'hr@test.com' }; } },
    PermissionService: { require: function () {} },
    configurationError_: function (msg) { throw new Error(msg); }
  };
  vm.runInNewContext(fs.readFileSync(path.join(employeeDir, 'EmployeeMandatoryFieldService.gs'), 'utf8'), ctx);
  return { svc: ctx.EmployeeMandatoryFieldService, getStored: function () { return settingsStore; } };
}

function loadBulkWithMandatory(storedJson) {
  var mandatory = loadMandatoryService(storedJson);
  var ctx = {
    HRMS: {
      ACTIONS: { EMPLOYEE_CREATE: 'EMPLOYEE_CREATE', EMPLOYEE_DIRECTORY: 'EMPLOYEE_DIRECTORY' },
      ROLES: { HR: 'HR' },
      STRUCTURE_TYPE_STATUS: { ACTIVE: 'ACTIVE' }
    },
    EmployeeMandatoryFieldService: mandatory.svc,
    EmployeeService: {
      listDirectory: function () { return { departments: ['Ops'], locations: ['HQ'] }; },
      listVerticals: function () { return ['AOPL', 'SAPL', 'AOMS']; },
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
        return text.split('\n').map(function (line) { return line.split(','); });
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
  return { Bulk: ctx.EmployeeBulkService, mandatory: mandatory };
}

var base = loadMandatoryService('');
var cfg = base.svc.listConfig();
var defaultBulk = base.svc.listMandatoryFieldIds('bulk');
var expectedDefault = [
  'employee_id', 'first_name', 'last_name', 'work_email', 'department', 'designation',
  'vertical_name', 'joining_date', 'employment_type', 'location', 'create_login'
];
check('default bulk mandatory matches legacy headers', JSON.stringify(defaultBulk.sort()) === JSON.stringify(expectedDefault.sort()));
check('employee_id locked mandatory', base.svc.isMandatory('employee_id') === true);
check('bank_ifsc not mandatory by default', base.svc.isMandatory('bank_ifsc') === false);

base.svc.saveConfig({ fields: [{ id: 'bank_ifsc', mandatory: true }, { id: 'phone', mandatory: true }] });
check('save persists bank_ifsc', base.svc.isMandatory('bank_ifsc') === true);
check('save persists phone', base.svc.isMandatory('phone') === true);
check('stored json omits locked-only noise', base.getStored().indexOf('employee_id') >= 0);

var bulkCtx = loadBulkWithMandatory(base.getStored());
var rowNoIfsc = [{
  rowNumber: 2,
  employee_id: 'SAPL-0003',
  first_name: 'A',
  last_name: 'B',
  work_email: 'a@example.com',
  department: 'Ops',
  designation: 'Exec',
  vertical_name: 'SAPL',
  location: 'HQ',
  employment_type: 'PERMANENT',
  joining_date: '2026-01-01',
  create_login: 'NO',
  bank_account_number: '123',
  bank_ifsc: ''
}];
var v1 = bulkCtx.Bulk.validateRows(rowNoIfsc, { email: 'hr@test', role: 'HR' });
check('bank pair rule when ifsc mandatory', v1.errorCount === 1);

bulkCtx.mandatory.svc.saveConfig({ fields: [{ id: 'bank_ifsc', mandatory: false }, { id: 'bank_account_number', mandatory: false }] });
var v2 = bulkCtx.Bulk.validateRows(rowNoIfsc, { email: 'hr@test', role: 'HR' });
check('bank pair rule when ifsc optional', v2.errorCount === 1 && v2.errors[0].messages.some(function (e) {
  return e.field === 'bank_ifsc';
}));

var rowComplete = [Object.assign({}, rowNoIfsc[0], { bank_ifsc: 'HDFC0001234' })];
var v3 = bulkCtx.Bulk.validateRows(rowComplete, { email: 'hr@test', role: 'HR' });
check('valid row with bank pair filled', v3.validCount === 1);

var perm = fs.readFileSync(path.join(foundationDir, 'PermissionService.gs'), 'utf8');
var settings = fs.readFileSync(path.join(foundationDir, 'SettingsAdminService.gs'), 'utf8');
check('nav item registered', perm.indexOf("'employee-mandatory-fields'") >= 0);
check('employees module includes mandatory nav', settings.indexOf('employee-mandatory-fields') >= 0);

var schema = fs.readFileSync(path.join(foundationDir, 'SchemaService.gs'), 'utf8');
check('settings seed key present', schema.indexOf('employee_mandatory_fields_json') >= 0);

if (fails) {
  console.error(fails + ' test(s) failed');
  process.exit(1);
}
console.log('All employee mandatory field tests passed');
