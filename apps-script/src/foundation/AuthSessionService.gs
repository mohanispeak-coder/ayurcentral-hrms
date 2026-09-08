/**
 * OTP verification and application sessions (CacheService).
 * Never stores passwords or OTPs in the spreadsheet.
 */
var HRMS = HRMS || {};

/** Request-scoped session token set by hrmsRun_. */
var HRMS_REQUEST_SESSION_TOKEN_ = '';

/**
 * In-memory/cache store adapter for tests.
 * @param {Object=} store
 * @param {boolean=} memoryOnly When true, never read/write ScriptCache (tests).
 * @return {Object}
 */
function hrmsAuthCreateStoreAdapter_(store, memoryOnly) {
  store = store || {};
  memoryOnly = memoryOnly === true;
  return {
    get: function (key) {
      if (store.hasOwnProperty(key)) return store[key];
      if (memoryOnly) return null;
      try {
        return CacheService.getScriptCache().get(key);
      } catch (e) {
        return null;
      }
    },
    put: function (key, value, ttlSeconds) {
      store[key] = value;
      if (!memoryOnly) {
        try {
          CacheService.getScriptCache().put(key, value, ttlSeconds);
        } catch (ignore) {}
      }
    },
    remove: function (key) {
      delete store[key];
      if (!memoryOnly) {
        try {
          CacheService.getScriptCache().remove(key);
        } catch (ignore) {}
      }
    }
  };
}

function hrmsAuthNormalizeEmail_(email) {
  return String(email || '').trim().toLowerCase();
}

function hrmsAuthOtpKey_(email) {
  return HRMS.AUTH_CACHE.OTP_PREFIX + hrmsAuthNormalizeEmail_(email);
}

function hrmsAuthOtpRateKey_(email) {
  return HRMS.AUTH_CACHE.OTP_RATE_PREFIX + hrmsAuthNormalizeEmail_(email);
}

function hrmsAuthOtpDemoRateKey_(email) {
  return HRMS.AUTH_CACHE.OTP_DEMO_RATE_PREFIX + hrmsAuthNormalizeEmail_(email);
}

/**
 * @param {{reason: string}} eligibility From hrmsAuthEvaluateOtpEligibility_.
 * @return {{rateKey: string, maxRequests: number}}
 */
function hrmsAuthResolveOtpRatePolicy_(eligibility, email) {
  if (eligibility && eligibility.reason === 'DEMO') {
    return {
      rateKey: hrmsAuthOtpDemoRateKey_(email),
      maxRequests: HRMS.AUTH_LIMITS.DEMO_OTP_MAX_REQUESTS
    };
  }
  return {
    rateKey: hrmsAuthOtpRateKey_(email),
    maxRequests: HRMS.AUTH_LIMITS.OTP_MAX_REQUESTS
  };
}

/**
 * Remove OTP and rate-limit cache entries for an email. Never creates a session.
 * @param {string} email
 * @param {Object=} store
 * @param {boolean=} memoryOnly
 * @return {{cleared: boolean, email: string}}
 */
function hrmsAuthClearOtpStateForEmail_(email, store, memoryOnly) {
  email = hrmsAuthNormalizeEmail_(email);
  if (!email) {
    return { cleared: false, email: '', reason: 'INVALID_EMAIL' };
  }
  var adapter = hrmsAuthCreateStoreAdapter_(store, memoryOnly === true);
  adapter.remove(hrmsAuthOtpRateKey_(email));
  adapter.remove(hrmsAuthOtpDemoRateKey_(email));
  adapter.remove(hrmsAuthOtpKey_(email));
  return { cleared: true, email: email };
}

function hrmsAuthSessionKey_(token) {
  return HRMS.AUTH_CACHE.SESSION_PREFIX + String(token || '');
}

function hrmsAuthGenerateOtp_() {
  var raw = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    Utilities.getUuid() + String(Date.now()) + Math.random()
  );
  var n = 0;
  for (var i = 0; i < raw.length; i++) {
    n = (n * 256 + (raw[i] < 0 ? raw[i] + 256 : raw[i])) >>> 0;
  }
  n = n % 1000000;
  var code = String(n);
  while (code.length < 6) code = '0' + code;
  return code;
}

function hrmsAuthGenerateToken_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
}

function hrmsAuthHashOtp_(otp, salt) {
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(salt) + String(otp)
  );
  return Utilities.base64EncodeWebSafe(digest);
}

