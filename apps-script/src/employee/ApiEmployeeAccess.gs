/**
 * Admin APIs for per-employee app access checkboxes.
 */

function apiGetEmployeeAppAccess(employeeId, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return UserAccessService.getEmployeeAccess(session, employeeId);
  }, sessionToken);
}

function apiSaveEmployeeAppAccess(employeeId, payload, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return UserAccessService.saveEmployeeAccess(session, employeeId, payload || {});
  }, sessionToken);
}

function apiEnsureUserAccessSchema(sessionToken) {
  return hrmsRun_(function () {
    PermissionService.require(HRMS.ACTIONS.ADMIN_USERS);
    return UserAccessService.ensureColumns();
  }, sessionToken);
}

function apiSendEmployeeWelcome(employeeId, options, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    if (typeof EmployeeWelcomeService === 'undefined') {
      throw configurationError_('Welcome messaging is not available.');
    }
    return EmployeeWelcomeService.sendWelcome(session, employeeId, options || {});
  }, sessionToken);
}
