/**
 * ATS bulk upload APIs — jobs and candidates.
 */

function apiAtsDownloadJobsBulkTemplate(sessionToken) {
  return hrmsRun_(function () {
    return AtsBulkService.downloadJobsTemplate();
  }, sessionToken);
}

function apiAtsDownloadCandidatesBulkTemplate(sessionToken) {
  return hrmsRun_(function () {
    return AtsBulkService.downloadCandidatesTemplate();
  }, sessionToken);
}

function apiAtsValidateJobsBulkUpload(meta, sessionToken) {
  return hrmsRun_(function () {
    return AtsBulkService.validateJobsUpload(meta || {});
  }, sessionToken);
}

function apiAtsValidateCandidatesBulkUpload(meta, sessionToken) {
  return hrmsRun_(function () {
    return AtsBulkService.validateCandidatesUpload(meta || {});
  }, sessionToken);
}

function apiAtsCommitJobsBulkUpload(uploadId, sessionToken) {
  return hrmsRun_(function () {
    return AtsBulkService.commitJobsUpload(uploadId);
  }, sessionToken);
}

function apiAtsCommitCandidatesBulkUpload(uploadId, sessionToken) {
  return hrmsRun_(function () {
    return AtsBulkService.commitCandidatesUpload(uploadId);
  }, sessionToken);
}
