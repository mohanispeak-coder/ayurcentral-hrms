/**
 * Per-user app access flags and per-employee role editing (Node, no deploy).
 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var foundation = path.join(__dirname, '..', 'apps-script', 'src', 'foundation');

function loadUserAccessService(opts) {
  opts = opts || {};
  var auditKinds = [];
  var updatedUsers = [];
  var ctx = {
    HRMS: {
      SHEETS: { USERS: 'Users' },
      ACTIONS: { ADMIN_USERS: 'ADMIN_USERS' },
      ROLES: { OWNER: 'OWNER', ADMIN: 'ADMIN', HR: 'HR', EMPLOYEE: 'EMPLOYEE', MANAGER: 'MANAGER' }
    },
    ConfigService: {
      openSpreadsheet: function () {
        return { getSheetByName: function () { return null; } };
      }
    },
    PermissionService: {
      require: function () {},
      isHrOrAdmin: function (session) {
        return session && (session.role === 'HR' || session.role === 'ADMIN' || session.role === 'OWNER');
      },
      isAdmin: function (session) {
        return session && (session.role === 'ADMIN' || session.role === 'OWNER');
      }
    },
    EmployeeRepository: {
      findById: function (id) { return { employee_id: id }; },
      findUserByEmployeeId: function (id) {
        return opts.user || {
          google_email: 'emp@example.com',
          employee_id: id,
          role: 'EMPLOYEE',
          access_documents: 'TRUE',
          access_payslips: 'TRUE',
          access_leave: 'TRUE'
        };
      },
      updateUser: function (email, updates) {
        updatedUsers.push({ email: email, updates: updates });
      }
    },
    AuthService: { invalidateIdentitySnapshots: function () { ctx.authInvalidated = true; } },
    AuditService: { log: function (kind) { auditKinds.push(kind); } },
    validationError_: function (msg) { throw new Error(msg); },
    authorizationError_: function (msg) { throw new Error(msg || 'denied'); },
    notFoundError_: function (msg) { throw new Error(msg); },
    authInvalidated: false,
    updatedUsers: updatedUsers,
    auditKinds: auditKinds
  };
  vm.runInNewContext(fs.readFileSync(path.join(foundation, 'UserAccessService.gs'), 'utf8'), ctx);
  ctx.UserAccessService._test = ctx;
  return ctx.UserAccessService;
}

var fails = 0;

function check(name, ok, detail) {
  if (!ok) {
    fails++;
    console.error('FAIL', name, detail || '');
  } else {
    console.log('PASS', name);
  }
}

var UserAccessService = loadUserAccessService();
var flags = UserAccessService.flagsFromUser({
  access_documents: 'FALSE',
  access_payslips: 'TRUE',
  access_leave: 'NO'
});
check('parse FALSE documents', flags.access_documents === false);
check('parse TRUE payslips', flags.access_payslips === true);
check('parse NO leave', flags.access_leave === false);

var empSession = {
  authorized: true,
  role: 'EMPLOYEE',
  access: { access_documents: false, access_payslips: true, access_leave: false }
};
check('employee blocked documents', !UserAccessService.hasSelfServiceAccess(empSession, 'documents'));
check('employee allowed payslips', UserAccessService.hasSelfServiceAccess(empSession, 'payslips'));
check('employee blocked leave', !UserAccessService.hasSelfServiceAccess(empSession, 'leave'));

var hrSession = { authorized: true, role: 'HR', access: { access_documents: false, access_payslips: false, access_leave: false } };
check('HR bypasses flags', UserAccessService.hasSelfServiceAccess(hrSession, 'documents'));

var defaults = UserAccessService.newUserAccessDefaults();
check('new user defaults all TRUE', defaults.access_documents === 'TRUE' && defaults.access_payslips === 'TRUE' && defaults.access_leave === 'TRUE');

var hrEditor = { role: 'HR', employee_id: 'EMP001', email: 'hr@example.com' };
var dto = UserAccessService.getEmployeeAccess(hrEditor, 'EMP002');
check('HR can load access', dto.has_login && dto.can_edit_role === false);
check('assignable roles listed', dto.assignable_roles && dto.assignable_roles.indexOf('MANAGER') >= 0);

var adminEditor = { role: 'ADMIN', employee_id: 'EMP001', email: 'admin@example.com' };
var adminDto = UserAccessService.getEmployeeAccess(adminEditor, 'EMP002');
check('admin can_edit_role', adminDto.can_edit_role === true);

var adminSvc = loadUserAccessService();
var adminCtx = adminSvc._test;
adminSvc.saveEmployeeAccess(
  { role: 'ADMIN', employee_id: 'EMP001', email: 'admin@example.com' },
  'EMP002',
  { access_documents: false, role: 'MANAGER' }
);
check('admin role update persisted', adminCtx.updatedUsers[0].updates.role === 'MANAGER');
check('USER_ROLE_UPDATE audited', adminCtx.auditKinds.indexOf('USER_ROLE_UPDATE') >= 0);
check('auth cache invalidated', adminCtx.authInvalidated === true);

var hrSvc = loadUserAccessService();
var hrCtx = hrSvc._test;
hrSvc.saveEmployeeAccess(
  { role: 'HR', employee_id: 'EMP001', email: 'hr@example.com' },
  'EMP002',
  { access_documents: false, role: 'ADMIN' }
);
check('HR cannot change role via payload', !hrCtx.updatedUsers[0].updates.role);
check('HR can still save access', hrCtx.updatedUsers[0].updates.access_documents === 'FALSE');

try {
  loadUserAccessService().getEmployeeAccess({ role: 'HR', employee_id: 'EMP002' }, 'EMP002');
  check('self-edit blocked', false);
} catch (e) {
  check('self-edit blocked', /own login/i.test(e.message));
}

if (fails) {
  console.error(fails + ' test(s) failed');
  process.exit(1);
}
console.log('All user-access tests passed');
