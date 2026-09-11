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
