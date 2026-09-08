/**
 * Client-callable API — foundation endpoints only.
 */

/** Allowlisted module UI partials for lazy load (shell stays lean). */
var HRMS_MODULE_UI_FILES_ = {
  employee: ['employee/EmployeePages', 'employee/EmployeeClient'],
  leave: ['leave/LeaveUi', 'leave/LeaveClient'],
  payroll: ['payroll/PayrollClient'],
  pms: ['pms/PmsClient'],
  ats: ['ats/AtsClient'],
  notifications: ['notifications/NotificationClient']
};

/** @return {Object} */
function apiGetAppBootstrap(sessionToken) {
  return hrmsRun_(function () {
    var t0 = Date.now();
    var timings = {};

    var tAuth = Date.now();
    var session = AuthService.resolveSession();
    timings.authMs = Date.now() - tAuth;

    var configured = false;
    var configError = '';
    try {
      ConfigService.getSpreadsheetId();
      configured = true;
    } catch (e) {
      configError = e.message;
    }

    var nav = [];
    if (session.authorized) {
      // Reuse resolved session — do not call requireAuth()/resolveSession again.
      PermissionService.require(HRMS.ACTIONS.ACCESS_APP, {}, session);
      nav = PermissionService.getNavForRole(session.role);
    }

    // Active Google identity only (skip effective-user diagnostics on hot path).
    var activeEmail = AuthService.getSessionEmail();

    var tApp = Date.now();
    var companyName = 'AyurCentral HRMS';
    var timezone = 'Asia/Kolkata';
    var mode = HRMS.APP_MODE.PRODUCTION;
    if (configured) {
      companyName = ConfigService.getCompanyName();
      timezone = ConfigService.getTimezone();
      mode = ConfigService.getAppMode();
    }
    timings.configMs = Date.now() - tApp;

    timings.totalMs = Date.now() - t0;
    HrmsPerf.log('apiGetAppBootstrap', timings.totalMs);
    HrmsPerf.log('auth.resolveSession', timings.authMs);

    var payload = {
      session: {
        authorized: session.authorized,
        email: session.email,
        employee_id: session.employee_id,
        role: session.role,
        displayName: session.displayName,
        reason: session.reason,
        message: session.message,
        demo: !!session.demo,
        authRequired: !!session.authRequired
      },
      auth: {
        path: activeEmail ? 'GOOGLE' : (session.authorized && session.email ? 'OTP' : 'NONE'),
        hasGoogleIdentity: !!activeEmail
      },
      app: {
        companyName: companyName,
        currency: ConfigService.getCurrency(),
        timezone: timezone,
        configured: configured,
        configError: configError,
        mode: mode
      },
      navigation: nav,
      phase: 'foundation'
    };

    if (HrmsPerf.enabled()) {
      payload.timings = timings;
    }
    return payload;
  }, sessionToken);
}

/**
 * Lazy-load module HTML/JS for first paint optimization.
 * Requires ACCESS_APP. Returns concatenated HTML for allowlisted modules only.
 * @param {string} moduleId employee | leave | payroll | pms | ats | notifications
 * @param {string=} sessionToken
 * @return {Object} { moduleId, html }
 */
function apiGetModuleUi(moduleId, sessionToken) {
  return hrmsRun_(function () {
    PermissionService.require(HRMS.ACTIONS.ACCESS_APP);
    var id = String(moduleId || '').trim().toLowerCase();
    var files = HRMS_MODULE_UI_FILES_[id];
    if (!files) {
      throw validationError_('Unknown module UI: ' + id);
    }
    var t0 = Date.now();
    var parts = [];
    for (var i = 0; i < files.length; i++) {
      parts.push(HtmlService.createHtmlOutputFromFile(files[i]).getContent());
    }
    HrmsPerf.log('apiGetModuleUi:' + id, Date.now() - t0);
    return { moduleId: id, html: parts.join('\n') };
  }, sessionToken);
}

/** @return {Object} */
function apiRequestAuthOtp(email, sessionToken) {
  return hrmsRun_(function () {
    try {
      ConfigService.getSpreadsheetId();
    } catch (e) {
      throw configurationError_('HRMS database is not configured.');
    }
    return AuthSessionService.requestOtp(email);
  }, sessionToken);
}

/** @return {Object} */
function apiVerifyAuthOtp(email, code, sessionToken) {
  return hrmsRun_(function () {
    var result = AuthSessionService.verifyOtp(email, code);
    if (!result.ok) {
      throw validationError_(result.message, { reason: result.reason });
    }
    HRMS_REQUEST_SESSION_TOKEN_ = result.sessionToken || '';
    var session = AuthService.resolveSession({ email: email, sessionToken: result.sessionToken });
    if (!session.authorized) {
      throw authorizationError_(session.message || 'Access denied.');
    }
    PermissionService.require(HRMS.ACTIONS.ACCESS_APP, {}, session);
    return {
      sessionToken: result.sessionToken,
      expiresInSeconds: result.expiresInSeconds,
      session: {
        authorized: session.authorized,
        email: session.email,
        employee_id: session.employee_id,
        role: session.role,
        displayName: session.displayName,
        demo: !!session.demo
      },
      navigation: PermissionService.getNavForRole(session.role)
    };
  }, sessionToken);
}

