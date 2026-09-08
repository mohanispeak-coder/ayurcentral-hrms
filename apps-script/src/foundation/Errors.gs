/**
 * Centralized error types for Apps Script — safe client responses.
 */
var HRMS = HRMS || {};

HRMS.ERROR_CODES = {
  VALIDATION: 'VALIDATION_ERROR',
  AUTHORIZATION: 'AUTHORIZATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  CONFIGURATION: 'CONFIGURATION_ERROR',
  CONFLICT: 'CONFLICT_ERROR',
  LOCK_TIMEOUT: 'LOCK_TIMEOUT',
  SYSTEM: 'SYSTEM_ERROR'
};

/**
 * @param {string} code
 * @param {string} message User-safe message.
 * @param {Object=} details Optional non-sensitive details.
 */
function hrmsError_(code, message, details) {
  var err = new Error(message);
  err.hrmsCode = code;
  err.hrmsDetails = details || null;
  return err;
}

function validationError_(message, details) {
  return hrmsError_(HRMS.ERROR_CODES.VALIDATION, message, details);
}

function authorizationError_(message) {
  return hrmsError_(HRMS.ERROR_CODES.AUTHORIZATION, message || 'You do not have permission to perform this action.');
}

function notFoundError_(message) {
  return hrmsError_(HRMS.ERROR_CODES.NOT_FOUND, message || 'The requested resource was not found.');
}

function configurationError_(message) {
  return hrmsError_(HRMS.ERROR_CODES.CONFIGURATION, message || 'The application is not configured correctly. Contact your administrator.');
}

function conflictError_(message) {
  return hrmsError_(HRMS.ERROR_CODES.CONFLICT, message || 'This action cannot be completed because of a conflict.');
}

function systemError_(message) {
  return hrmsError_(HRMS.ERROR_CODES.SYSTEM, message || 'An unexpected error occurred. Please try again.');
}

/**
 * Wrap server functions for google.script.run — returns { ok, data } or { ok, error }.
 * Clears request-scoped sheet caches at entry so warm containers cannot reuse stale rows.
 * @param {Function} fn
 * @param {string=} sessionToken Optional application session from OTP login.
 */
function hrmsRun_(fn, sessionToken) {
  var previousToken = typeof HRMS_REQUEST_SESSION_TOKEN_ !== 'undefined' ? HRMS_REQUEST_SESSION_TOKEN_ : '';
  var perfOn = typeof HrmsPerf !== 'undefined' && HrmsPerf.enabled();
  if (perfOn) {
    HrmsPerf.begin();
  }
  try {
    if (typeof DbService !== 'undefined' && DbService.clearRequestCache) {
      DbService.clearRequestCache();
    }
    if (typeof ConfigService !== 'undefined' && ConfigService.clearSpreadsheetRequestCache) {
      ConfigService.clearSpreadsheetRequestCache();
    }
    if (typeof AuthService !== 'undefined' && AuthService.clearRequestSessionCache) {
      AuthService.clearRequestSessionCache();
    }
    HRMS_REQUEST_SESSION_TOKEN_ = sessionToken || '';
    var data = fn();
    var envelope = { ok: true, data: data };
    if (perfOn) {
      var tSer = Date.now();
      try {
        JSON.stringify(data);
      } catch (ignoreSer) {}
      HrmsPerf.addStage('serialize', Date.now() - tSer);
      envelope._perf = HrmsPerf.end();
    }
    return envelope;
  } catch (e) {
    Logger.log('HRMS error: ' + e.message + '\n' + (e.stack || ''));
    var errBody;
    if (e.hrmsCode) {
      errBody = {
        ok: false,
        error: {
          code: e.hrmsCode,
          message: e.message,
          details: e.hrmsDetails || null
        }
      };
    } else {
      errBody = {
        ok: false,
        error: {
          code: HRMS.ERROR_CODES.SYSTEM,
          message: 'An unexpected error occurred. Please try again.',
          details: null
        }
      };
    }
    if (perfOn) {
      errBody._perf = HrmsPerf.end();
    }
    return errBody;
  } finally {
    HRMS_REQUEST_SESSION_TOKEN_ = previousToken;
  }
}
