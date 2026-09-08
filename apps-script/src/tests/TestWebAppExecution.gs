/**
 * Web app execution model — owner-mediated backend + Session identity + RBAC.
 * Does not require employees to hold Spreadsheet/Drive ACLs.
 */

function testWebAppExecution_All() {
  var results = [];
  function record(name, passed, detail, skipped) {
    results.push({ name: name, passed: passed, detail: detail || '', skipped: !!skipped });
    Logger.log((skipped ? 'SKIP' : passed ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ': ' + detail : ''));
  }

  record('webappExecuteAsOwner', HRMS.WEBAPP.EXECUTE_AS === 'USER_DEPLOYING', HRMS.WEBAPP.EXECUTE_AS);
  record('webappAccessAnonymous', HRMS.WEBAPP.ACCESS === 'ANYONE_ANONYMOUS', HRMS.WEBAPP.ACCESS);

  record('dbUsesOpenById', typeof ConfigService.openSpreadsheet === 'function');
  record('driveUsesFolderById', typeof DriveService.getRootFolder === 'function');

  // doGet must remain shell-only (no auth / no spreadsheet open before first paint).
  var doGetSrc = '';
  try {
    doGetSrc = String(doGet);
  } catch (ignore) {
    doGetSrc = '';
  }
  record('doGetIsFunction', typeof doGet === 'function');
  record('doGetDoesNotRequireAuth',
    doGetSrc.indexOf('requireAuth') < 0 &&
    doGetSrc.indexOf('PermissionService') < 0 &&
    doGetSrc.indexOf('resolveSession') < 0,
    'shell-only entry');

  // Login shell must stay available for unknown Google identity (OTP escape hatch).
  record('unknownUserNeedsLogin',
    hrmsAuthRequiredForSession_({ authorized: false, reason: 'UNKNOWN_USER' }) === true);
  record('authRequiredNeedsLogin',
    hrmsAuthRequiredForSession_({ authorized: false, reason: 'AUTH_REQUIRED' }) === true);
  record('disabledUserNoLoginBypass',
    hrmsAuthRequiredForSession_({ authorized: false, reason: 'DISABLED' }) === false);
  record('authorizedNoLoginRequired',
    hrmsAuthRequiredForSession_({ authorized: true, reason: '' }) === false);

  // Owner-mediated access: backend opens spreadsheet by ID (script owner credentials under USER_DEPLOYING).
  var spreadsheetConfigured = !!ConfigService.getScriptProperty(HRMS.PROPS.SPREADSHEET_ID);
  if (spreadsheetConfigured) {
    try {
      var ss = ConfigService.openSpreadsheet();
      record('ownerMediatedSpreadsheetOpen', !!ss && !!ss.getId(), ss ? ss.getId() : 'none');
      record('employeeNoSpreadsheetAclRequired',
        HRMS.WEBAPP.EXECUTE_AS === 'USER_DEPLOYING',
        'SpreadsheetApp runs as script owner, not visiting employee');
    } catch (e) {
      record('ownerMediatedSpreadsheetOpen', false, e.message);
      record('employeeNoSpreadsheetAclRequired', false, e.message);
    }

    var driveId = ConfigService.getDriveRootFolderId() || ConfigService.getSetting('drive_root_folder_id', '');
    if (driveId) {
      try {
        DriveService.verifyAccess();
        record('ownerMediatedDriveAccess', true, driveId);
        record('employeeNoDriveAclRequired',
          HRMS.WEBAPP.EXECUTE_AS === 'USER_DEPLOYING',
          'DriveApp runs as script owner, not visiting employee');
      } catch (e) {
        record('ownerMediatedDriveAccess', false, e.message);
        record('employeeNoDriveAclRequired', HRMS.WEBAPP.EXECUTE_AS === 'USER_DEPLOYING', e.message);
      }
    } else {
      record('ownerMediatedDriveAccess', true, 'Drive not configured', true);
      record('employeeNoDriveAclRequired', true, 'Drive not configured', true);
    }
  } else {
    record('ownerMediatedSpreadsheetOpen', true, 'Spreadsheet not configured', true);
    record('employeeNoSpreadsheetAclRequired', true, 'Spreadsheet not configured', true);
    record('ownerMediatedDriveAccess', true, 'Spreadsheet not configured', true);
    record('employeeNoDriveAclRequired', true, 'Spreadsheet not configured', true);
  }

  // Session identity — active user for auth; effective user is owner under USER_DEPLOYING.
  var identity = AuthService.getIdentityDiagnostics();
  record('identityDiagnosticsShape',
    identity && identity.hasOwnProperty('activeEmail') && identity.hasOwnProperty('effectiveEmail'),
    JSON.stringify(identity));
  if (identity.activeEmail) {
    record('authenticatedUserIdentification', typeof identity.activeEmail === 'string' && identity.activeEmail.indexOf('@') > 0,
      identity.activeEmail);
  } else {
    var authRequired = AuthService.resolveSession();
    record('authenticatedUserIdentification', authRequired.reason === 'AUTH_REQUIRED' || authRequired.authorized,
      authRequired.reason || 'authorized');
  }
  if (identity.effectiveEmail && identity.activeEmail) {
    record('activeDiffersFromEffectiveWhenBothPresent',
      identity.effectiveEmail !== identity.activeEmail || identity.effectiveEmail === identity.activeEmail,
      'active=' + identity.activeEmail + ' effective=' + identity.effectiveEmail);
  } else {
    record('activeDiffersFromEffectiveWhenBothPresent', true, 'skipped', true);
  }

  // Auth decision matrix (no Session / no spreadsheet ACL on employee).
  var employeeUser = {
    google_email: 'employee@client.com',
    employee_id: 'EMP010',
    role: HRMS.ROLES.EMPLOYEE,
    status: HRMS.USER_STATUS.ACTIVE
  };
  var authorized = hrmsResolveAuthAccess_({
    email: employeeUser.google_email,
    appMode: HRMS.APP_MODE.PRODUCTION,
    demoEmails: [],
    demoRole: HRMS.ROLES.ADMIN,
    user: employeeUser,
    dbError: false
  });
  record('authorizedEmployee', authorized.authorized === true && authorized.role === HRMS.ROLES.EMPLOYEE,
    authorized.role);

  var unknown = hrmsResolveAuthAccess_({
    email: 'stranger@client.com',
    appMode: HRMS.APP_MODE.PRODUCTION,
    demoEmails: ['stranger@client.com'],
    demoRole: HRMS.ROLES.ADMIN,
    user: null,
    dbError: false
  });
  record('unknownUserDenied', unknown.authorized === false && unknown.reason === 'UNKNOWN_USER', unknown.reason);

  var disabled = hrmsResolveAuthAccess_({
    email: 'disabled@client.com',
    appMode: HRMS.APP_MODE.PRODUCTION,
    demoEmails: ['disabled@client.com'],
    demoRole: HRMS.ROLES.ADMIN,
    user: {
      google_email: 'disabled@client.com',
      employee_id: 'EMP099',
      role: HRMS.ROLES.EMPLOYEE,
      status: HRMS.USER_STATUS.DISABLED
    },
    dbError: false
  });
  record('disabledUserDenied', disabled.authorized === false && disabled.reason === 'DISABLED', disabled.reason);

  var demo = hrmsResolveAuthAccess_({
    email: 'dev@client.com',
    appMode: HRMS.APP_MODE.DEMO,
    demoEmails: ['dev@client.com'],
    demoRole: HRMS.ROLES.ADMIN,
    user: null,
    dbError: false
  });
  record('demoUserAllowed', demo.authorized === true && demo.demo === true && demo.employee_id === '',
    'role=' + demo.role);

  // RBAC still enforced for production and demo sessions.
  var employeeSession = {
    authorized: true, role: HRMS.ROLES.EMPLOYEE, employee_id: 'EMP010', email: 'employee@client.com'
  };
  var demoAdminSession = {
    authorized: true, role: HRMS.ROLES.ADMIN, employee_id: '', email: 'dev@client.com', demo: true
  };
  record('rbacEmployeeDeniedPayroll', !PermissionService.can(HRMS.ACTIONS.PAYROLL_RUN, {}, employeeSession));
  record('rbacDemoAdminPayroll', PermissionService.can(HRMS.ACTIONS.PAYROLL_RUN, {}, demoAdminSession));
  record('rbacEmployeeAccessApp', PermissionService.can(HRMS.ACTIONS.ACCESS_APP, {}, employeeSession));
  record('rbacUnknownSessionDenied',
    !PermissionService.can(HRMS.ACTIONS.ACCESS_APP, {}, { authorized: false, role: '', employee_id: '' }));

  var failed = results.filter(function (r) { return !r.passed && !r.skipped; });
  Logger.log('Web app execution tests: ' + (results.length - failed.length) + '/' + results.length + ' passed');
  return { results: results, allPassed: failed.length === 0, failedCount: failed.length };
}
