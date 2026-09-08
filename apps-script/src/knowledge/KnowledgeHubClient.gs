/**
 * Server-side Knowledge Hub client.
 * Browser never sees KH_WEBAPP_URL, HMAC secret, spreadsheet ID, or Drive IDs.
 * Hub receives only: version, iss, requestId, timestamp, nonce, actorId, question, signature.
 */
var HRMS = HRMS || {};

var KnowledgeHubClient = (function () {
  var USER_MSG_ = {
    NOT_CONFIGURED: 'Ask HR is not configured yet. Contact your administrator.',
    UPSTREAM: 'Unable to search the HR knowledge base right now. Please try again.',
    RETRIEVAL_FAILED: 'Unable to search the HR knowledge base right now. Please try again.',
    GENERATION_FAILED: 'I found the relevant HR information, but I\'m unable to generate the answer right now. Please try again.',
    NO_SUPPORTED_INFORMATION: 'I couldn\'t find enough information in the HR knowledge base to answer this confidently.',
    RESPONSE_PARSE_FAILED: 'I found the relevant HR information, but I\'m unable to generate the answer right now. Please try again.',
    RATE_LIMITED: 'You have asked too many questions. Please wait a few minutes and try again.',
    VALIDATION: 'Please enter a question between 3 and 1000 characters.',
    UNAUTHORIZED: 'You do not have permission to use Ask HR. Please sign in and try again.',
    NOT_FOUND: 'I couldn\'t find enough information in the HR knowledge base to answer this confidently.',
    TIMEOUT: 'Ask HR took too long to respond. Please try again.',
    REPLAY: 'This request could not be completed. Please try again.'
  };

  var HUB_CODE_MAP_ = {
    RATE_LIMITED: 'RATE_LIMITED',
    VALIDATION: 'VALIDATION',
    VALIDATION_ERROR: 'VALIDATION',
    NOT_FOUND: 'NOT_FOUND',
    TIMEOUT: 'TIMEOUT',
    REPLAY: 'REPLAY',
    UPSTREAM: 'UPSTREAM',
    RETRIEVAL_FAILED: 'RETRIEVAL_FAILED',
    GENERATION_FAILED: 'GENERATION_FAILED',
    NO_SUPPORTED_INFORMATION: 'NOT_FOUND',
    RESPONSE_PARSE_FAILED: 'GENERATION_FAILED',
    INVALID_SIGNATURE: 'UPSTREAM',
    UNAUTHORIZED: 'UPSTREAM',
    FORBIDDEN: 'UPSTREAM',
    NOT_CONFIGURED: 'UPSTREAM',
    SYSTEM: 'UPSTREAM',
    SYSTEM_ERROR: 'UPSTREAM'
  };

  var CLIENT_CODES_ = {
    NOT_CONFIGURED: true,
    UNAUTHORIZED: true,
    VALIDATION: true,
    RATE_LIMITED: true,
    UPSTREAM: true,
    RETRIEVAL_FAILED: true,
    GENERATION_FAILED: true,
    NOT_FOUND: true,
    TIMEOUT: true,
    REPLAY: true
  };

  function userMessage_(code) {
    return USER_MSG_[code] || USER_MSG_.UPSTREAM;
  }

  function errorResult_(requestId, code) {
    var safe = String(code || 'UPSTREAM');
    if (!CLIENT_CODES_[safe]) safe = 'UPSTREAM';
    return {
      ok: false,
      version: HRMS.ASK_HR.VERSION,
      requestId: String(requestId || ''),
      error: {
        code: safe,
        message: userMessage_(safe)
      }
    };
  }

  /**
   * Convert HMAC/digest bytes to lowercase hex (Apps Script bytes may be signed).
   * @param {Array.<number>|Object} bytes
   * @return {string}
   */
  function bytesToHex_(bytes) {
    if (!bytes || bytes.length == null) return '';
    var hex = '';
    var i;
    var b;
    var s;
    for (i = 0; i < bytes.length; i++) {
      b = bytes[i];
      if (b < 0) b += 256;
      s = b.toString(16);
      if (s.length < 2) s = '0' + s;
      hex += s;
    }
    return hex;
  }

  function hmacSha256Hex_(value, secret) {
    var raw = Utilities.computeHmacSha256Signature(
      String(value),
      String(secret),
      Utilities.Charset.UTF_8
    );
    return bytesToHex_(raw);
  }

  /**
   * Canonical string EXACTLY (UTF-8):
   * v1\n{requestId}\n{timestampSeconds}\n{nonce}\n{actorId}\n{question}
   * Knowledge-only HMAC v1 (no mode/context).
   * @param {Object} parts
   * @return {string}
   */
  function canonicalize_(parts) {
    parts = parts || {};
    return [
      'v1',
      String(parts.requestId),
      String(parts.timestamp),
      String(parts.nonce),
      String(parts.actorId),
      String(parts.question)
    ].join('\n');
  }

  function actorIdForEmployee_(employeeId, secret) {
    return hmacSha256Hex_('actor:' + String(employeeId), secret);
  }

  function actorIdForDemo_(email, secret) {
    return hmacSha256Hex_('demo:' + String(email || '').trim().toLowerCase(), secret);
  }

  /**
   * Opaque actorId. Never email, employee_id, or role.
   * @param {Object} session
   * @param {string} secret
   * @return {string} 64-char hex or ''
   */
  function actorIdForSession_(session, secret) {
    session = session || {};
    if (session.employee_id) {
      return actorIdForEmployee_(session.employee_id, secret);
    }
    if (session.demo && session.email) {
      return actorIdForDemo_(session.email, secret);
    }
    return '';
  }

  function randomNonceHex_() {
    var digest = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      Utilities.getUuid() + ':' + Utilities.getUuid() + ':' + String(Date.now())
    );
    return bytesToHex_(digest).substring(0, HRMS.ASK_HR.NONCE_HEX_LEN);
  }

  function getHeaderCaseInsensitive_(headers, name) {
    if (!headers) return '';
    var want = String(name).toLowerCase();
    if (headers[name] != null) return headers[name];
    var key;
    for (key in headers) {
      if (headers.hasOwnProperty(key) && String(key).toLowerCase() === want) {
        return headers[key];
      }
    }
    return '';
  }

  function firstHeaderValue_(value) {
    if (value == null) return '';
    if (Object.prototype.toString.call(value) === '[object Array]') {
      return value.length ? String(value[0] || '') : '';
    }
    return String(value);
  }

  /**
   * Parse https URLs without relying solely on the URL constructor — Apps Script
   * runtimes may not expose URL or may reject otherwise valid exec URLs.
   * @param {string} url
   * @return {{protocol: string, hostname: string, pathname: string, href: string, username: string, password: string}|null}
   */
  function parseHttpsUrlFallback_(url) {
    var m = url.match(/^https:\/\/(?:([^/@?#]+@))?([^/?#]+)(\/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$/i);
    if (!m || m[1]) return null;
    var host = String(m[2] || '').toLowerCase();
    if (!host) return null;
    return {
      protocol: 'https:',
      hostname: host,
      pathname: m[3] || '',
      href: url,
      username: '',
      password: ''
    };
  }

  function parseHttpsUrl_(url) {
    url = String(url || '').trim();
    if (!url) return null;
    if (/[\x00-\x1F\x7F]/.test(url)) return null;
    if (/^(javascript|data|file|vbscript|blob):/i.test(url)) return null;

    var parsed = null;
    if (typeof URL !== 'undefined') {
      try {
        parsed = new URL(url);
        if (parsed.protocol !== 'https:') return null;
        if (parsed.username || parsed.password) return null;
        return parsed;
      } catch (e) {
        parsed = null;
      }
    }
    return parseHttpsUrlFallback_(url);
  }

  function hostAllowedExactOrSuffix_(host, exact, suffix) {
    host = String(host || '').toLowerCase();
    if (host === exact) return true;
    return suffix && host.length > suffix.length && host.substring(host.length - suffix.length) === suffix;
  }

  /**
   * Apps Script execution URL only (KH_WEBAPP_URL and 302 Location).
   * @param {string} url
   * @return {boolean}
   */
  function isHttpsAppsScriptExecUrl_(url) {
    var parsed = parseHttpsUrl_(url);
    if (!parsed) return false;
    var host = String(parsed.hostname || '').toLowerCase();
    if (host === 'script.google.com') {
      var path = String(parsed.pathname || '');
      return path.indexOf('/macros/') === 0 || path.indexOf('/a/') === 0;
    }
    if (host === 'script.googleusercontent.com') return true;
    if (hostAllowedExactOrSuffix_(host, '', '.script.googleusercontent.com')) return true;
    return false;
  }

  /**
   * Knowledge reference URLs — Drive/Docs only.
   * @param {string} url
   * @return {boolean}
   */
  function isAllowedReferenceUrl_(url) {
    var parsed = parseHttpsUrl_(url);
    if (!parsed) return false;
    var host = String(parsed.hostname || '').toLowerCase();
    return host === 'drive.google.com' || host === 'docs.google.com';
  }

  function stripHtml_(value) {
    return String(value == null ? '' : value).replace(/<[^>]*>/g, '');
  }

  function sanitizePlain_(value, maxLen) {
    var s = stripHtml_(value);
    s = s.replace(/[<>"'`]/g, '');
    s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    s = s.replace(/\s+/g, ' ').trim();
    if (s.length > maxLen) s = s.substring(0, maxLen);
    return s;
  }

  function sanitizeAnswer_(answer) {
    if (answer == null) return '';
    if (typeof answer !== 'string') {
      if (typeof answer === 'number' || typeof answer === 'boolean') {
        answer = String(answer);
      } else {
        return '';
      }
    }
    answer = answer.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    answer = stripHtml_(answer);
    answer = answer.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    if (answer.length > HRMS.ASK_HR.ANSWER_MAX_CHARS) {
      answer = answer.substring(0, HRMS.ASK_HR.ANSWER_MAX_CHARS);
    }
    return answer;
  }

  function sanitizeKeyPoints_(raw) {
    if (!raw || Object.prototype.toString.call(raw) !== '[object Array]') return [];
    var out = [];
    var i;
    for (i = 0; i < raw.length && out.length < HRMS.ASK_HR.KEYPOINT_MAX; i++) {
      if (typeof raw[i] !== 'string' && typeof raw[i] !== 'number') continue;
      var item = sanitizePlain_(raw[i], HRMS.ASK_HR.KEYPOINT_MAX_CHARS);
      if (item) out.push(item);
    }
    return out;
  }

  function sanitizeReferences_(raw) {
    if (!raw || Object.prototype.toString.call(raw) !== '[object Array]') return [];
    var out = [];
    var i;
    for (i = 0; i < raw.length && out.length < HRMS.ASK_HR.REF_MAX; i++) {
      var ref = raw[i];
      if (!ref || typeof ref !== 'object') continue;
      var url = String(ref.fileUrl || ref.url || ref.link || '').trim();
      if (!isAllowedReferenceUrl_(url)) continue;
      var fileName = sanitizePlain_(
        ref.fileName || ref.filename || ref.title || '',
        HRMS.ASK_HR.FILENAME_MAX_CHARS
      );
      out.push({ url: url, fileName: fileName });
    }
    return out;
  }

  function toBool_(value) {
    return value === true || value === 1 || value === 'true' || value === 'TRUE';
  }

  function sanitizeExecutionMs_(value) {
    var n = Number(value);
    if (!isFinite(n) || n < 0) return 0;
    n = Math.floor(n);
    if (n > 600000) n = 600000;
    return n;
  }

  function isRedirectCode_(code) {
    return code === 301 || code === 302 || code === 303 || code === 307 || code === 308;
  }

  function readLocation_(response) {
    var headers = {};
    try {
      headers = response.getAllHeaders ? response.getAllHeaders() : response.getHeaders();
    } catch (e) {
      try {
        headers = response.getHeaders();
      } catch (e2) {
        return '';
      }
    }
    return firstHeaderValue_(getHeaderCaseInsensitive_(headers, 'Location')).trim();
  }

  function defaultFetch_(url, options) {
    return UrlFetchApp.fetch(url, options);
  }

  /**
   * @param {Object=} deps { getScriptProperty }
   * @return {{ok: boolean, url: string, secret: string, code: string}}
   */
  function readConfig_(deps) {
    deps = deps || {};
    var getProp = deps.getScriptProperty || function (key) {
      return ConfigService.getScriptProperty(key);
    };
    var url = String(getProp(HRMS.PROPS.KH_WEBAPP_URL) || '').trim();
    var secret = String(getProp(HRMS.PROPS.KH_HMAC_SECRET) || '').trim();
    if (!url || !secret) {
      Logger.log('Ask HR not configured: missing KH_WEBAPP_URL or KH_HMAC_SECRET');
      return { ok: false, url: '', secret: '', code: 'NOT_CONFIGURED' };
    }
    if (!isHttpsAppsScriptExecUrl_(url)) {
      Logger.log('Ask HR not configured: KH_WEBAPP_URL is not a trusted Apps Script URL');
      return { ok: false, url: '', secret: '', code: 'NOT_CONFIGURED' };
    }
    return { ok: true, url: url, secret: secret, code: '' };
  }

  /**
   * Outbound JSON: version, iss, requestId, timestamp, nonce, actorId, question, signature.
   * Knowledge-only — never sends mode, context, or live HRMS records.
   * @param {Object} params
   * @return {{request: Object, canonical: string}}
   */
  function buildSignedRequest_(params) {
    params = params || {};
    var canonical = canonicalize_({
      requestId: params.requestId,
      timestamp: params.timestamp,
      nonce: params.nonce,
      actorId: params.actorId,
      question: params.question
    });
    var request = {
      version: HRMS.ASK_HR.VERSION,
      iss: String(params.iss || ''),
      requestId: String(params.requestId),
      timestamp: Number(params.timestamp),
      nonce: String(params.nonce),
      actorId: String(params.actorId),
      question: String(params.question),
      signature: hmacSha256Hex_(canonical, params.secret)
    };
    return { request: request, canonical: canonical };
  }

  function mapHubError_(parsed, requestId) {
    var code = '';
    if (parsed && parsed.error && typeof parsed.error === 'object') {
      code = String(parsed.error.code || '').trim().toUpperCase();
    } else if (parsed && typeof parsed.error === 'string') {
      code = parsed.error.trim().toUpperCase();
    } else if (parsed && parsed.code) {
      code = String(parsed.code).trim().toUpperCase();
    }
    var mapped = HUB_CODE_MAP_[code] || 'UPSTREAM';
    return errorResult_(requestId, mapped);
  }

  /**
   * Allowlisted Hub success payload only.
   * @param {Object} parsed
   * @param {string} requestId
   * @return {Object}
   */
  function sanitizeSuccess_(parsed, requestId) {
    parsed = parsed || {};
    var out = {
      ok: true,
      version: HRMS.ASK_HR.VERSION,
      requestId: String(requestId || ''),
      answer: sanitizeAnswer_(parsed.answer),
      keyPoints: sanitizeKeyPoints_(parsed.keyPoints),
      references: sanitizeReferences_(parsed.references),
      notFound: toBool_(parsed.notFound),
      executionMs: sanitizeExecutionMs_(parsed.executionMs)
    };
    return out;
  }

  function parseJsonObject_(text) {
    if (!text) return null;
    try {
      var parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Object.prototype.toString.call(parsed) === '[object Array]') {
        return null;
      }
      return parsed;
    } catch (e) {
      return null;
    }
  }

  /**
   * POST JSON. Follow one Apps Script 302/303/307/308 with GET to the echo URL.
   * The first POST already runs Hub doPost (HMAC/nonce consumed). Re-POSTing the
   * Location returns 405 and must not mint a new nonce/requestId.
   * @param {string} url
   * @param {Object} body
   * @param {Object=} deps { fetch }
   * @return {Object} { ok, parsed, errorCode }
   */
  function postJson_(url, body, deps) {
    deps = deps || {};
    var fetchFn = deps.fetch || defaultFetch_;
    var payload = JSON.stringify(body);
    var options = {
      method: 'post',
      contentType: 'application/json',
      payload: payload,
      muteHttpExceptions: true,
      followRedirects: false
    };

    var response;
    try {
      response = fetchFn(url, options);
    } catch (e) {
      Logger.log('Ask HR upstream fetch failed requestId=' + (body && body.requestId ? body.requestId : ''));
      return { ok: false, parsed: null, errorCode: 'UPSTREAM' };
    }

    var code = 0;
    try {
      code = response.getResponseCode();
    } catch (e) {
      return { ok: false, parsed: null, errorCode: 'UPSTREAM' };
    }

    if (isRedirectCode_(code)) {
      var location = readLocation_(response);
      if (!isHttpsAppsScriptExecUrl_(location)) {
        Logger.log('Ask HR refused unsafe redirect requestId=' + (body && body.requestId ? body.requestId : ''));
        return { ok: false, parsed: null, errorCode: 'UPSTREAM' };
      }
      try {
        response = fetchFn(location, {
          method: 'get',
          muteHttpExceptions: true,
          followRedirects: false
        });
        code = response.getResponseCode();
      } catch (e2) {
        return { ok: false, parsed: null, errorCode: 'UPSTREAM' };
      }
      if (isRedirectCode_(code)) {
        return { ok: false, parsed: null, errorCode: 'UPSTREAM' };
      }
    }

    if (code === 429) {
      return { ok: false, parsed: null, errorCode: 'RATE_LIMITED' };
    }
    if (code < 200 || code >= 300) {
      return { ok: false, parsed: null, errorCode: 'UPSTREAM' };
    }

    var text = '';
    try {
      text = response.getContentText() || '';
    } catch (e3) {
      return { ok: false, parsed: null, errorCode: 'UPSTREAM' };
    }

    var parsed = parseJsonObject_(text);
    if (!parsed) {
      return { ok: false, parsed: null, errorCode: 'UPSTREAM' };
    }
    return { ok: true, parsed: parsed, errorCode: '' };
  }

  /**
   * Sign, POST, sanitize. Never logs secret, raw bodies, or answers.
   * @param {Object} params signed request params including secret, url, iss
   * @param {Object=} deps
   * @return {Object} chatbot payload
   */
  function submit_(params, deps) {
    params = params || {};
    var built = buildSignedRequest_(params);
    var posted = postJson_(params.url, built.request, deps);
    if (!posted.ok) {
      return errorResult_(params.requestId, posted.errorCode || 'UPSTREAM');
    }
    var parsed = posted.parsed;
    if (parsed.ok === false || (parsed.error && parsed.ok !== true)) {
      return mapHubError_(parsed, params.requestId);
    }
    return sanitizeSuccess_(parsed, params.requestId);
  }

  return {
    bytesToHex: bytesToHex_,
    hmacSha256Hex: hmacSha256Hex_,
    canonicalize: canonicalize_,
    actorIdForEmployee: actorIdForEmployee_,
    actorIdForDemo: actorIdForDemo_,
    actorIdForSession: actorIdForSession_,
    randomNonceHex: randomNonceHex_,
    isHttpsAppsScriptExecUrl: isHttpsAppsScriptExecUrl_,
    isAllowedReferenceUrl: isAllowedReferenceUrl_,
    readConfig: readConfig_,
    buildSignedRequest: buildSignedRequest_,
    sanitizeSuccess: sanitizeSuccess_,
    mapHubError: mapHubError_,
    submit: submit_,
    /** Diagnostic-only: raw POST transport (302 GET follow). Not for browser use. */
    postJson: postJson_,
    userMessage: userMessage_,
    errorResult: errorResult_
  };
})();
