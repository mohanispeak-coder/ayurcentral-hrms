/**
 * Google account → Users → employee_id + role.
 * DEMO mode: allowlisted Google emails may access without Users/Employees rows.
 */
var HRMS = HRMS || {};

/**
 * Whether the UI should offer email OTP / login instead of a dead-end unauthorized page.
 * Disabled accounts stay blocked; unknown/wrong Google identity may still OTP as a different email.
 * @param {Object} session
 * @return {boolean}
 */
function hrmsAuthRequiredForSession_(session) {
  if (!session) return true;
  if (session.authorized) return false;
  var reason = String(session.reason || '');
  if (reason === 'DISABLED') return false;
  if (reason === 'NOT_CONFIGURED') return false;
  return true;
}

/**
 * Pure access resolver for production + demo paths (unit-tested).
 * @param {Object} input
 * @return {Object} Session context
 */
function hrmsResolveAuthAccess_(input) {
  input = input || {};
  var email = String(input.email || '').trim().toLowerCase();

  if (!email) {
    return {
      authorized: false,
      email: '',
      employee_id: '',
      role: '',
      status: '',
      displayName: '',
      demo: false,
      reason: 'NO_IDENTITY',
      message: 'Sign in with your registered email to continue.'
    };
  }

  if (input.dbError) {
    return {
      authorized: false,
      email: email,
      employee_id: '',
      role: '',
      status: '',
      displayName: '',
      demo: false,
      reason: 'NOT_CONFIGURED',
      message: 'HRMS database is not configured. An administrator must run setup.'
    };
  }

  var user = input.user || null;
  if (user) {
    if (String(user.status).toUpperCase() !== HRMS.USER_STATUS.ACTIVE) {
      return {
        authorized: false,
        email: email,
        employee_id: user.employee_id,
        role: user.role,
        status: user.status,
        displayName: '',
        demo: false,
        reason: 'DISABLED',
        message: 'Your HRMS account is disabled. Contact your administrator.'
      };
    }

    var session = {
      authorized: true,
      email: email,
      employee_id: user.employee_id,
      role: String(user.role).toUpperCase(),
      status: user.status,
      displayName: input.displayName || '',
      demo: false,
      reason: '',
      message: ''
    };
    if (typeof UserAccessService !== 'undefined' && UserAccessService.attachToSession) {
      UserAccessService.attachToSession(session, user);
    }
    return session;
  }

  var appMode = String(input.appMode || HRMS.APP_MODE.PRODUCTION).trim().toUpperCase();
  if (appMode === HRMS.APP_MODE.DEMO) {
    var demoEmails = input.demoEmails || [];
    if (demoEmails.indexOf(email) >= 0) {
      var role = String(input.demoRole || HRMS.ROLES.ADMIN).trim().toUpperCase();
      return {
        authorized: true,
        email: email,
        employee_id: '',
        role: role,
        status: HRMS.USER_STATUS.ACTIVE,
        displayName: 'Demo (' + role + ')',
        demo: true,
        reason: '',
        message: ''
      };
    }
  }

  return {
    authorized: false,
    email: email,
    employee_id: '',
    role: '',
    status: '',
    displayName: '',
    demo: false,
    reason: 'UNKNOWN_USER',
    message: 'Your account is not registered in HRMS. Contact your administrator.'
  };
}

