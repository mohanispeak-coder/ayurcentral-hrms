/**
 * Employee ID format + bulk CSV validation tests (Node, no deploy).
 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var root = path.join(__dirname, '..', 'apps-script', 'src', 'employee');

function loadEmployeeService() {
  var ctx = {
    HRMS: {
      SHEETS: { EMPLOYEES: 'Employees', USERS: 'Users', LEAVE_TYPES: 'LeaveTypes', LEAVE_BALANCES: 'LeaveBalances' },
      ROLES: { EMPLOYEE: 'EMPLOYEE', ADMIN: 'ADMIN', HR: 'HR', MANAGER: 'MANAGER' },
      USER_STATUS: { ACTIVE: 'ACTIVE' },
      EMPLOYEE_STATUS: { ACTIVE: 'ACTIVE' },
      ERROR_CODES: { VALIDATION: 'VALIDATION', AUTHORIZATION: 'AUTHORIZATION' },
      ACTIONS: { EMPLOYEE_CREATE: 'EMPLOYEE_CREATE', EMPLOYEE_UPDATE: 'EMPLOYEE_UPDATE', EMPLOYEE_DIRECTORY: 'EMPLOYEE_DIRECTORY' }
    },
    EmployeeRepository: {
      findById: function () { return null; },
      findByWorkEmail: function () { return null; },
      findUserByEmail: function () { return null; },
      insert: function (rec) { ctx._inserted = rec; },
      insertUser: function () {},
      listAll: function () { return []; },
      listActiveLeaveTypes: function () { return []; },
      update: function () {},
      findUserByEmployeeId: function () { return null; }
    },
    PermissionService: {
      require: function () {},
      isHrOrAdmin: function () { return true; }
    },
    AuthService: { requireAuth: function () { return ctx.session; } },
    ConfigService: { getTimezone: function () { return 'Asia/Kolkata'; }, getSetting: function (k, d) { return d; } },
    LeaveService: { grantBalancesForEmployee: function () { return []; } },
    DriveService: { getEmployeeDocumentsFolder: function () { return { getId: function () { return 'f1'; } }; } },
    AuditService: { log: function () {} },
    DbService: { nextEmployeeId: function () { return 'EMP999'; }, nextEmployeeIdAssumingLocked: function () { return 'EMP999'; } },
    withScriptLock_: function (fn) { return fn(); },
    validationError_: function (msg, details) { var e = new Error(msg); e.hrmsCode = 'VALIDATION'; e.details = details || {}; throw e; },
    authorizationError_: function (msg) { var e = new Error(msg || 'denied'); e.hrmsCode = 'AUTHORIZATION'; throw e; },
    notFoundError_: function (msg) { throw new Error(msg); },
    conflictError_: function (msg) { throw new Error(msg); },
    systemError_: function (msg) { throw new Error(msg); }
  };
  ctx.session = { email: 'hr@test', role: 'HR', authorized: true, employee_id: 'SAPL-0009' };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'EmployeeService.gs'), 'utf8'), ctx);
  return ctx.EmployeeService;
}

var EmployeeService = loadEmployeeService();
var fails = 0;

function check(name, ok, detail) {
  if (!ok) {
    fails++;
    console.error('FAIL', name, detail || '');
  } else {
    console.log('PASS', name);
  }
}

check('valid SAPL id', EmployeeService.isValidEmployeeIdFormat('SAPL-0001'));
check('valid AOPL id', EmployeeService.isValidEmployeeIdFormat('aopl-0042'));
check('reject EMP id', !EmployeeService.isValidEmployeeIdFormat('EMP001'));
check('reject missing dash', !EmployeeService.isValidEmployeeIdFormat('SAPL0001'));
check('normalize uppercase', EmployeeService.normalizeEmployeeId('sapl-0001') === 'SAPL-0001');
check('parse create login YES', EmployeeService.parseCreateUserFlag('YES') === true);
check('parse create login NO', EmployeeService.parseCreateUserFlag('NO') === false);

try {
  EmployeeService.createEmployee(
    { email: 'hr@test', role: 'HR', authorized: true },
    {
      employee_id: 'AOMS-0099',
      first_name: 'Bulk',
      last_name: 'Test',
      work_email: 'bulk.emp@example.com',
      department: 'HR',
      designation: 'Exec',
      location: 'HQ',
      employment_type: 'PERMANENT',
      joining_date: '2026-02-01',
      create_user: true,
      google_login_email: 'bulk.emp@example.com'
    }
  );
  check('create without auto id', true);
} catch (e) {
  check('create without auto id', false, e.message);
}

try {
  EmployeeService.createEmployee(
    { email: 'hr@test', role: 'HR', authorized: true },
    {
      first_name: 'No',
      last_name: 'Id',
      work_email: 'noid@example.com',
      department: 'HR',
      designation: 'Exec',
      location: 'HQ',
      employment_type: 'PERMANENT',
      joining_date: '2026-02-01',
      create_user: false
    }
  );
  check('missing employee id blocked', false);
} catch (e) {
  check('missing employee id blocked', e.hrmsCode === 'VALIDATION');
}

if (fails) {
  console.error(fails + ' test(s) failed');
  process.exit(1);
}
console.log('All employee bulk/id tests passed');
