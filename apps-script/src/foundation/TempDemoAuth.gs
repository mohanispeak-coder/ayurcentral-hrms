/**
 * TEMPORARY: User ID + password login without OTP.
 * Delete this file and related settings when the feature is retired.
 */
var HRMS = HRMS || {};

function hrmsTempDemoNormalizeUserId_(userId) {
  return String(userId || '').trim();
}

function hrmsTempDemoSessionEmail_() {
  return (HRMS.TEMP_DEMO && HRMS.TEMP_DEMO.SESSION_EMAIL) || '__hrms_temp_demo__@login.local';
}

function hrmsTempDemoRateKey_(userId) {
  return HRMS.AUTH_CACHE.TEMP_DEMO_RATE_PREFIX + hrmsTempDemoNormalizeUserId_(userId).toLowerCase();
}

function hrmsTempDemoHashPassword_(password, salt) {
  return hrmsAuthHashOtp_(password, salt);
}

/**
 * @param {string} userId
 * @param {string} password
 * @param {Object} context { enabled, expectedUserId, passwordHash, passwordSalt, store, now, memoryOnly }
 * @return {Object}
 */
function hrmsTempDemoVerifyLogin_(userId, password, context) {
  context = context || {};
  var store = hrmsAuthCreateStoreAdapter_(context.store, context.memoryOnly === true);
  var now = context.now ? Number(context.now) : Date.now();
  userId = hrmsTempDemoNormalizeUserId_(userId);
  password = String(password || '');

  if (!context.enabled) {
    return { ok: false, reason: 'DISABLED', message: 'Demo login is not available.' };
  }
  if (!userId || userId.length < 2) {
    return { ok: false, reason: 'VALIDATION', message: 'Enter your user ID.' };
  }
  if (!password) {
    return { ok: false, reason: 'VALIDATION', message: 'Enter your password.' };
  }

  var expectedId = hrmsTempDemoNormalizeUserId_(context.expectedUserId);
  var salt = String(context.passwordSalt || '');
  var hash = String(context.passwordHash || '');
  if (!expectedId || !salt || !hash) {
    return { ok: false, reason: 'NOT_CONFIGURED', message: 'Demo login is not configured. Contact your administrator.' };
  }

  var rateKey = hrmsTempDemoRateKey_(userId);
  var rateRaw = store.get(rateKey);
  var rate = hrmsAuthParseJson_(rateRaw) || { attempts: 0, windowStart: now };
  if (now - Number(rate.windowStart || 0) > HRMS.AUTH_LIMITS.OTP_RATE_WINDOW_MS) {
    rate = { attempts: 0, windowStart: now };
  }

  if (userId.toLowerCase() !== expectedId.toLowerCase() ||
    hrmsTempDemoHashPassword_(password, salt) !== hash) {
    rate.attempts = Number(rate.attempts || 0) + 1;
    store.put(rateKey, JSON.stringify(rate), HRMS.AUTH_LIMITS.OTP_RATE_WINDOW_SEC);
    if (rate.attempts >= HRMS.AUTH_LIMITS.TEMP_DEMO_MAX_ATTEMPTS) {
      return {
        ok: false,
        reason: 'LOCKED',
        message: 'Too many failed attempts. Please wait before trying again.'
      };
    }
    return { ok: false, reason: 'INVALID', message: 'Incorrect user ID or password.' };
  }

  store.remove(rateKey);

  var email = hrmsTempDemoSessionEmail_();
  var token = hrmsAuthGenerateToken_();
  var sessionPayload = { email: email, createdAt: now, tempDemo: true };
  var sessionKey = hrmsAuthSessionKey_(token);
  store.put(sessionKey, JSON.stringify(sessionPayload), HRMS.AUTH_LIMITS.SESSION_TTL_SEC);
  if (context.memoryOnly !== true) {
    hrmsAuthSessionWriteDurable_(sessionKey, sessionPayload, HRMS.AUTH_LIMITS.SESSION_TTL_SEC);
  }

  return {
    ok: true,
    reason: 'VERIFIED',
    sessionToken: token,
    expiresInSeconds: HRMS.AUTH_LIMITS.SESSION_TTL_SEC,
    email: email
  };
}

var TempDemoAuthService = (function () {
  function verifyLogin(userId, password) {
    return withScriptLock_(function () {
      return hrmsTempDemoVerifyLogin_(userId, password, {
        enabled: ConfigService.isTempDemoLoginEnabled(),
        expectedUserId: ConfigService.getTempDemoUserId(),
        passwordSalt: ConfigService.getTempDemoPasswordSalt(),
        passwordHash: ConfigService.getTempDemoPasswordHash(),
        store: null,
        now: Date.now()
      });
    }, 15000);
  }

  return {
    verifyLogin: verifyLogin
  };
})();

/**
 * Editor-only: set demo credentials and enable login. Run once from Apps Script.
 * @param {string} userId
 * @param {string} password
 * @param {string=} role ADMIN|HR|… (default ADMIN)
 * @return {Object}
 */
function devSetTempDemoCredentials(userId, password, role) {
  userId = hrmsTempDemoNormalizeUserId_(userId);
  password = String(password || '');
  if (!userId || userId.length < 2) {
    throw new Error('userId must be at least 2 characters');
  }
  if (!password || password.length < 6) {
    throw new Error('password must be at least 6 characters');
  }
  var salt = Utilities.getUuid();
  var hash = hrmsTempDemoHashPassword_(password, salt);
  ConfigService.upsertSettingValue(HRMS.SETTINGS_KEYS.TEMP_DEMO_USER_ID, userId);
  ConfigService.upsertSettingValue(HRMS.SETTINGS_KEYS.TEMP_DEMO_PASSWORD_SALT, salt);
  ConfigService.upsertSettingValue(HRMS.SETTINGS_KEYS.TEMP_DEMO_PASSWORD_HASH, hash);
  ConfigService.upsertSettingValue(HRMS.SETTINGS_KEYS.TEMP_DEMO_LOGIN_ENABLED, 'true');
  if (role) {
    ConfigService.upsertSettingValue(HRMS.SETTINGS_KEYS.TEMP_DEMO_ROLE, String(role).trim().toUpperCase());
  }
  Logger.log('devSetTempDemoCredentials: enabled for userId=' + userId + ' sessionEmail=' + hrmsTempDemoSessionEmail_());
  return { ok: true, userId: userId, sessionEmail: hrmsTempDemoSessionEmail_() };
}

/**
 * Editor-only: disable temporary demo login without deleting stored hash.
 */
function devDisableTempDemoLogin() {
  ConfigService.upsertSettingValue(HRMS.SETTINGS_KEYS.TEMP_DEMO_LOGIN_ENABLED, 'false');
  Logger.log('devDisableTempDemoLogin: disabled');
  return { ok: true };
}
