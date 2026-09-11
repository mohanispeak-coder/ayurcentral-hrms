/**
 * Client-callable PMS APIs. AuthZ is enforced in PmsService / PmsPermissionService.
 * Also installs the module UI allowlist without editing ApiFoundation.gs.
 */

function pmsInstallAdapters_() {
  if (typeof HRMS_MODULE_UI_FILES_ !== 'undefined') {
    HRMS_MODULE_UI_FILES_.pms = ['pms/PmsClient'];
  }
  if (typeof PmsPermissionService !== 'undefined' && PmsPermissionService.installNav) {
    PmsPermissionService.installNav();
  }
}

pmsInstallAdapters_();

/** Standalone module UI load — used if shell is not yet wired to apiGetModuleUi. */
function apiGetPmsModuleUi(sessionToken) {
  return hrmsRun_(function () {
    pmsInstallAdapters_();
    PermissionService.require(HRMS.ACTIONS.ACCESS_APP);
    var t0 = Date.now();
    var html = HtmlService.createHtmlOutputFromFile('pms/PmsClient').getContent();
    if (typeof HrmsPerf !== 'undefined' && HrmsPerf.log) {
      HrmsPerf.log('apiGetPmsModuleUi', Date.now() - t0);
    }
    return { moduleId: 'pms', html: html };
  }, sessionToken);
}

function apiPmsGetContext(sessionToken) {
  return hrmsRun_(function () {
    pmsInstallAdapters_();
    return PmsService.getContext();
  }, sessionToken);
}

function apiPmsGetDashboard(sessionToken) {
  return hrmsRun_(function () {
    pmsInstallAdapters_();
    var session = AuthService.requireAuth();
    return PmsService.getDashboard(session);
  }, sessionToken);
}

function apiPmsListCycles(sessionToken) {
  return hrmsRun_(function () {
    pmsInstallAdapters_();
    return PmsService.listCycles();
  }, sessionToken);
}

function apiPmsGetCycle(cycleId, sessionToken) {
  return hrmsRun_(function () {
    pmsInstallAdapters_();
    return PmsService.getCycle(cycleId);
  }, sessionToken);
}

function apiPmsGetCycleBundle(cycleId, sessionToken) {
  return hrmsRun_(function () {
    pmsInstallAdapters_();
    return PmsService.getCycleBundle(cycleId);
  }, sessionToken);
}

function apiPmsCreateCycle(payload, sessionToken) {
  return hrmsRun_(function () {
    pmsInstallAdapters_();
    return PmsService.createCycle(payload || {});
  }, sessionToken);
}

function apiPmsUpdateCycle(cycleId, payload, sessionToken) {
  return hrmsRun_(function () {
    pmsInstallAdapters_();
    return PmsService.updateCycle(cycleId, payload || {});
  }, sessionToken);
}

function apiPmsTransitionCycle(cycleId, toStatus, sessionToken) {
  return hrmsRun_(function () {
    pmsInstallAdapters_();
    return PmsService.transitionCycle(cycleId, toStatus);
  }, sessionToken);
}

function apiPmsListAssignableEmployees(cycleId, sessionToken) {
  return hrmsRun_(function () {
    pmsInstallAdapters_();
    return PmsService.listAssignableEmployees(cycleId);
  }, sessionToken);
}

function apiPmsCreateGoal(payload, sessionToken) {
  return hrmsRun_(function () {
    pmsInstallAdapters_();
    return PmsService.createGoal(payload || {});
  }, sessionToken);
}

function apiPmsUpdateGoal(goalId, payload, sessionToken) {
  return hrmsRun_(function () {
    pmsInstallAdapters_();
    return PmsService.updateGoal(goalId, payload || {});
  }, sessionToken);
}

function apiPmsDeleteGoal(goalId, sessionToken) {
  return hrmsRun_(function () {
    pmsInstallAdapters_();
    return PmsService.deleteGoal(goalId);
  }, sessionToken);
}

function apiPmsGetReview(cycleId, employeeId, sessionToken) {
  return hrmsRun_(function () {
    pmsInstallAdapters_();
    return PmsService.getReviewBundle(cycleId, employeeId);
  }, sessionToken);
}

function apiPmsSaveSelfAssessment(payload, sessionToken) {
  return hrmsRun_(function () {
    pmsInstallAdapters_();
    return PmsService.saveSelfAssessment(payload || {});
  }, sessionToken);
}

function apiPmsSubmitSelfAssessment(cycleId, sessionToken) {
  return hrmsRun_(function () {
    pmsInstallAdapters_();
    return PmsService.submitSelfAssessment(cycleId);
  }, sessionToken);
}

function apiPmsReopenSelfAssessment(cycleId, employeeId, sessionToken) {
  return hrmsRun_(function () {
    pmsInstallAdapters_();
    return PmsService.reopenSelfAssessment(cycleId, employeeId);
  }, sessionToken);
}

function apiPmsSaveManagerReview(payload, sessionToken) {
  return hrmsRun_(function () {
    pmsInstallAdapters_();
    return PmsService.saveManagerReview(payload || {});
  }, sessionToken);
}

function apiPmsSubmitManagerReview(cycleId, employeeId, sessionToken) {
  return hrmsRun_(function () {
    pmsInstallAdapters_();
    return PmsService.submitManagerReview(cycleId, employeeId);
  }, sessionToken);
}

function apiPmsFinalizeReview(cycleId, employeeId, payload, sessionToken) {
  return hrmsRun_(function () {
    pmsInstallAdapters_();
    return PmsService.finalizeReview(cycleId, employeeId, payload || {});
  }, sessionToken);
}

function apiPmsListTeamReviews(cycleId, sessionToken) {
  return hrmsRun_(function () {
    pmsInstallAdapters_();
    return PmsService.listTeamReviews(cycleId);
  }, sessionToken);
}

function apiPmsListAppraisals(cycleId, sessionToken) {
  return hrmsRun_(function () {
    pmsInstallAdapters_();
    return PmsService.listAppraisals(cycleId);
  }, sessionToken);
}

function apiPmsListRatingScale(sessionToken) {
  return hrmsRun_(function () {
    pmsInstallAdapters_();
    return PmsService.listRatingScale();
  }, sessionToken);
}

function apiPmsSaveRatingScale(items, sessionToken) {
  return hrmsRun_(function () {
    pmsInstallAdapters_();
    return PmsService.saveRatingScale(items || []);
  }, sessionToken);
}

function apiPmsEnsureSchema(sessionToken) {
  return hrmsRun_(function () {
    pmsInstallAdapters_();
    var session = PmsPermissionService.requireAction(HRMS.PMS.ACTIONS.MANAGE_CYCLES);
    var result = PmsSchemaService.ensure();
    if (typeof AuditService !== 'undefined' && AuditService.log) {
      AuditService.log(HRMS.PMS.AUDIT.SCHEMA_ENSURE, 'PerformanceSchema', 'pms',
        'Ensured PMS sheets', session.employee_id);
    }
    return result;
  }, sessionToken);
}

/** Editor / spreadsheet menu helper — wire from Main.onOpen in a later pass if desired. */
function menuEnsurePmsSchema() {
  var session = AuthService.requireAuth();
  if (!PmsEngine.isHrOrAdmin(session)) {
    SpreadsheetApp.getUi().alert('HR or Admin permission required.');
    return;
  }
  var result = PmsSchemaService.ensure();
  SpreadsheetApp.getUi().alert('PMS sheets ready. Ratings seeded: ' + (result.ratingsInserted || 0));
}
