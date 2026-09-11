/**
 * Bulk employee upload APIs.
 */

function apiDownloadBulkEmployeeTemplate(sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return EmployeeBulkService.downloadTemplate(session);
  }, sessionToken);
}

function apiDownloadBulkEmployeeCsvTemplate(sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return EmployeeBulkService.downloadCsvTemplate(session);
  }, sessionToken);
}

function apiValidateBulkEmployeeUpload(meta, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return EmployeeBulkService.validateUpload(session, meta || {});
  }, sessionToken);
}

function apiConfirmBulkEmployeeUpload(uploadId, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return EmployeeBulkService.commitUpload(session, uploadId);
  }, sessionToken);
}
