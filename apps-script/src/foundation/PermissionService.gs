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
  ROLE_RANK_[HRMS.ROLES.OWNER] = 5;

  /** @type {Object.<string, Array.<string>>} */
  var ACTION_ROLES_ = {};
  ACTION_ROLES_[HRMS.ACTIONS.ACCESS_APP] = [HRMS.ROLES.OWNER, HRMS.ROLES.ADMIN, HRMS.ROLES.HR, HRMS.ROLES.MANAGER, HRMS.ROLES.EMPLOYEE];
  ACTION_ROLES_[HRMS.ACTIONS.ASK_HR] = [HRMS.ROLES.OWNER, HRMS.ROLES.ADMIN, HRMS.ROLES.HR, HRMS.ROLES.MANAGER, HRMS.ROLES.EMPLOYEE];
  ACTION_ROLES_[HRMS.ACTIONS.RUN_SETUP] = [HRMS.ROLES.OWNER, HRMS.ROLES.ADMIN];
  ACTION_ROLES_[HRMS.ACTIONS.ADMIN_SETTINGS] = [HRMS.ROLES.OWNER, HRMS.ROLES.ADMIN, HRMS.ROLES.HR];
  ACTION_ROLES_[HRMS.ACTIONS.ADMIN_USERS] = [HRMS.ROLES.OWNER, HRMS.ROLES.ADMIN];
  ACTION_ROLES_[HRMS.ACTIONS.VIEW_AUDIT] = [HRMS.ROLES.OWNER, HRMS.ROLES.ADMIN, HRMS.ROLES.HR];
  ACTION_ROLES_[HRMS.ACTIONS.EMPLOYEE_DIRECTORY] = [HRMS.ROLES.OWNER, HRMS.ROLES.ADMIN, HRMS.ROLES.HR, HRMS.ROLES.MANAGER];
  ACTION_ROLES_[HRMS.ACTIONS.EMPLOYEE_CREATE] = [HRMS.ROLES.OWNER, HRMS.ROLES.ADMIN, HRMS.ROLES.HR];
  ACTION_ROLES_[HRMS.ACTIONS.EMPLOYEE_UPDATE] = [HRMS.ROLES.OWNER, HRMS.ROLES.ADMIN, HRMS.ROLES.HR, HRMS.ROLES.MANAGER, HRMS.ROLES.EMPLOYEE];
  ACTION_ROLES_[HRMS.ACTIONS.EMPLOYEE_STATUS] = [HRMS.ROLES.OWNER, HRMS.ROLES.ADMIN, HRMS.ROLES.HR];
  ACTION_ROLES_[HRMS.ACTIONS.EMPLOYEE_DOCUMENTS] = [
    HRMS.ROLES.OWNER, HRMS.ROLES.ADMIN, HRMS.ROLES.HR, HRMS.ROLES.MANAGER, HRMS.ROLES.EMPLOYEE
  ];
  ACTION_ROLES_[HRMS.ACTIONS.LEAVE_APPLY] = [HRMS.ROLES.OWNER, HRMS.ROLES.ADMIN, HRMS.ROLES.HR, HRMS.ROLES.MANAGER, HRMS.ROLES.EMPLOYEE];
  ACTION_ROLES_[HRMS.ACTIONS.LEAVE_APPROVE] = [HRMS.ROLES.OWNER, HRMS.ROLES.ADMIN, HRMS.ROLES.HR, HRMS.ROLES.MANAGER];
  ACTION_ROLES_[HRMS.ACTIONS.LEAVE_ADMIN] = [HRMS.ROLES.OWNER, HRMS.ROLES.ADMIN, HRMS.ROLES.HR];
  ACTION_ROLES_[HRMS.ACTIONS.PAYROLL_RUN] = [HRMS.ROLES.OWNER, HRMS.ROLES.ADMIN, HRMS.ROLES.HR];
  ACTION_ROLES_[HRMS.ACTIONS.ATTENDANCE_MANAGE] = [HRMS.ROLES.OWNER, HRMS.ROLES.ADMIN, HRMS.ROLES.HR];
  ACTION_ROLES_[HRMS.ACTIONS.COMPENSATION_MANAGE] = [HRMS.ROLES.OWNER, HRMS.ROLES.ADMIN, HRMS.ROLES.HR];
  ACTION_ROLES_[HRMS.ACTIONS.VIEW_OWN_PAYSLIP] = [HRMS.ROLES.OWNER, HRMS.ROLES.ADMIN, HRMS.ROLES.HR, HRMS.ROLES.MANAGER, HRMS.ROLES.EMPLOYEE];
  ACTION_ROLES_[HRMS.ACTIONS.ATS_ACCESS] = [HRMS.ROLES.OWNER, HRMS.ROLES.ADMIN, HRMS.ROLES.HR, HRMS.ROLES.MANAGER];
  ACTION_ROLES_[HRMS.ACTIONS.ATS_MANAGE] = [HRMS.ROLES.OWNER, HRMS.ROLES.ADMIN, HRMS.ROLES.HR];

  function normalizeUserRole_(role) {
    var r = String(role || '').trim().toUpperCase();
    if (!r) return '';
    if (r === 'ADMINISTRATOR' || r === 'SYSTEM ADMIN' || r === 'SYSADMIN' ||
        r === 'ADMIN USER' || r === 'COMPANY ADMIN') return HRMS.ROLES.ADMIN;
    if (r === 'SUPERADMIN' || r === 'SUPER_ADMIN') return HRMS.ROLES.OWNER;
    return r;
  }

  var NAV_ITEMS_ = [
    { id: 'dashboard', label: 'Dashboard', route: 'dashboard', icon: 'dashboard', roles: ['OWNER', 'ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'] },
    { id: 'my-profile', label: 'My Profile', route: 'my-profile', icon: 'person', roles: ['OWNER', 'ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'] },
    { id: 'employees', label: 'Employees', route: 'employees', icon: 'people', roles: ['OWNER', 'ADMIN', 'HR'] },
    { id: 'employee-mandatory-fields', label: 'Mandatory fields', route: 'employee-mandatory-fields', icon: 'people', roles: ['OWNER', 'ADMIN', 'HR'] },
    { id: 'my-team', label: 'My Team', route: 'my-team', icon: 'group', roles: ['MANAGER'] },
    { id: 'leave-admin', label: 'Leave', route: 'leave-admin', icon: 'event', roles: ['OWNER', 'ADMIN', 'HR'] },
    { id: 'leave-approvals', label: 'Leave Approvals', route: 'leave-approvals', icon: 'approval', roles: ['OWNER', 'ADMIN', 'HR', 'MANAGER'] },
    { id: 'my-leave', label: 'My Leave', route: 'my-leave', icon: 'calendar', roles: ['OWNER', 'ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'] },
    { id: 'salary-structure', label: 'Salary structure', route: 'salary-structure', icon: 'account_balance', roles: ['OWNER', 'ADMIN', 'HR'] },
    { id: 'attendance-bulk-upload', label: 'Register', route: 'attendance-bulk-upload', icon: 'payments', roles: ['OWNER', 'ADMIN', 'HR'] },
    { id: 'attendance-form-t', label: 'Form T', route: 'attendance-form-t', icon: 'payments', roles: ['OWNER', 'ADMIN', 'HR'] },
    { id: 'salary-statement', label: 'Salary Statement', route: 'salary-statement', icon: 'account_balance', roles: ['OWNER', 'ADMIN', 'HR'] },
    { id: 'payroll', label: 'Payroll', route: 'payroll', icon: 'payments', roles: ['OWNER', 'ADMIN', 'HR'] },
    { id: 'my-payslips', label: 'My Payslips', route: 'my-payslips', icon: 'receipt', roles: ['OWNER', 'ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'] },
    { id: 'ats', label: 'Recruitment', route: 'ats', icon: 'group', roles: ['OWNER', 'ADMIN', 'HR', 'MANAGER'] },
    { id: 'ats-jobs', label: 'Jobs', route: 'ats-jobs', icon: 'event', roles: ['OWNER', 'ADMIN', 'HR', 'MANAGER'] },
    { id: 'ats-candidates', label: 'Candidates', route: 'ats-candidates', icon: 'people', roles: ['OWNER', 'ADMIN', 'HR', 'MANAGER'] },
    { id: 'notifications', label: 'Notifications', route: 'notifications', icon: 'mail', roles: ['OWNER', 'ADMIN', 'HR'] },
    { id: 'settings', label: 'Settings', route: 'settings', icon: 'settings', roles: ['OWNER', 'ADMIN', 'HR'] },
    { id: 'users', label: 'Users', route: 'users', icon: 'admin_panel_settings', roles: ['OWNER', 'ADMIN'], placeholder: true }
  ];

  function hasRole_(session, allowedRoles) {
    var role = normalizeUserRole_(session && session.role);
    return allowedRoles.indexOf(role) >= 0;
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

    if (typeof AdminSettingsService !== 'undefined' && AdminSettingsService.isActionAllowedForRole) {
      if (!AdminSettingsService.isActionAllowedForRole(session.role, action)) return false;
    }

    if (action === HRMS.ACTIONS.EMPLOYEE_DIRECTORY &&
        normalizeUserRole_(session.role) === HRMS.ROLES.MANAGER) {
      return true;
    }

    if (typeof UserAccessService !== 'undefined' && !isHrOrAdmin(session)) {
      if (action === HRMS.ACTIONS.LEAVE_APPLY &&
          !UserAccessService.hasSelfServiceAccess(session, 'leave')) {
        return false;
      }
      if (action === HRMS.ACTIONS.VIEW_OWN_PAYSLIP &&
          !UserAccessService.hasSelfServiceAccess(session, 'payslips')) {
        return false;
      }
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
    role = normalizeUserRole_(role);
    return NAV_ITEMS_.filter(function (item) {
      if (item.roles.indexOf(role) < 0) return false;
      if (typeof AdminSettingsService !== 'undefined' && AdminSettingsService.isNavAllowedForRole) {
        return AdminSettingsService.isNavAllowedForRole(role, item.id);
      }
      return true;
    });
  }

  function getNavForSession(session) {
    var items = getNavForRole(session && session.role);
    if (!session || !session.authorized) return items;
    if (isHrOrAdmin(session)) return items;
    if (typeof UserAccessService === 'undefined') return items;
    return items.filter(function (item) {
      if (item.id === 'my-leave') return UserAccessService.hasSelfServiceAccess(session, 'leave');
      if (item.id === 'my-payslips') return UserAccessService.hasSelfServiceAccess(session, 'payslips');
      return true;
    });
  }

  function isAdmin(session) {
    if (!session) return false;
    var role = normalizeUserRole_(session.role);
    return role === HRMS.ROLES.ADMIN || role === HRMS.ROLES.OWNER;
  }

  function isHrOrAdmin(session) {
    if (!session) return false;
    var role = normalizeUserRole_(session.role);
    return role === HRMS.ROLES.HR ||
      role === HRMS.ROLES.ADMIN ||
      role === HRMS.ROLES.OWNER;
  }

  /**
   * Attendance register / Form T — ATTENDANCE_MANAGE, else PAYROLL_RUN, else attendance module for HR/Admin.
   * @param {Object=} session
   * @return {Object} Authorized session.
   */
  function requireAttendanceAccess(session) {
    session = session || AuthService.requireAuth();
    if (can(HRMS.ACTIONS.ATTENDANCE_MANAGE, {}, session)) {
      return require(HRMS.ACTIONS.ATTENDANCE_MANAGE, {}, session);
    }
    if (can(HRMS.ACTIONS.PAYROLL_RUN, {}, session)) {
      return require(HRMS.ACTIONS.PAYROLL_RUN, {}, session);
    }
    if (isHrOrAdmin(session) &&
        typeof AdminSettingsService !== 'undefined' &&
        AdminSettingsService.isModuleEnabledForRole(session.role, 'attendance')) {
      return session;
    }
    throw authorizationError_();
  }

  return {
    can: can,
    require: require,
    requireAttendanceAccess: requireAttendanceAccess,
    getNavForRole: getNavForRole,
    getNavForSession: getNavForSession,
    isAdmin: isAdmin,
    isHrOrAdmin: isHrOrAdmin,
    normalizeUserRole: normalizeUserRole_
  };
})();
