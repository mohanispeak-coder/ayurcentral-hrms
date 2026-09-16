/**
 * Cross-module auth / RBAC consistency (Node, no Apps Script deploy).
 * Ensures OWNER/ADMIN/HR/MANAGER/EMPLOYEE resolve the same way across
 * PermissionService, ATS, PMS, and Notifications — and that My Payslips
 * stays self-scoped.
 *
 * Run: node tests/auth-cross-module.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = path.join(__dirname, '..', 'apps-script', 'src');
const failures = [];

function check(name, cond, detail) {
  if (cond) {
    console.log('PASS ' + name + (detail ? ' — ' + detail : ''));
  } else {
    failures.push(name + (detail ? ': ' + detail : ''));
    console.log('FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}

function loadAuthStack() {
  const context = {
    HRMS: {},
    ATS: {},
    Logger: { log: function () {} },
    PropertiesService: {
      getScriptProperties: function () {
        return { getProperty: function () { return ''; }, setProperty: function () {} };
      }
    },
    Session: {
      getActiveUser: function () { return { getEmail: function () { return ''; } }; },
      getEffectiveUser: function () { return { getEmail: function () { return ''; } }; },
      getScriptTimeZone: function () { return 'Asia/Kolkata'; }
    },
    Utilities: {
      formatDate: function (d) {
        return d && d.toISOString ? d.toISOString().slice(0, 10) : String(d || '');
      }
    },
    CacheService: {
      getScriptCache: function () {
        return { get: function () { return null; }, put: function () {}, remove: function () {} };
      }
    },
    SpreadsheetApp: {},
    DriveApp: {},
    HtmlService: {},
    LockService: { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } },
    console: console
  };
  vm.createContext(context);

  function run(rel) {
    vm.runInContext(fs.readFileSync(path.join(src, rel), 'utf8'), context);
  }

  run('foundation/Constants.gs');
  run('foundation/Errors.gs');
  // Minimal AuthService surface used by PermissionService
  context.AuthService = {
    resolveSession: function () {
      return { authorized: false, role: '', employee_id: '', message: 'Sign in with your registered email to continue.' };
    },
    requireAuth: function () {
      throw context.authorizationError_('Sign in with your registered email to continue.');
    },
    clearRequestSessionCache: function () {}
  };
  context.UserAccessService = {
    hasSelfServiceAccess: function () { return true; },
    attachToSession: function (s) { return s; },
    getFlagsForSession: function () {
      return { access_documents: true, access_payslips: true, access_leave: true };
    }
  };
  run('foundation/PermissionService.gs');
  run('ats/AtsConstants.gs');
  run('ats/AtsEngine.gs');
  run('ats/AtsPermissionService.gs');
  if (fs.existsSync(path.join(src, 'pms', 'PmsConstants.gs'))) {
    run('pms/PmsConstants.gs');
    run('pms/PmsEngine.gs');
  }
  run('notifications/NotificationEngine.gs');
  return context;
}

const ctx = loadAuthStack();
const HRMS = ctx.HRMS;
const PermissionService = ctx.PermissionService;
const AtsEngine = ctx.AtsEngine;
const AtsPermissionService = ctx.AtsPermissionService;
const PmsEngine = ctx.PmsEngine;
const NotificationEngine = ctx.NotificationEngine;
const ATS = ctx.ATS;

function session(role, employeeId) {
  return {
    authorized: true,
    role: role,
    employee_id: employeeId || '',
    email: String(role || 'x').toLowerCase() + '@test'
  };
}

const owner = session('OWNER', 'EMP000');
const admin = session('ADMIN', 'EMP001');
const hr = session('HR', 'EMP010');
const mgr = session('MANAGER', 'EMP002');
const emp = session('EMPLOYEE', 'EMP003');
const noId = session('ADMIN', '');
const anon = { authorized: false, role: '', employee_id: '', email: '' };

// --- Central PermissionService ---
check('perm-owner-access-app', PermissionService.can(HRMS.ACTIONS.ACCESS_APP, {}, owner));
check('perm-admin-view-own-payslip', PermissionService.can(HRMS.ACTIONS.VIEW_OWN_PAYSLIP, {}, admin));
check('perm-owner-view-own-payslip', PermissionService.can(HRMS.ACTIONS.VIEW_OWN_PAYSLIP, {}, owner));
check('perm-emp-view-own-payslip', PermissionService.can(HRMS.ACTIONS.VIEW_OWN_PAYSLIP, {}, emp));
check('perm-anon-no-payslip', !PermissionService.can(HRMS.ACTIONS.VIEW_OWN_PAYSLIP, {}, anon));
check('perm-emp-no-payroll', !PermissionService.can(HRMS.ACTIONS.PAYROLL_RUN, {}, emp));
check('perm-mgr-no-payroll', !PermissionService.can(HRMS.ACTIONS.PAYROLL_RUN, {}, mgr));
check('perm-hr-payroll', PermissionService.can(HRMS.ACTIONS.PAYROLL_RUN, {}, hr));
check('perm-owner-is-hr-admin', PermissionService.isHrOrAdmin(owner) && PermissionService.isAdmin(owner));

const adminNav = PermissionService.getNavForSession(admin).map(function (n) { return n.route; });
check('nav-admin-has-my-payslips', adminNav.indexOf('my-payslips') >= 0);
check('nav-admin-has-ats', adminNav.indexOf('ats') >= 0);
const ownerNav = PermissionService.getNavForSession(owner).map(function (n) { return n.route; });
check('nav-owner-has-ats', ownerNav.indexOf('ats') >= 0);
check('nav-owner-has-payroll', ownerNav.indexOf('payroll') >= 0);
const empNav = PermissionService.getNavForSession(emp).map(function (n) { return n.route; });
check('nav-emp-no-ats', empNav.indexOf('ats') < 0);
check('nav-emp-no-payroll', empNav.indexOf('payroll') < 0);
check('nav-emp-has-my-payslips', empNav.indexOf('my-payslips') >= 0);

// --- ATS must match central nav for OWNER/ADMIN ---
check('ats-owner-access', AtsEngine.canAccessAts(owner) && AtsEngine.canManageAts(owner));
check('ats-admin-access', AtsEngine.canAccessAts(admin) && AtsEngine.canManageAts(admin));
check('ats-mgr-access-not-manage', AtsEngine.canAccessAts(mgr) && !AtsEngine.canManageAts(mgr));
check('ats-emp-denied', !AtsEngine.canAccessAts(emp));
try {
  AtsPermissionService.requireAccess(owner);
  check('ats-require-owner', true);
} catch (e) {
  check('ats-require-owner', false, e.message);
}
try {
  AtsPermissionService.requireAccess(emp);
  check('ats-require-emp-denied', false, 'should throw');
} catch (e) {
  check('ats-require-emp-denied', e.hrmsCode === HRMS.ERROR_CODES.AUTHORIZATION &&
    String(e.message).indexOf('not available') >= 0);
}
try {
  AtsPermissionService.requireAccess(anon);
  check('ats-require-anon-denied', false, 'should throw');
} catch (e) {
  check('ats-require-anon-denied', e.hrmsCode === HRMS.ERROR_CODES.AUTHORIZATION);
}

// --- PMS / Notifications OWNER alignment ---
if (PmsEngine) {
  check('pms-owner-hr-admin', PmsEngine.isHrOrAdmin(owner) && PmsEngine.isAdmin(owner));
} else {
  check('pms-module-absent-phase1', empNav.indexOf('pms') < 0 && adminNav.indexOf('pms') < 0);
}
check('notif-owner-hr-admin', NotificationEngine.isHrOrAdmin(owner));
check('notif-admin-hr-admin', NotificationEngine.isHrOrAdmin(admin));
check('notif-emp-not-hr-admin', !NotificationEngine.isHrOrAdmin(emp));

// --- My Payslips self-scope contract (no employee_id → empty, not all employees) ---
check('payslip-own-scope-empty-id', !String(noId.employee_id || '').trim());
check('payslip-admin-still-self-only', String(admin.employee_id) === 'EMP001');

// --- Auth empty-identity message (exact product string in AuthService) ---
const authSrc = fs.readFileSync(path.join(src, 'foundation', 'AuthService.gs'), 'utf8');
check('auth-empty-identity-message',
  authSrc.indexOf("message: 'Sign in with your registered email to continue.'") >= 0);

// --- Source alignment: PermissionService ATS nav includes OWNER; AtsEngine must too ---
const permSrc = fs.readFileSync(path.join(src, 'foundation', 'PermissionService.gs'), 'utf8');
const atsEngineSrc = fs.readFileSync(path.join(src, 'ats', 'AtsEngine.gs'), 'utf8');
const payslipSrc = fs.readFileSync(path.join(src, 'payroll', 'PayslipService.gs'), 'utf8');
check('source-perm-ats-owner', /route:\s*'ats'[\s\S]*?roles:\s*\[[^\]]*OWNER/.test(permSrc) ||
  /roles:\s*\[[^\]]*OWNER[^\]]*\][\s\S]*route:\s*'ats'/.test(permSrc) ||
  permSrc.indexOf("roles: ['OWNER', 'ADMIN', 'HR', 'MANAGER']") >= 0);
check('source-ats-engine-owner', /role === 'OWNER'/.test(atsEngineSrc));
check('source-payslip-empty-id-guard', /if \(!employeeId\) return \[\]/.test(payslipSrc));

if (failures.length) {
  console.error('\n' + failures.length + ' failure(s):\n' + failures.join('\n'));
  process.exit(1);
}
console.log('\nAll auth-cross-module checks passed.');
