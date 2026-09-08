/**
 * ATS authorization. Does not modify PermissionService.
 * EMPLOYEE has no ATS access. MANAGER is scoped to assigned jobs / interviews.
 */
var ATS = ATS || {};

var AtsPermissionService = (function () {
  function sessionOrThrow_(session) {
    if (!session || !session.authorized) {
      throw authorizationError_('You do not have permission to perform this action.');
    }
    return session;
  }

  function requireAccess(session) {
    sessionOrThrow_(session);
    if (!AtsEngine.canAccessAts(session)) {
      throw authorizationError_('Recruitment is not available for your role.');
    }
    return session;
  }

  function requireManage(session) {
    requireAccess(session);
    if (!AtsEngine.canManageAts(session)) {
      throw authorizationError_('Only HR or Admin can manage job requisitions.');
    }
    return session;
  }

  function requireJob(session, job, interviews) {
    requireAccess(session);
    if (!AtsEngine.canAccessJob(session, job, interviews)) {
      throw authorizationError_('You do not have access to this requisition.');
    }
    return session;
  }

  function requireCandidate(session, jobs, interviews) {
    requireAccess(session);
    if (!AtsEngine.canAccessCandidate(session, jobs, interviews)) {
      throw authorizationError_('You do not have access to this candidate.');
    }
    return session;
  }

  function requireResume(session, job, interviews) {
    requireAccess(session);
    if (!AtsEngine.canDownloadResume(session, job, interviews)) {
      throw authorizationError_('You cannot access this resume.');
    }
    return session;
  }

  function requireSetup(session) {
    requireManage(session);
    return session;
  }

  function navItemsForRole(role) {
    var r = String(role || '').toUpperCase();
    return ATS.NAV_ITEMS.filter(function (item) {
      return item.roles.indexOf(r) >= 0;
    });
  }

  /**
   * Optional integrator hook — call from apiGetAppBootstrap after getNavForRole.
   * Safe no-op if PermissionService is missing.
   */
  function mergeNav(existing, role) {
    var items = (existing || []).slice();
    navItemsForRole(role).forEach(function (extra) {
      var exists = items.some(function (i) { return i.route === extra.route; });
      if (!exists) items.push(extra);
    });
    return items;
  }

  function installNav() {
    if (typeof PermissionService === 'undefined' || !PermissionService.getNavForRole) return false;
    if (PermissionService._atsNavInstalled) return true;
    var original = PermissionService.getNavForRole;
    PermissionService.getNavForRole = function (role) {
      return mergeNav(original.call(PermissionService, role) || [], role);
    };
    PermissionService._atsNavInstalled = true;
    return true;
  }

  function can(action, session, context) {
    context = context || {};
    if (!session || !session.authorized) return false;
    if (action === ATS.ACTIONS.ACCESS) return AtsEngine.canAccessAts(session);
    if (action === ATS.ACTIONS.MANAGE || action === ATS.ACTIONS.SETUP) return AtsEngine.canManageAts(session);
    if (action === ATS.ACTIONS.INTERVIEW) {
      return AtsEngine.canWriteInterview(session, context.job, context.interview);
    }
    if (action === ATS.ACTIONS.RESUME) {
      return AtsEngine.canDownloadResume(session, context.job, context.interviews);
    }
    return false;
  }

  return {
    requireAccess: requireAccess,
    requireManage: requireManage,
    requireJob: requireJob,
    requireCandidate: requireCandidate,
    requireResume: requireResume,
    requireSetup: requireSetup,
    navItemsForRole: navItemsForRole,
    mergeNav: mergeNav,
    installNav: installNav,
    can: can
  };
})();

AtsPermissionService.installNav();
