/**
 * Authenticated ATS APIs. AuthZ is re-checked in AtsService / AtsPermissionService.
 */

function apiAtsGetBootstrap(sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return AtsService.getBootstrap(session);
  }, sessionToken);
}

function apiAtsEnsureSchema(sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return AtsService.ensureSchema(session);
  }, sessionToken);
}

function apiAtsGetDashboard(sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return AtsService.getDashboard(session);
  }, sessionToken);
}

function apiAtsGetModuleUi(sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    AtsPermissionService.requireAccess(session);
    var html = HtmlService.createHtmlOutputFromFile('ats/AtsClient').getContent();
    return { moduleId: 'ats', html: html };
  }, sessionToken);
}

function apiAtsListJobs(query, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return AtsService.listJobs(session, query || {});
  }, sessionToken);
}

function apiAtsGetJob(jobId, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return AtsService.getJob(session, jobId);
  }, sessionToken);
}

function apiAtsCreateJob(payload, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return AtsService.createJob(session, payload || {});
  }, sessionToken);
}

function apiAtsUpdateJob(jobId, payload, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return AtsService.updateJob(session, jobId, payload || {});
  }, sessionToken);
}

function apiAtsTransitionJob(jobId, status, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return AtsService.transitionJob(session, jobId, status);
  }, sessionToken);
}

function apiAtsGetSharePack(jobId, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return AtsService.getSharePack(session, jobId);
  }, sessionToken);
}

function apiAtsListHiringManagers(sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return AtsService.listHiringManagers(session);
  }, sessionToken);
}

function apiAtsListCandidates(query, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return AtsService.listCandidates(session, query || {});
  }, sessionToken);
}

function apiAtsGetCandidate(candidateId, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return AtsService.getCandidate(session, candidateId);
  }, sessionToken);
}

function apiAtsAddCandidateComment(candidateId, payload, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return AtsService.addComment(session, candidateId, payload || {});
  }, sessionToken);
}

function apiAtsMoveApplicationStage(applicationId, stage, comment, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return AtsService.moveStage(session, applicationId, stage, comment || '');
  }, sessionToken);
}

function apiAtsScheduleInterview(payload, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return AtsService.scheduleInterview(session, payload || {});
  }, sessionToken);
}

function apiAtsUpdateInterview(interviewId, payload, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return AtsService.updateInterview(session, interviewId, payload || {});
  }, sessionToken);
}

function apiAtsDownloadResume(candidateId, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return AtsService.downloadResume(session, candidateId);
  }, sessionToken);
}

function menuEnsureAtsSchema() {
  var session = AuthService.requireAuth();
  if (!AtsEngine.canManageAts(session)) {
    SpreadsheetApp.getUi().alert('HR or Admin permission required.');
    return;
  }
  var result = AtsSchemaService.ensureSheets();
  SpreadsheetApp.getUi().alert('ATS sheets ready. Spreadsheet: ' + (result.spreadsheetId || ''));
}
