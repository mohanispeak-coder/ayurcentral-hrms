/**
 * Unauthenticated ATS career / apply APIs.
 * These are the only intended public endpoints. They never return Users, payroll,
 * leave, internal notes, secrets, or Knowledge Hub keys.
 *
 * Internal ATS APIs must not be called from the public page.
 */

function apiAtsPublicListJobs() {
  return hrmsRun_(function () {
    return AtsService.listPublicJobs();
  }, '');
}

function apiAtsPublicGetJob(slug) {
  return hrmsRun_(function () {
    return AtsService.getPublicJob(slug);
  }, '');
}

function apiAtsPublicApply(payload) {
  return hrmsRun_(function () {
    return AtsService.submitPublicApplication(payload || {});
  }, '');
}