function hrmsAuthParseJson_(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

/**
 * Resolve whether OTP may be sent for this email.
 * @param {string} email
 * @param {Object} context { findUser, isDemoAllowed }
 * @return {{allowed: boolean, reason: string, user: Object|null}}
 */
function hrmsAuthEvaluateOtpEligibility_(email, context) {
  context = context || {};
  email = hrmsAuthNormalizeEmail_(email);
  if (!email || email.indexOf('@') < 1) {
    return { allowed: false, reason: 'INVALID_EMAIL', user: null };
  }

  var user = null;
  try {
    user = context.findUser ? context.findUser(email) : null;
  } catch (e) {
    return { allowed: false, reason: 'NOT_CONFIGURED', user: null };
  }

  if (user) {
    if (String(user.status).toUpperCase() !== HRMS.USER_STATUS.ACTIVE) {
      return { allowed: false, reason: 'DISABLED', user: user };
    }
    return { allowed: true, reason: 'OK', user: user };
  }

  if (context.isDemoAllowed && context.isDemoAllowed(email)) {
    return { allowed: true, reason: 'DEMO', user: null };
  }

  return { allowed: false, reason: 'UNKNOWN_USER', user: null };
}

/**
 * @param {string} email
 * @param {Object} context { findUser, isDemoAllowed, sendMail, store, now }
 * @return {Object}
 */
function hrmsAuthOtpRequest_(email, context) {
  context = context || {};
  var store = hrmsAuthCreateStoreAdapter_(context.store, context.memoryOnly === true);
  var now = context.now ? Number(context.now) : Date.now();
  email = hrmsAuthNormalizeEmail_(email);

  var eligibility = hrmsAuthEvaluateOtpEligibility_(email, context);
  if (!eligibility.allowed) {
    if (eligibility.reason === 'DISABLED') {
      return {
        ok: false,
        reason: 'DISABLED',
        message: 'Your HRMS account is disabled. Contact your administrator.'
      };
    }
    if (eligibility.reason === 'UNKNOWN_USER') {
      return {
        ok: false,
        reason: 'UNKNOWN_USER',
        message: 'Your account is not registered in HRMS. Contact your administrator.'
      };
    }
    if (eligibility.reason === 'INVALID_EMAIL') {
      return {
        ok: false,
        reason: 'VALIDATION',
        message: 'Enter a valid email address.'
      };
    }
    return {
      ok: false,
      reason: 'NOT_CONFIGURED',
      message: 'HRMS database is not configured. An administrator must run setup.'
    };
  }

  var ratePolicy = hrmsAuthResolveOtpRatePolicy_(eligibility, email);
  var rateKey = ratePolicy.rateKey;
  var rateRaw = store.get(rateKey);
  var rate = hrmsAuthParseJson_(rateRaw) || { times: [] };
  rate.times = (rate.times || []).filter(function (t) {
    return now - t < HRMS.AUTH_LIMITS.OTP_RATE_WINDOW_MS;
  });
  if (rate.times.length >= ratePolicy.maxRequests) {
    return {
      ok: false,
      reason: 'RATE_LIMIT',
      message: 'Too many verification requests. Please wait before trying again.'
    };
  }

  rate.times.push(now);
  store.put(rateKey, JSON.stringify(rate), HRMS.AUTH_LIMITS.OTP_RATE_WINDOW_SEC);

  var otp = hrmsAuthGenerateOtp_();
  var salt = Utilities.getUuid();
  var otpState = {
    hash: hrmsAuthHashOtp_(otp, salt),
    salt: salt,
    attempts: 0,
    createdAt: now
  };
  store.put(hrmsAuthOtpKey_(email), JSON.stringify(otpState), HRMS.AUTH_LIMITS.OTP_TTL_SEC);

  if (context.sendMail) {
    context.sendMail(email, otp);
  }

  return {
    ok: true,
    reason: 'SENT',
    message: 'If this email is registered, a verification code has been sent.'
  };
}

/**
 * @param {string} email
 * @param {string} code
 * @param {Object} context { store, now }
 * @return {Object}
 */
function hrmsAuthOtpVerify_(email, code, context) {
  context = context || {};
  var store = hrmsAuthCreateStoreAdapter_(context.store, context.memoryOnly === true);
  var now = context.now ? Number(context.now) : Date.now();
  email = hrmsAuthNormalizeEmail_(email);
  code = String(code || '').trim();

  if (!email || email.indexOf('@') < 1) {
    return { ok: false, reason: 'VALIDATION', message: 'Enter a valid email address.' };
  }
  if (!/^\d{6}$/.test(code)) {
    return { ok: false, reason: 'VALIDATION', message: 'Enter the 6-digit verification code.' };
  }

  var otpKey = hrmsAuthOtpKey_(email);
  var raw = store.get(otpKey);
  if (!raw) {
    return { ok: false, reason: 'EXPIRED', message: 'This verification code has expired. Request a new code.' };
  }

  var state = hrmsAuthParseJson_(raw);
  if (!state || !state.hash || !state.salt) {
    store.remove(otpKey);
    return { ok: false, reason: 'EXPIRED', message: 'This verification code has expired. Request a new code.' };
  }

  if (now - Number(state.createdAt) > HRMS.AUTH_LIMITS.OTP_TTL_MS) {
    store.remove(otpKey);
    return { ok: false, reason: 'EXPIRED', message: 'This verification code has expired. Request a new code.' };
  }

  state.attempts = Number(state.attempts || 0) + 1;
  var hash = hrmsAuthHashOtp_(code, state.salt);

  if (hash !== state.hash) {
    if (state.attempts >= HRMS.AUTH_LIMITS.OTP_MAX_VERIFY_ATTEMPTS) {
      store.remove(otpKey);
      return {
        ok: false,
        reason: 'LOCKED',
        message: 'Too many incorrect attempts. Request a new verification code.'
      };
    }
    store.put(otpKey, JSON.stringify(state), HRMS.AUTH_LIMITS.OTP_TTL_SEC);
    return { ok: false, reason: 'INVALID', message: 'Incorrect verification code. Please try again.' };
  }

  store.remove(otpKey);

  var token = hrmsAuthGenerateToken_();
  var sessionPayload = { email: email, createdAt: now };
  store.put(hrmsAuthSessionKey_(token), JSON.stringify(sessionPayload), HRMS.AUTH_LIMITS.SESSION_TTL_SEC);

  return {
    ok: true,
    reason: 'VERIFIED',
    sessionToken: token,
    expiresInSeconds: HRMS.AUTH_LIMITS.SESSION_TTL_SEC
  };
}

/**
 * @param {string} token
 * @param {Object=} store
 * @return {string} email or ''
 */
function hrmsAuthSessionGetEmail_(token, store, memoryOnly) {
  token = String(token || '').trim();
  if (!token) return '';
  store = hrmsAuthCreateStoreAdapter_(store, memoryOnly === true);
  var raw = store.get(hrmsAuthSessionKey_(token));
  var data = hrmsAuthParseJson_(raw);
  if (!data || !data.email) return '';
  return hrmsAuthNormalizeEmail_(data.email);
}

/**
 * @param {string} token
 * @param {Object=} store
 * @return {boolean}
 */
function hrmsAuthSessionInvalidate_(token, store, memoryOnly) {
  token = String(token || '').trim();
  if (!token) return false;
  store = hrmsAuthCreateStoreAdapter_(store, memoryOnly === true);
  store.remove(hrmsAuthSessionKey_(token));
  return true;
}

var AuthSessionService = (function () {
  function findUserByEmail_(email) {
    return DbService.findOne(HRMS.SHEETS.USERS, { google_email: hrmsAuthNormalizeEmail_(email) });
  }

  function isDemoAllowed_(email) {
    if (!ConfigService.isDemoMode()) return false;
    return ConfigService.isDemoAllowlisted(email);
  }

  function sendOtpMail_(email, otp) {
    var company = 'AyurCentral HRMS';
    try {
      company = ConfigService.getCompanyName() || company;
    } catch (ignore) {}
    MailApp.sendEmail({
      to: email,
      subject: company + ' — sign-in verification code',
      body: 'Your HRMS verification code is: ' + otp + '\n\nThis code expires in 10 minutes and can be used once.\n\nIf you did not request this code, ignore this email.'
    });
  }

  function requestOtp(email) {
    // Serialize CacheService rate-limit / OTP RMW across concurrent requests.
    return withScriptLock_(function () {
      return hrmsAuthOtpRequest_(email, {
        findUser: findUserByEmail_,
        isDemoAllowed: isDemoAllowed_,
        sendMail: sendOtpMail_,
        store: null,
        now: Date.now()
      });
    }, 15000);
  }

  function verifyOtp(email, code) {
    return withScriptLock_(function () {
      return hrmsAuthOtpVerify_(email, code, {
        store: null,
        now: Date.now()
      });
    }, 15000);
  }

  function getEmailForSessionToken(token) {
    return hrmsAuthSessionGetEmail_(token, null);
  }

  function invalidateSession(token) {
    return hrmsAuthSessionInvalidate_(token, null);
  }

  function getRequestSessionToken() {
    return HRMS_REQUEST_SESSION_TOKEN_ || '';
  }

  return {
    requestOtp: requestOtp,
    verifyOtp: verifyOtp,
    getEmailForSessionToken: getEmailForSessionToken,
    invalidateSession: invalidateSession,
    getRequestSessionToken: getRequestSessionToken
  };
})();

/**
 * Editor-only: clear OTP and rate-limit ScriptCache state for an email.
 * Does not create or grant a session. Run from the Apps Script editor during development.
 * @param {string} email
 * @return {{cleared: boolean, email: string}}
 */
function devClearAuthOtpState(email) {
  var result = hrmsAuthClearOtpStateForEmail_(email, null, false);
  Logger.log('devClearAuthOtpState: ' + JSON.stringify(result));
  return result;
}
