/**
 * Per-user app access flags (Node, no deploy).
 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var foundation = path.join(__dirname, '..', 'apps-script', 'src', 'foundation');

function loadUserAccessService() {
  var ctx = {
    HRMS: {
      SHEETS: { USERS: 'Users' },
      ACTIONS: { ADMIN_USERS: 'ADMIN_USERS' },
      ROLES: { ADMIN: 'ADMIN', HR: 'HR', EMPLOYEE: 'EMPLOYEE', MANAGER: 'MANAGER' }
    },
    ConfigService: {
      openSpreadsheet: function () {
        return {
          getSheetByName: function () { return null; }
        };
      }
    },
    PermissionService: {
      require: function () {},
      isHrOrAdmin: function (session) {
        return session && (session.role === 'HR' || session.role === 'ADMIN');
      }
    },
    EmployeeRepository: {
      findById: function (id) { return { employee_id: id }; },
      findUserByEmployeeId: function () { return null; },
      updateUser: function () {}
    },
    AuthService: { invalidateIdentitySnapshots: function () {} },
    AuditService: { log: function () {} },
    validationError_: function (msg) { throw new Error(msg); },
    authorizationError_: function (msg) { throw new Error(msg || 'denied'); },
    notFoundError_: function (msg) { throw new Error(msg); }
  };
  vm.runInNewContext(fs.readFileSync(path.join(foundation, 'UserAccessService.gs'), 'utf8'), ctx);
  return ctx.UserAccessService;
}

var UserAccessService = loadUserAccessService();
var fails = 0;

function check(name, ok, detail) {
  if (!ok) {
    fails++;
    console.error('FAIL', name, detail || '');
  } else {
    console.log('PASS', name);
  }
}

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

if (fails) {
  console.error(fails + ' test(s) failed');
  process.exit(1);
}
console.log('All user-access tests passed');
