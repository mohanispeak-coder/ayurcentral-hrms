/**
 * Client-callable Employee APIs. AuthZ is re-checked in EmployeeService.
 */

function apiGetEmployeeDirectory(query, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return EmployeeService.listDirectory(session, query || {});
  }, sessionToken);
}

function apiGetMyTeam(query, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return EmployeeService.listMyTeam(session, query || {});
  }, sessionToken);
}

function apiGetEmployeePicker(sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return EmployeeService.listPicker(session);
  }, sessionToken);
}

function apiGetEmployeeVerticals(sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return EmployeeService.listVerticals(session);
  }, sessionToken);
}

function apiGetVerticalCatalog(sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return EmployeeService.listVerticalCatalog(session);
  }, sessionToken);
}

function apiGetEmployee(employeeId, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return EmployeeService.getEmployee(session, employeeId);
  }, sessionToken);
}

function apiGetMyProfile(sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return EmployeeService.getMyProfile(session);
  }, sessionToken);
}

function apiCreateEmployee(payload, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return EmployeeService.createEmployee(session, payload || {});
  }, sessionToken);
}

function apiUpdateEmployee(employeeId, payload, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return EmployeeService.updateEmployee(session, employeeId, payload || {});
  }, sessionToken);
}

function apiSetEmployeeStatus(employeeId, status, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return EmployeeService.setStatus(session, employeeId, status);
  }, sessionToken);
}

function apiGetEmployeeDocuments(employeeId, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return EmployeeService.listDocuments(session, employeeId);
  }, sessionToken);
}

function apiGetEmployeePayslips(employeeId, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return EmployeeService.listPayslips(session, employeeId);
  }, sessionToken);
}

function apiUploadEmployeeDocument(employeeId, meta, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return EmployeeService.uploadDocument(session, employeeId, meta || {});
  }, sessionToken);
}

function apiUploadEmployeeDocuments(employeeId, files, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return EmployeeService.uploadDocuments(session, employeeId, files || []);
  }, sessionToken);
}

function apiDownloadEmployeeDocument(documentId, intent, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    var mode = 'download';
    if (intent === 'view' || intent === 'download') mode = intent;
    return EmployeeService.downloadDocument(session, documentId, mode);
  }, sessionToken);
}

function apiGetEmployeeLeaveSummary(employeeId, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return EmployeeService.getLeaveSummary(session, employeeId);
  }, sessionToken);
}

function apiListEmployeeFieldDefs(includeInactive, sessionToken) {
  return hrmsRun_(function () {
    AuthService.requireAuth();
    return EmployeeFieldDefService.listFieldDefs(!includeInactive);
  }, sessionToken);
}

function apiSaveEmployeeFieldDefs(payload, sessionToken) {
  return hrmsRun_(function () {
    AuthService.requireAuth();
    return EmployeeFieldDefService.saveFieldDefs(payload || {});
  }, sessionToken);
}

function apiGetEmployeeMandatoryFields(sessionToken) {
  return hrmsRun_(function () {
    AuthService.requireAuth();
    return EmployeeMandatoryFieldService.listConfig();
  }, sessionToken);
}

function apiSaveEmployeeMandatoryFields(payload, sessionToken) {
  return hrmsRun_(function () {
    AuthService.requireAuth();
    return EmployeeMandatoryFieldService.saveConfig(payload || {});
  }, sessionToken);
}
