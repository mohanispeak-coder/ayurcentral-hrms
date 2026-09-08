/**
 * ATS web-app routing adapter.
 * Main.gs doGet should call AtsWeb.tryServe(e) and return the result when non-null.
 * See docs/ATS_INTEGRATION_NOTES.md — this file is the module-specific adapter.
 */
var ATS = ATS || {};

var AtsWeb = (function () {
  function param_(e, name) {
    if (!e || !e.parameter) return '';
    return String(e.parameter[name] || '').trim();
  }

  function mode_(e) {
    return param_(e, 'ats').toLowerCase();
  }

  function isPublicApplyRequest(e) {
    var mode = mode_(e);
    if (mode === 'apply' || mode === 'careers' || mode === 'jobs') return true;
    if (param_(e, 'job') || param_(e, 'slug')) return true;
    return false;
  }

  function isInternalAppRequest(e) {
    var mode = mode_(e);
    return mode === 'app' || mode === 'hr' || mode === 'recruit';
  }

  function servePublicApply(e) {
    var template = HtmlService.createTemplateFromFile('ats/AtsPublicApply');
    template.include = include;
    template.jobSlug = param_(e, 'job') || param_(e, 'slug');
    template.companyName = 'AyurCentral';
    try {
      template.companyName = ConfigService.getCompanyName();
    } catch (ignore) {}
    return template
      .evaluate()
      .setTitle((template.companyName || 'AyurCentral') + ' Careers')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  function serveInternalApp() {
    var template = HtmlService.createTemplateFromFile('ats/AtsApp');
    template.companyName = 'AyurCentral';
    try {
      template.companyName = ConfigService.getCompanyName();
    } catch (ignore) {}
    return template
      .evaluate()
      .setTitle((template.companyName || 'AyurCentral') + ' Recruitment')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  /**
   * @param {Object} e doGet event
   * @return {GoogleAppsScript.HTML.HtmlOutput|null}
   */
  function tryServe(e) {
    if (isInternalAppRequest(e)) return serveInternalApp();
    if (isPublicApplyRequest(e)) return servePublicApply(e);
    return null;
  }

  return {
    isPublicApplyRequest: isPublicApplyRequest,
    isInternalAppRequest: isInternalAppRequest,
    servePublicApply: servePublicApply,
    serveInternalApp: serveInternalApp,
    tryServe: tryServe
  };
})();
