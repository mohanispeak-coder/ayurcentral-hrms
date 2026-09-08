/**
 * Auth + DEMO mode tests — pure decision logic (no Session dependency).
 */

function testAuthDemo_All() {
  var results = [];
  function record(name, passed, detail) {
    results.push({ name: name, passed: passed, detail: detail || '' });
    Logger.log((passed ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ': ' + detail : ''));
  }

  function resolve(input) {
    return hrmsResolveAuthAccess_(input);
  }

  var demoDev = 'dev.primary@example.com';
  var demoHr = 'dev.hr@example.com';
  var stranger = 'unknown@example.com';

  var demoInput = {
    email: demoDev,
    appMode: HRMS.APP_MODE.DEMO,
    demoEmails: [demoDev, demoHr],
    demoRole: HRMS.ROLES.ADMIN,
    user: null,
    dbError: false
  };

  var demoHrInput = {
    email: demoHr,
    appMode: HRMS.APP_MODE.DEMO,
    demoEmails: [demoDev, demoHr],
    demoRole: HRMS.ROLES.HR,
    user: null,
    dbError: false
  };

  var productionUser = {
    google_email: 'client.user@example.com',
    employee_id: 'EMP001',
    role: HRMS.ROLES.EMPLOYEE,
    status: HRMS.USER_STATUS.ACTIVE
  };

  // DEMO configured user → allowed
  var demoAllowed = resolve(demoInput);
  record('demoConfiguredAllowed', demoAllowed.authorized === true && demoAllowed.demo === true,
    'role=' + demoAllowed.role);
  record('demoNoEmployeeRecord', demoAllowed.employee_id === '', 'employee_id empty');
  record('demoDefaultAdminRole', demoAllowed.role === HRMS.ROLES.ADMIN, demoAllowed.role);

  // DEMO user with role override
  var demoHrAllowed = resolve(demoHrInput);
  record('demoRoleOverride', demoHrAllowed.authorized === true && demoHrAllowed.role === HRMS.ROLES.HR,
    demoHrAllowed.role);

  // DEMO unconfigured user → denied
  var demoDenied = resolve({
    email: stranger,
    appMode: HRMS.APP_MODE.DEMO,
    demoEmails: [demoDev],
    demoRole: HRMS.ROLES.ADMIN,
    user: null,
    dbError: false
  });
  record('demoUnconfiguredDenied', demoDenied.authorized === false && demoDenied.reason === 'UNKNOWN_USER',
    demoDenied.reason);

  // DEMO user does not need Users/Employees record
  record('demoNoUsersRow', demoAllowed.authorized === true && !demoInput.user, 'no user row');

  // PRODUCTION configured user → allowed
  var productionAllowed = resolve({
    email: productionUser.google_email,
    appMode: HRMS.APP_MODE.PRODUCTION,
    demoEmails: [productionUser.google_email],
    demoRole: HRMS.ROLES.ADMIN,
    user: productionUser,
    dbError: false
  });
  record('productionConfiguredAllowed', productionAllowed.authorized === true && productionAllowed.demo === false,
    'role=' + productionAllowed.role);

  // PRODUCTION unknown user → denied
  var productionUnknown = resolve({
    email: stranger,
    appMode: HRMS.APP_MODE.PRODUCTION,
    demoEmails: [stranger],
    demoRole: HRMS.ROLES.ADMIN,
    user: null,
    dbError: false
  });
  record('productionUnknownDenied', productionUnknown.authorized === false &&
    productionUnknown.reason === 'UNKNOWN_USER', productionUnknown.reason);

  // PRODUCTION disabled user → denied
  var productionDisabled = resolve({
    email: 'disabled@example.com',
    appMode: HRMS.APP_MODE.PRODUCTION,
    demoEmails: ['disabled@example.com'],
    demoRole: HRMS.ROLES.ADMIN,
    user: {
      google_email: 'disabled@example.com',
      employee_id: 'EMP099',
      role: HRMS.ROLES.EMPLOYEE,
      status: HRMS.USER_STATUS.DISABLED
    },
    dbError: false
  });
  record('productionDisabledDenied', productionDisabled.authorized === false &&
    productionDisabled.reason === 'DISABLED', productionDisabled.reason);

  // DEMO_EMAILS ignored in PRODUCTION
  record('demoEmailsIgnoredInProduction', productionUnknown.authorized === false &&
    productionUnknown.reason === 'UNKNOWN_USER', 'demo list present but ignored');

  // DISABLED Users row wins over DEMO allowlist
  var disabledDespiteDemo = resolve({
    email: 'disabled@example.com',
    appMode: HRMS.APP_MODE.DEMO,
    demoEmails: ['disabled@example.com'],
    demoRole: HRMS.ROLES.ADMIN,
    user: {
      google_email: 'disabled@example.com',
      employee_id: 'EMP099',
      role: HRMS.ROLES.EMPLOYEE,
      status: HRMS.USER_STATUS.DISABLED
    },
    dbError: false
  });
  record('disabledOverridesDemo', disabledDespiteDemo.authorized === false &&
    disabledDespiteDemo.reason === 'DISABLED', disabledDespiteDemo.reason);

  // ConfigService parsing helpers
  record('parseDemoEmails', ConfigService.parseDemoEmailList('A@x.com, b@x.com ;c@x.com').length === 3);
  record('parseDemoRoles', ConfigService.parseDemoRoleMap('a@x.com:HR,b@x.com:MANAGER')['a@x.com'] === 'HR');
  record('appModeConstants', HRMS.APP_MODE.PRODUCTION === 'PRODUCTION' && HRMS.APP_MODE.DEMO === 'DEMO');

  // OTP / login shell availability (multi-account: wrong Google identity must not dead-end).
  record('unknownUserMayOtpLogin',
    hrmsAuthRequiredForSession_(productionUnknown) === true);
  record('disabledUserCannotOtpAsSelf',
    hrmsAuthRequiredForSession_(productionDisabled) === false);
  record('authorizedUserNoLoginPrompt',
    hrmsAuthRequiredForSession_(productionAllowed) === false);
  record('emptyIdentityNeedsLogin',
    hrmsAuthRequiredForSession_({ authorized: false, reason: 'AUTH_REQUIRED' }) === true);

  var failed = results.filter(function (r) { return !r.passed; });
  Logger.log('Auth demo tests: ' + (results.length - failed.length) + '/' + results.length + ' passed');
  return { results: results, allPassed: failed.length === 0, failedCount: failed.length };
}
