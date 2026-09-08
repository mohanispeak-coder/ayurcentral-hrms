/**
 * Client-callable Leave APIs. AuthZ on every entry.
 */

function apiLeaveGetMyLeave(employeeId, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return LeaveService.getMyLeave(session, employeeId || '');
  }, sessionToken);
}

function apiLeaveGetTypes(includeInactive, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return LeaveService.getTypes(session, !!includeInactive);
  }, sessionToken);
}

function apiLeavePreviewDays(payload, sessionToken) {
  return hrmsRun_(function () {
    return LeaveService.previewDays(payload || {});
  }, sessionToken);
}

function apiLeaveSaveDraft(payload, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return LeaveService.saveDraft(session, payload || {});
  }, sessionToken);
}

function apiLeaveSubmit(payload, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return LeaveService.submit(session, payload || {});
  }, sessionToken);
}

function apiLeaveCancel(leaveRequestId, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return LeaveService.cancel(session, leaveRequestId);
  }, sessionToken);
}

function apiLeaveGetApprovals(sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return LeaveService.getApprovals(session);
  }, sessionToken);
}

function apiLeaveApprove(leaveRequestId, comment, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return LeaveService.approve(session, leaveRequestId, comment || '');
  }, sessionToken);
}

function apiLeaveReject(leaveRequestId, comment, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return LeaveService.reject(session, leaveRequestId, comment || '');
  }, sessionToken);
}

function apiLeaveGetAdminList(filters, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return LeaveService.getAdminList(session, filters || {});
  }, sessionToken);
}

function apiLeaveSaveType(payload, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return LeaveService.saveType(session, payload || {});
  }, sessionToken);
}

function apiLeaveStartLeaveYear(leaveYear, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return LeaveService.startLeaveYear(session, leaveYear);
  }, sessionToken);
}

function apiLeaveGrantBalances(employeeId, leaveYear, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    if (!PermissionService.isHrOrAdmin(session) && String(employeeId) !== String(session.employee_id)) {
      throw authorizationError_('You cannot grant leave balances for this employee.');
    }
    if (!PermissionService.isHrOrAdmin(session)) {
      throw authorizationError_('Only HR or Admin can grant leave balances.');
    }
    return LeaveService.grantBalancesForEmployee(employeeId, leaveYear);
  }, sessionToken);
}

function apiLeaveGetCalendar(year, month, employeeId, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return LeaveService.getCalendar(session, year, month, employeeId || '');
  }, sessionToken);
}

function apiLeaveListEmployees(sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return LeaveService.listEmployeeOptions(session);
  }, sessionToken);
}

/**
 * Payroll-facing reader (also callable from the client for diagnostics).
 * Returns { employee_id, period_year, period_month, lop_from_leave }.
 */
function apiLeaveComputeLopFromLeave(employeeId, periodYear, periodMonth, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    if (!PermissionService.isHrOrAdmin(session) && String(employeeId) !== String(session.employee_id)) {
      throw authorizationError_();
    }
    var days = LeaveLopService.computeLopFromLeave(employeeId, periodYear, periodMonth);
    return {
      employee_id: employeeId,
      period_year: LeaveEngine.toNumber(periodYear),
      period_month: LeaveEngine.toNumber(periodMonth),
      lop_from_leave: days
    };
  }, sessionToken);
}
