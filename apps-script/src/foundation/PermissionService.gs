/**
 * Centralized server-side authorization.
 */
var HRMS = HRMS || {};

var PermissionService = (function () {
  var ROLE_RANK_ = {};
  ROLE_RANK_[HRMS.ROLES.EMPLOYEE] = 1;
  ROLE_RANK_[HRMS.ROLES.MANAGER] = 2;
  ROLE_RANK_[HRMS.ROLES.HR] = 3;
  ROLE_RANK_[HRMS.ROLES.ADMIN] = 4;

  /** @type {Object.<string, Array.<string>>} */
  var ACTION_ROLES_ = {};
  ACTION_ROLES_[HRMS.ACTIONS.ACCESS_APP] = [HRMS.ROLES.ADMIN, HRMS.ROLES.HR, HRMS.ROLES.MANAGER, HRMS.ROLES.EMPLOYEE];
  ACTION_ROLES_[HRMS.ACTIONS.ASK_HR] = [HRMS.ROLES.ADMIN, HRMS.ROLES.HR, HRMS.ROLES.MANAGER, HRMS.ROLES.EMPLOYEE];
  ACTION_ROLES_[HRMS.ACTIONS.RUN_SETUP] = [HRMS.ROLES.ADMIN];
  ACTION_ROLES_[HRMS.ACTIONS.ADMIN_SETTINGS] = [HRMS.ROLES.ADMIN];
  ACTION_ROLES_[HRMS.ACTIONS.ADMIN_USERS] = [HRMS.ROLES.ADMIN];
  ACTION_ROLES_[HRMS.ACTIONS.VIEW_AUDIT] = [HRMS.ROLES.ADMIN, HRMS.ROLES.HR];
  ACTION_ROLES_[HRMS.ACTIONS.EMPLOYEE_DIRECTORY] = [HRMS.ROLES.ADMIN, HRMS.ROLES.HR, HRMS.ROLES.MANAGER];
  ACTION_ROLES_[HRMS.ACTIONS.EMPLOYEE_CREATE] = [HRMS.ROLES.ADMIN, HRMS.ROLES.HR];
  ACTION_ROLES_[HRMS.ACTIONS.EMPLOYEE_UPDATE] = [HRMS.ROLES.ADMIN, HRMS.ROLES.HR, HRMS.ROLES.MANAGER, HRMS.ROLES.EMPLOYEE];
  ACTION_ROLES_[HRMS.ACTIONS.EMPLOYEE_STATUS] = [HRMS.ROLES.ADMIN, HRMS.ROLES.HR];
  ACTION_ROLES_[HRMS.ACTIONS.EMPLOYEE_DOCUMENTS] = [HRMS.ROLES.ADMIN, HRMS.ROLES.HR, HRMS.ROLES.EMPLOYEE];
  ACTION_ROLES_[HRMS.ACTIONS.LEAVE_APPLY] = [HRMS.ROLES.ADMIN, HRMS.ROLES.HR, HRMS.ROLES.MANAGER, HRMS.ROLES.EMPLOYEE];
  ACTION_ROLES_[HRMS.ACTIONS.LEAVE_APPROVE] = [HRMS.ROLES.ADMIN, HRMS.ROLES.HR, HRMS.ROLES.MANAGER];
  ACTION_ROLES_[HRMS.ACTIONS.LEAVE_ADMIN] = [HRMS.ROLES.ADMIN, HRMS.ROLES.HR];
  ACTION_ROLES_[HRMS.ACTIONS.PAYROLL_RUN] = [HRMS.ROLES.ADMIN, HRMS.ROLES.HR];
  ACTION_ROLES_[HRMS.ACTIONS.COMPENSATION_MANAGE] = [HRMS.ROLES.ADMIN, HRMS.ROLES.HR];
  ACTION_ROLES_[HRMS.ACTIONS.VIEW_OWN_PAYSLIP] = [HRMS.ROLES.ADMIN, HRMS.ROLES.HR, HRMS.ROLES.MANAGER, HRMS.ROLES.EMPLOYEE];

  var NAV_ITEMS_ = [
    { id: 'dashboard', label: 'Dashboard', route: 'dashboard', icon: 'dashboard', roles: ['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'] },
    { id: 'my-profile', label: 'My Profile', route: 'my-profile', icon: 'person', roles: ['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'] },
    { id: 'employees', label: 'Employees', route: 'employees', icon: 'people', roles: ['ADMIN', 'HR'] },
    { id: 'my-team', label: 'My Team', route: 'my-team', icon: 'group', roles: ['MANAGER'] },
    { id: 'pms', label: 'Performance', route: 'pms', icon: 'dashboard', roles: ['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'] },
    { id: 'pms-my-review', label: 'My review', route: 'pms-my-review', icon: 'person', roles: ['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'] },
    { id: 'pms-team', label: 'Team reviews', route: 'pms-team', icon: 'group', roles: ['ADMIN', 'HR', 'MANAGER'] },
    { id: 'pms-cycles', label: 'Review cycles', route: 'pms-cycles', icon: 'event', roles: ['ADMIN', 'HR'] },
    { id: 'pms-appraisal', label: 'Appraisals', route: 'pms-appraisal', icon: 'approval', roles: ['ADMIN', 'HR'] },
    { id: 'leave-admin', label: 'Leave', route: 'leave-admin', icon: 'event', roles: ['ADMIN', 'HR'] },
    { id: 'leave-approvals', label: 'Leave Approvals', route: 'leave-approvals', icon: 'approval', roles: ['ADMIN', 'HR', 'MANAGER'] },
    { id: 'my-leave', label: 'My Leave', route: 'my-leave', icon: 'calendar', roles: ['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'] },
    { id: 'payroll', label: 'Payroll', route: 'payroll', icon: 'payments', roles: ['ADMIN', 'HR'] },
    { id: 'compensation', label: 'Compensation', route: 'compensation', icon: 'account_balance', roles: ['ADMIN', 'HR'] },
    { id: 'my-payslips', label: 'My Payslips', route: 'my-payslips', icon: 'receipt', roles: ['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'] },
    { id: 'ats', label: 'Recruitment', route: 'ats', icon: 'group', roles: ['ADMIN', 'HR', 'MANAGER'] },
    { id: 'ats-jobs', label: 'Jobs', route: 'ats-jobs', icon: 'event', roles: ['ADMIN', 'HR', 'MANAGER'] },
    { id: 'ats-candidates', label: 'Candidates', route: 'ats-candidates', icon: 'people', roles: ['ADMIN', 'HR', 'MANAGER'] },
    { id: 'notifications', label: 'Notifications', route: 'notifications', icon: 'mail', roles: ['ADMIN', 'HR'] },
    { id: 'settings', label: 'Settings', route: 'settings', icon: 'settings', roles: ['ADMIN'], placeholder: true },
    { id: 'users', label: 'Users', route: 'users', icon: 'admin_panel_settings', roles: ['ADMIN'], placeholder: true }
  ];

  function hasRole_(session, allowedRoles) {
    return allowedRoles.indexOf(session.role) >= 0;
  }

  /**
   * @param {string} action HRMS.ACTIONS value.
   * @param {Object=} context Optional { targetEmployeeId } for future scope checks.
   * @param {Object=} session Optional pre-resolved session.
   * @return {boolean}
   */
  function can(action, context, session) {
    context = context || {};
    session = session || AuthService.resolveSession();
    if (!session.authorized) return false;
    var allowed = ACTION_ROLES_[action];
    if (!allowed) return false;
    if (!hasRole_(session, allowed)) return false;

    if (action === HRMS.ACTIONS.EMPLOYEE_DIRECTORY && session.role === HRMS.ROLES.MANAGER) {
      return true;
    }

    return true;
  }

  /**
   * @param {string} action HRMS.ACTIONS value.
   * @param {Object=} context Optional { targetEmployeeId } for future scope checks.
   * @param {Object=} session Optional pre-resolved session (e.g. immediately after OTP verify).
   * @return {Object} Authorized session.
   */
  function require(action, context, session) {
    context = context || {};
    if (!session) {
      session = AuthService.requireAuth();
    } else if (!session.authorized) {
      throw authorizationError_(session.message || 'Access denied.');
    }
    var tPerm = Date.now();
    if (!can(action, context, session)) {
      throw authorizationError_();
    }
    if (typeof HrmsPerf !== 'undefined') {
      if (HrmsPerf.addStage) HrmsPerf.addStage('permission', Date.now() - tPerm);
      if (HrmsPerf.count) HrmsPerf.count('permissionRequire');
    }
    return session;
  }

  function getNavForRole(role) {
    role = String(role || '').toUpperCase();
    return NAV_ITEMS_.filter(function (item) {
      return item.roles.indexOf(role) >= 0;
    });
  }

  function isAdmin(session) {
    return session && session.role === HRMS.ROLES.ADMIN;
  }

  function isHrOrAdmin(session) {
    return session && (session.role === HRMS.ROLES.HR || session.role === HRMS.ROLES.ADMIN);
  }

  return {
    can: can,
    require: require,
    getNavForRole: getNavForRole,
    isAdmin: isAdmin,
    isHrOrAdmin: isHrOrAdmin
  };
})();
