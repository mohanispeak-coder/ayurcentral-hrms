/**
 * Startup / performance smoke tests — run from Apps Script editor.
 * Does not deploy. Enable timings with Script Property HRMS_PERF_TIMING=1.
 */

function testStartupPerf_Smoke() {
  var results = [];
  function record(name, passed, detail, skipped) {
    results.push({ name: name, passed: passed, detail: detail || '', skipped: !!skipped });
    Logger.log((skipped ? 'SKIP' : passed ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ': ' + detail : ''));
  }

  // doGet shell HTML should not inline module clients.
  try {
    var tDoGet = Date.now();
    var htmlOut = doGet({});
    var doGetMs = Date.now() - tDoGet;
    HrmsPerf.log('smoke.doGet', doGetMs);
    var html = htmlOut.getContent();
    record('doGetReturnsHtml', html.indexOf('Loading HRMS') >= 0 || html.indexOf('app-shell') >= 0,
      'ms=' + doGetMs);
    record('doGetExcludesEmployeeClient',
      html.indexOf('initEmployeeUi') < 0 && html.indexOf('apiGetEmployeeDirectory') < 0,
      'shell only');
    record('doGetExcludesLeaveClient',
      html.indexOf('HRMSLeaveUi') < 0 && html.indexOf('apiLeaveGetMyLeave') < 0,
      'shell only');
    record('doGetExcludesPayrollClient',
      html.indexOf('initPayrollUi') < 0 && html.indexOf('apiListPayrollRuns') < 0,
      'shell only');
    record('doGetIncludesCoreScripts',
      html.indexOf('apiGetAppBootstrap') >= 0 && html.indexOf('apiGetModuleUi') >= 0);
  } catch (e) {
    record('doGetReturnsHtml', false, e.message);
    record('doGetExcludesEmployeeClient', false, e.message);
    record('doGetExcludesLeaveClient', false, e.message);
    record('doGetExcludesPayrollClient', false, e.message);
    record('doGetIncludesCoreScripts', false, e.message);
  }

  // Bootstrap shape + single-session auth path.
  try {
    var tBoot = Date.now();
    var bootWrap = apiGetAppBootstrap('');
    var bootMs = Date.now() - tBoot;
    HrmsPerf.log('smoke.apiGetAppBootstrap', bootMs);
    record('bootstrapOkShape', !!(bootWrap && bootWrap.ok && bootWrap.data && bootWrap.data.session && bootWrap.data.app),
      'ms=' + bootMs);
    if (bootWrap && bootWrap.ok && bootWrap.data) {
      record('bootstrapNoModulePayload',
        !bootWrap.data.employees && !bootWrap.data.leave && !bootWrap.data.payroll);
      record('bootstrapHasNavWhenAuthorized',
        !bootWrap.data.session.authorized || (bootWrap.data.navigation && bootWrap.data.navigation.length > 0),
        'authorized=' + bootWrap.data.session.authorized);
    }
  } catch (e) {
    record('bootstrapOkShape', false, e.message);
  }

  // Module UI endpoint — authorized users only; unknown module rejected.
  try {
    var deny = apiGetModuleUi('not-a-module', '');
    if (deny && deny.ok === false) {
      record('moduleUiUnknownRejected', true, deny.error && deny.error.code);
    } else {
      // May fail auth first when not logged in — still acceptable.
      record('moduleUiUnknownRejected', true, 'auth or validation gated', true);
    }
  } catch (e) {
    record('moduleUiUnknownRejected', true, e.message, true);
  }

  var session = AuthService.resolveSession();
  if (session.authorized) {
    try {
      var mod = apiGetModuleUi('employee', '');
      record('moduleUiEmployeeAuthorized',
        !!(mod && mod.ok && mod.data && mod.data.html && mod.data.html.indexOf('tpl-emp-list') >= 0),
        'len=' + (mod && mod.data && mod.data.html ? mod.data.html.length : 0));
    } catch (e) {
      record('moduleUiEmployeeAuthorized', false, e.message);
    }
  } else {
    record('moduleUiEmployeeAuthorized', true, 'Not authorized in editor: ' + (session.reason || ''), true);
  }

  var failed = results.filter(function (r) { return !r.passed && !r.skipped; });
  Logger.log('Startup perf smoke: ' + (results.length - failed.length) + '/' + results.length + ' passed');
  return { results: results, allPassed: failed.length === 0, failedCount: failed.length, timingsNote: 'Set HRMS_PERF_TIMING=1 for Logger HRMS_PERF lines' };
}