var AuthService = (function () {
  var requestSession_ = null;
  var requestSessionKey_ = '';
  var identityGenLocal_ = '';

  function normalizeEmail_(email) {
    return String(email || '').trim().toLowerCase();
  }

  function identityPrefix_() {
    return (HRMS.CACHE && HRMS.CACHE.IDENTITY_PREFIX) || 'hrms:id:v1:';
  }

  function identityGenKey_() {
    return (HRMS.CACHE && HRMS.CACHE.IDENTITY_GEN_KEY) || 'hrms:id:gen';
  }

  function identityTtl_() {
    return (HRMS.CACHE && HRMS.CACHE.IDENTITY_TTL_SEC) || 15;
  }

  function scriptCache_() {
    try {
      return CacheService.getScriptCache();
    } catch (e) {
      return null;
    }
  }

  function currentIdentityGen_() {
    var cache = scriptCache_();
    if (!cache) return '0';
    try {
      return cache.get(identityGenKey_()) || '0';
    } catch (e) {
      return '0';
    }
  }

  function invalidateIdentitySnapshots() {
    identityGenLocal_ = String(Date.now());
    requestSession_ = null;
    requestSessionKey_ = '';
    var cache = scriptCache_();
    if (!cache) return;
    try {
      cache.put(identityGenKey_(), identityGenLocal_, 21600);
    } catch (ignore) {}
  }

  function readIdentitySnapshot_(email) {
    var cache = scriptCache_();
    if (!cache || !email) return null;
    try {
      var raw = cache.get(identityPrefix_() + email);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.gen !== currentIdentityGen_()) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function writeIdentitySnapshot_(email, payload) {
    var cache = scriptCache_();
    if (!cache || !email || !payload) return;
    try {
      payload.gen = currentIdentityGen_();
      cache.put(identityPrefix_() + email, JSON.stringify(payload), identityTtl_());
    } catch (ignore) {}
  }

  function clearRequestSessionCache() {
    requestSession_ = null;
    requestSessionKey_ = '';
  }

  function getSessionEmail() {
    try {
      var active = Session.getActiveUser();
      if (!active) {
        return '';
      }
      return normalizeEmail_(active.getEmail());
    } catch (e) {
      return '';
    }
  }

  /**
   * Diagnostics only — HRMS auth uses activeEmail, never effectiveEmail.
   * Under USER_DEPLOYING, effectiveEmail is the script owner; activeEmail is the visitor.
   * @return {{activeEmail: string, effectiveEmail: string}}
   */
  function getIdentityDiagnostics() {
    var activeEmail = '';
    var effectiveEmail = '';
    try {
      activeEmail = getSessionEmail();
    } catch (ignore) {}
    try {
      effectiveEmail = normalizeEmail_(Session.getEffectiveUser().getEmail());
    } catch (ignore) {}
    return {
      activeEmail: activeEmail,
      effectiveEmail: effectiveEmail
    };
  }

  function resolveDemoRole_(email) {
    return ConfigService.getDemoRoleForEmail(email);
  }

  function buildAccessInput_(email) {
    var input = {
      email: email,
      appMode: HRMS.APP_MODE.PRODUCTION,
      demoEmails: [],
      demoRole: HRMS.ROLES.ADMIN,
      user: null,
      displayName: '',
      dbError: false
    };

    try {
      input.appMode = ConfigService.getAppMode();
      if (input.appMode === HRMS.APP_MODE.DEMO) {
        input.demoEmails = ConfigService.parseDemoEmailList(
          ConfigService.getSetting(HRMS.SETTINGS_KEYS.DEMO_EMAILS, '')
        );
        input.demoRole = resolveDemoRole_(email);
      }
    } catch (ignore) {}

    var snap = readIdentitySnapshot_(email);
    if (snap) {
      if (typeof HrmsPerf !== 'undefined' && HrmsPerf.count) HrmsPerf.count('identityCacheHit');
      input.user = snap.user || null;
      input.displayName = snap.displayName || '';
      return input;
    }

    try {
      input.user = DbService.findOne(HRMS.SHEETS.USERS, { google_email: email });
    } catch (e) {
      input.dbError = true;
      return input;
    }

    if (input.user) {
      try {
        var emp = DbService.findOne(HRMS.SHEETS.EMPLOYEES, { employee_id: input.user.employee_id });
        if (emp) input.displayName = emp.display_name || (emp.first_name + ' ' + emp.last_name);
      } catch (ignore) {}
    }

    writeIdentitySnapshot_(email, {
      user: input.user,
      displayName: input.displayName || ''
    });
    return input;
  }

  function resolveIdentityEmail_(options) {
    options = options || {};
    if (options.email !== undefined) {
      return normalizeEmail_(options.email);
    }
    var token = options.sessionToken || AuthSessionService.getRequestSessionToken();
    if (token) {
      var fromSession = AuthSessionService.getEmailForSessionToken(token);
      if (fromSession) {
        return fromSession;
      }
    }
    return getSessionEmail();
  }

  /**
   * @param {Object=} options { email, sessionToken }
   * @return {Object} Session context for current user.
   */
  function resolveSession(options) {
    options = options || {};
    var t0 = Date.now();
    if (typeof HrmsPerf !== 'undefined' && HrmsPerf.count) {
      HrmsPerf.count('resolveSession');
    }
    var resolvedEmail = resolveIdentityEmail_(options);
    var tokenHint = options.sessionToken ||
      (typeof AuthSessionService !== 'undefined' && AuthSessionService.getRequestSessionToken
        ? AuthSessionService.getRequestSessionToken()
        : '');
    var cacheKey = String(resolvedEmail || '') + '|' + String(tokenHint || '');
    if (requestSession_ && requestSessionKey_ === cacheKey) {
      if (typeof HrmsPerf !== 'undefined' && HrmsPerf.count) HrmsPerf.count('resolveSessionCacheHit');
      return requestSession_;
    }
    var session;
    if (!resolvedEmail) {
      session = {
        authorized: false,
        email: '',
        employee_id: '',
        role: '',
        status: '',
        displayName: '',
        demo: false,
        authRequired: true,
        reason: 'AUTH_REQUIRED',
        message: 'Sign in with your registered email to continue.'
      };
    } else {
      session = hrmsResolveAuthAccess_(buildAccessInput_(resolvedEmail));
      // Wrong/unauthorized Google identity must not block the login shell — OTP remains available.
      session.authRequired = hrmsAuthRequiredForSession_(session);
    }
    requestSession_ = session;
    requestSessionKey_ = cacheKey;
    if (typeof HrmsPerf !== 'undefined' && HrmsPerf.addStage) {
      HrmsPerf.addStage('session', Date.now() - t0);
    }
    return session;
  }

  /**
   * @return {Object} Active session or throws AUTHORIZATION.
   */
  function requireAuth() {
    var session = resolveSession();
    if (!session.authorized) {
      throw authorizationError_(session.message || 'Access denied.');
    }
    return session;
  }

  /**
   * First-run helper: when Users sheet is empty, register the running user as ADMIN.
   * Does not hard-code any email — uses Session only.
   * @param {Object=} options { alreadyLocked: true } when caller holds script lock
   * @return {Object|null}
   */
  function bootstrapFirstAdminIfEmpty(options) {
    options = options || {};
    function run_() {
      var users = DbService.getAllRecords(HRMS.SHEETS.USERS);
      if (users.length > 0) {
        return null;
      }
      var email = getSessionEmail();
      if (!email) {
        throw authorizationError_('Cannot bootstrap admin without a Google identity.');
      }
      var employeeId = DbService.nextEmployeeIdAssumingLocked
        ? DbService.nextEmployeeIdAssumingLocked()
        : DbService.nextEmployeeId();
      var now = new Date();
      DbService.insertRecord(HRMS.SHEETS.EMPLOYEES, {
        employee_id: employeeId,
        first_name: 'System',
        last_name: 'Administrator',
        display_name: 'System Administrator',
        work_email: email,
        department: 'Administration',
        designation: 'Administrator',
        joining_date: now,
        employment_type: 'PERMANENT',
        location: 'Head Office',
        status: 'ACTIVE',
        created_at: now,
        created_by_email: email,
        updated_at: now,
        updated_by_email: email
      });
      DbService.insertRecord(HRMS.SHEETS.USERS, {
        google_email: email,
        employee_id: employeeId,
        role: HRMS.ROLES.ADMIN,
        status: HRMS.USER_STATUS.ACTIVE,
        created_at: now,
        updated_at: now
      });
      AuditService.log('USER_BOOTSTRAP', 'Users', email, 'First admin user bootstrapped', employeeId);
      return { employee_id: employeeId, google_email: email, role: HRMS.ROLES.ADMIN };
    }
    if (options.alreadyLocked) {
      return run_();
    }
    return withScriptLock_(run_);
  }

  return {
    getSessionEmail: getSessionEmail,
    getIdentityDiagnostics: getIdentityDiagnostics,
    resolveSession: resolveSession,
    requireAuth: requireAuth,
    bootstrapFirstAdminIfEmpty: bootstrapFirstAdminIfEmpty,
    clearRequestSessionCache: clearRequestSessionCache,
    invalidateIdentitySnapshots: invalidateIdentitySnapshots
  };
})();
