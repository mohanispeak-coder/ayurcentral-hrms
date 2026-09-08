/**
 * PMS AuthZ adapter. Uses ACCESS_APP + session role; does not edit PermissionService.gs.
 * Optionally appends PMS nav items to getNavForRole so bootstrap can surface them.
 */
var HRMS = HRMS || {};

var PmsPermissionService = (function () {
  function sessionOrRequire_(session) {
    if (session && session.authorized) return session;
    if (typeof AuthService !== 'undefined' && AuthService.requireAuth) {
      return AuthService.requireAuth();
    }
    if (typeof AuthService !== 'undefined' && AuthService.resolveSession) {
      session = AuthService.resolveSession();
      if (session && session.authorized) return session;
    }
    PmsEngine.denied('You must be signed in.');
  }

  function requireApp_(session) {
    session = sessionOrRequire_(session);
    if (typeof PermissionService !== 'undefined' && PermissionService.require) {
      PermissionService.require(HRMS.ACTIONS.ACCESS_APP, {}, session);
    }
    return session;
  }

  function navItemsForRole(role) {
    role = String(role || '').toUpperCase();
    return (HRMS.PMS.NAV || []).filter(function (item) {
      return item.roles.indexOf(role) >= 0;
    }).map(function (item) {
      return {
        id: item.id,
        label: item.label,
        route: item.route,
        icon: item.icon,
        roles: item.roles.slice(),
        module: 'pms'
      };
    });
  }

  function mergeNav(items, role) {
    var existing = items || [];
    var extra = navItemsForRole(role);
    var seen = {};
    existing.forEach(function (n) { seen[n.id || n.route] = true; });
    extra.forEach(function (n) {
      if (!seen[n.id || n.route]) existing.push(n);
    });
    return existing;
  }

  function installNav() {
    if (typeof PermissionService === 'undefined' || !PermissionService.getNavForRole) return false;
    if (PermissionService._pmsNavInstalled) return true;
    var original = PermissionService.getNavForRole;
    PermissionService.getNavForRole = function (role) {
      return mergeNav(original.call(PermissionService, role) || [], role);
    };
    PermissionService._pmsNavInstalled = true;
    return true;
  }

  function requireAction(action, ctx, session) {
    session = requireApp_(session);
    PmsEngine.requireCan(action, session, ctx || {});
    return session;
  }

  function requireViewEmployee(employee, review, session) {
    session = requireApp_(session);
    if (!PmsEngine.canViewEmployeePms(session, employee || {}, review || {})) {
      PmsEngine.denied('You do not have access to this performance record.');
    }
    return session;
  }

  function capabilities(session) {
    session = session || {};
    return {
      canManageCycles: PmsEngine.can(HRMS.PMS.ACTIONS.MANAGE_CYCLES, session, {}),
      canManageRatings: PmsEngine.can(HRMS.PMS.ACTIONS.MANAGE_RATINGS, session, {}),
      canFinalize: PmsEngine.can(HRMS.PMS.ACTIONS.FINALIZE, session, {}),
      canReopen: PmsEngine.can(HRMS.PMS.ACTIONS.REOPEN, session, {}),
      canViewTeam: PmsEngine.can(HRMS.PMS.ACTIONS.VIEW_TEAM, session, {}),
      canSelfAssess: !!session.employee_id,
      isHrOrAdmin: PmsEngine.isHrOrAdmin(session),
      isManager: PmsEngine.isManager(session),
      role: session.role || '',
      employee_id: session.employee_id || ''
    };
  }

  return {
    requireApp: requireApp_,
    requireAction: requireAction,
    requireViewEmployee: requireViewEmployee,
    navItemsForRole: navItemsForRole,
    mergeNav: mergeNav,
    installNav: installNav,
    capabilities: capabilities
  };
})();

PmsPermissionService.installNav();