/** @return {Object} */
function apiLogout(sessionToken) {
  return hrmsRun_(function () {
    if (sessionToken) {
      AuthSessionService.invalidateSession(sessionToken);
    }
    return { loggedOut: true };
  }, sessionToken);
}

/** @return {Object} */
function apiRunDatabaseSetup(spreadsheetId, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.resolveSession();
    var hasSpreadsheet = false;
    try {
      ConfigService.getSpreadsheetId();
      hasSpreadsheet = true;
    } catch (e) {
      hasSpreadsheet = false;
    }

    if (hasSpreadsheet) {
      if (!session.authorized) {
        throw authorizationError_('Only registered administrators can run setup on an existing database.');
      }
      PermissionService.require(HRMS.ACTIONS.RUN_SETUP);
    }

    return withScriptLock_(function () {
      var result = SchemaService.setupDatabase(spreadsheetId || '');
      if (SchemaService.ensureModuleSheets) SchemaService.ensureModuleSheets();
      var boot = AuthService.bootstrapFirstAdminIfEmpty({ alreadyLocked: true });
      if (boot) {
        result.bootstrapAdmin = boot;
      } else if (session.authorized) {
        AuditService.log('DB_SETUP', 'Spreadsheet', result.spreadsheetId, 'Database setup verified', session.employee_id);
      }
      return result;
    });
  }, sessionToken);
}

/** Role-scoped home dashboard — immediate cards only (unread + leave). */
function apiGetHomeDashboard(sessionToken) {
  return hrmsRun_(function () {
    var session = PermissionService.require(HRMS.ACTIONS.ACCESS_APP);
    return HomeDashboardService.buildPrimary(session);
  }, sessionToken);
}

/** Secondary dashboard cards (payroll / PMS / ATS). */
function apiGetHomeDashboardMore(sessionToken) {
  return hrmsRun_(function () {
    var session = PermissionService.require(HRMS.ACTIONS.ACCESS_APP);
    return HomeDashboardService.buildSecondary(session);
  }, sessionToken);
}

/** @return {Object} */
function apiRunDriveSetup(sessionToken) {
  return hrmsRun_(function () {
    var session = PermissionService.require(HRMS.ACTIONS.RUN_SETUP);
    var result = DriveService.setupRootStructure();
    AuditService.log('DRIVE_SETUP', 'Drive', result.rootFolderId, 'Drive root structure created', session.employee_id);
    return result;
  }, sessionToken);
}

/** @return {Object} */
function apiVerifyDriveAccess(sessionToken) {
  return hrmsRun_(function () {
    PermissionService.require(HRMS.ACTIONS.RUN_SETUP);
    return DriveService.verifyAccess();
  }, sessionToken);
}

/** @return {Object} */
function apiTestPermission(action, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return {
      action: action,
      allowed: PermissionService.can(action, {}, session),
      role: session.role,
      employee_id: session.employee_id
    };
  }, sessionToken);
}

/** @return {Object} */
function apiWriteTestAudit(sessionToken) {
  return hrmsRun_(function () {
    var session = PermissionService.require(HRMS.ACTIONS.VIEW_AUDIT);
    AuditService.log('FOUNDATION_TEST', 'System', 'test', 'Foundation audit test entry', session.employee_id);
    return { written: true };
  }, sessionToken);
}

/** @return {Object} */
function apiGetRecentAudit(sessionToken) {
  return hrmsRun_(function () {
    PermissionService.require(HRMS.ACTIONS.VIEW_AUDIT);
    return AuditService.getRecent(10);
  }, sessionToken);
}

/** @return {Object} */
function apiTestLock(sessionToken) {
  return hrmsRun_(function () {
    AuthService.requireAuth();
    var counter = 0;
    withScriptLock_(function () {
      counter = 1;
    });
    return { lockAcquired: counter === 1 };
  }, sessionToken);
}

/** @return {Object} */
function apiGetSchemaInfo(sessionToken) {
  return hrmsRun_(function () {
    PermissionService.require(HRMS.ACTIONS.RUN_SETUP);
    return SchemaService.getSchemaInfo();
  }, sessionToken);
}

/** Foundation self-test — run from Apps Script editor. */
function runFoundationSelfTest() {
  var results = [];
  function check(name, fn) {
    try {
      fn();
      results.push({ name: name, ok: true });
    } catch (e) {
      results.push({ name: name, ok: false, error: e.message });
    }
  }

  check('schemaInfo', function () {
    if (!SchemaService.getSchemaInfo().sheets.length) throw new Error('No sheets');
  });

  check('lock', function () {
    withScriptLock_(function () {});
  });

  Logger.log(JSON.stringify(results, null, 2));
  return results;
}
