/**
 * Editor-only Ask HR integration diagnostic.
 * Run testAskHrConfiguration() from the Apps Script editor.
 * Does not modify Script Properties, deploy, or log secrets.
 */
var ASK_HR_DIAG_QUESTION_ = 'What is the purpose of the employee handbook?';
var ASK_HR_DIAG_ACTOR_SALT_ = 'diag:ask-hr-config-test-v1';

function testAskHrConfiguration() {
  var startedMs = Date.now();
  var checks = [];
  var e2e = {};
  var config = { url: '', secret: '', scriptId: '' };

  function pushCheck(id, name, pass, detail, warn) {
    var status = pass ? 'PASS' : (warn ? 'WARN' : 'FAIL');
    checks.push({ id: id, name: name, status: status, detail: detail || '' });
    Logger.log(status + '  ' + name + (detail ? ' — ' + detail : ''));
    return pass;
  }

  function readProp(key) {
    try {
      return ConfigService.getScriptProperty(key);
    } catch (e) {
      return '';
    }
  }

  // 1. KH_WEBAPP_URL exists
  var hubUrlRaw = String(readProp(HRMS.PROPS.KH_WEBAPP_URL) || '').trim();
  pushCheck('kh_url_exists', 'KH_WEBAPP_URL exists', !!hubUrlRaw);

  // 2. KH_WEBAPP_URL is valid HTTPS Apps Script exec URL
  var hubUrlValid = !!hubUrlRaw && KnowledgeHubClient.isHttpsAppsScriptExecUrl(hubUrlRaw);
  pushCheck(
    'kh_url_valid',
    'KH_WEBAPP_URL is valid HTTPS Apps Script URL',
    hubUrlValid,
    hubUrlValid ? redactExecUrl_(hubUrlRaw) : 'Not a trusted script.google.com / script.googleusercontent.com URL'
  );

  // 3. KH_HMAC_SECRET exists
  var secretRaw = String(readProp(HRMS.PROPS.KH_HMAC_SECRET) || '').trim();
  pushCheck('kh_secret_exists', 'KH_HMAC_SECRET exists', !!secretRaw);

  // 4. HRMS Script ID
  var scriptId = '';
  try {
    scriptId = String(ScriptApp.getScriptId() || '').trim();
  } catch (e) {
    scriptId = '';
  }
  config.scriptId = scriptId;
  pushCheck('hrms_script_id', 'HRMS Script ID obtainable', !!scriptId, scriptId || 'ScriptApp.getScriptId() failed');

  // 5. Ask HR configuration/constants
  var constantsOk =
    HRMS &&
    HRMS.ASK_HR &&
    HRMS.ASK_HR.VERSION === '1' &&
    HRMS.PROPS.KH_WEBAPP_URL === 'KH_WEBAPP_URL' &&
    HRMS.PROPS.KH_HMAC_SECRET === 'KH_HMAC_SECRET';
  pushCheck('ask_hr_constants', 'Ask HR constants configured', constantsOk);

  // 6. KnowledgeHubClient functions
  var clientOk =
    KnowledgeHubClient &&
    typeof KnowledgeHubClient.readConfig === 'function' &&
    typeof KnowledgeHubClient.buildSignedRequest === 'function' &&
    typeof KnowledgeHubClient.submit === 'function' &&
    typeof KnowledgeHubClient.postJson === 'function' &&
    typeof KnowledgeHubClient.canonicalize === 'function';
  pushCheck('knowledge_hub_client', 'KnowledgeHubClient functions present', clientOk);

  // 7. apiAskHr exists
  pushCheck('api_ask_hr', 'apiAskHr exported', typeof apiAskHr === 'function');

  // 8. Session/auth path
  var authPathOk =
    typeof hrmsRun_ === 'function' &&
    typeof AuthService !== 'undefined' &&
    typeof AuthService.resolveSession === 'function';
  pushCheck('session_auth_path', 'Session/auth path exists', authPathOk);

  // 9. Permission/RBAC
  var rbacOk =
    typeof PermissionService !== 'undefined' &&
    typeof PermissionService.can === 'function' &&
    HRMS.ACTIONS.ASK_HR === 'ASK_HR';
  pushCheck('rbac_ask_hr', 'PermissionService ASK_HR RBAC', rbacOk);

  // 10. Question length validation
  var qShort = AskHrService.validateQuestion('hi');
  var qLong = AskHrService.validateQuestion(repeatCharDiag_('a', 1001));
  var qOk = AskHrService.validateQuestion(ASK_HR_DIAG_QUESTION_);
  pushCheck(
    'question_validation',
    'Question length validation',
    qShort.ok === false && qLong.ok === false && qOk.ok === true,
    'min=' + HRMS.ASK_HR.MIN_QUESTION_LEN + ' max=' + HRMS.ASK_HR.MAX_QUESTION_LEN
  );

  // 11. HMAC signing (golden self-test — values never logged)
  var goldenCanonical = KnowledgeHubClient.canonicalize({
    requestId: '11111111-2222-4333-8444-555555555555',
    timestamp: 1700000000,
    nonce: 'deadbeefcafebabe',
    actorId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    question: 'What is the leave notice period?'
  });
  var goldenSig = KnowledgeHubClient.hmacSha256Hex(goldenCanonical, 'ayurcentral-hrms-kh-golden-v1');
  var signingOk =
    goldenSig === 'eddeb0f02679a43090e65f523666768bfbdd1e4d371565a3bc6d2eeac9a932f4' &&
    /^[a-f0-9]{64}$/.test(goldenSig);
  pushCheck('hmac_signing', 'HMAC signing (golden vector)', signingOk);

  // 12. nonce / requestId / timestamp generation
  var nonce = KnowledgeHubClient.randomNonceHex();
  var requestId = Utilities.getUuid();
  var timestamp = Math.floor(Date.now() / 1000);
  var tokenOk =
    /^[a-f0-9]{32}$/.test(nonce) &&
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(requestId) &&
    timestamp > 0;
  pushCheck('request_tokens', 'nonce / requestId / timestamp valid', tokenOk);

  // 13. External request capability
  var fetchOk = typeof UrlFetchApp !== 'undefined' && typeof UrlFetchApp.fetch === 'function';
  pushCheck('url_fetch', 'UrlFetchApp external requests available', fetchOk);

  config.url = hubUrlRaw;
  config.secret = secretRaw;
  var cfg = KnowledgeHubClient.readConfig();
  if (!cfg.ok) {
    pushCheck('hub_config_ready', 'Knowledge Hub client config ready', false, cfg.code || 'NOT_CONFIGURED');
  } else {
    pushCheck('hub_config_ready', 'Knowledge Hub client config ready', true, redactExecUrl_(cfg.url));
  }

  // 14–19. Live signed POST (one attempt, no Gemini retry)
  var live = runAskHrDiagnosticLivePost_(cfg, scriptId, secretRaw, hubUrlRaw);
  checks = checks.concat(live.checks);
  e2e = live.e2e;

  var elapsedMs = Date.now() - startedMs;
  pushCheck('execution_time', 'Total execution time recorded', true, elapsedMs + ' ms');

  printAskHrDiagnosticSummary_(checks, e2e, elapsedMs);

  var failed = checks.filter(function (c) { return c.status === 'FAIL'; });
  var warnings = checks.filter(function (c) { return c.status === 'WARN'; });
  return {
    ok: failed.length === 0,
    failed: failed.length,
    warnings: warnings.length,
    checks: checks,
    e2e: e2e,
    elapsedMs: elapsedMs
  };
}

function runAskHrDiagnosticLivePost_(cfg, scriptId, secret, hubUrl) {
  var checks = [];
  var e2e = {
    question: ASK_HR_DIAG_QUESTION_,
    answerPreview: '',
    referenceCount: 0,
    failureCategory: '',
    httpStatus: 0,
    redirectFollowed: false
  };

  function push(name, pass, detail, warn) {
    var status = pass ? 'PASS' : (warn ? 'WARN' : 'FAIL');
    checks.push({ name: name, status: status, detail: detail || '' });
    Logger.log(status + '  ' + name + (detail ? ' — ' + detail : ''));
    return pass;
  }

  if (!cfg.ok || !scriptId || !secret || !hubUrl) {
    e2e.failureCategory = 'CONFIG_MISSING';
    push('Hub URL reachable', false, 'Skipped — configuration incomplete');
    push('Live signed POST', false, 'Skipped — configuration incomplete');
    push('Hub JSON response', false, 'Skipped');
    push('Response contract', false, 'Skipped');
    push('Response sanitization', false, 'Skipped');
    return { checks: checks, e2e: e2e };
  }

  var requestId = Utilities.getUuid();
  var actorId = KnowledgeHubClient.hmacSha256Hex(ASK_HR_DIAG_ACTOR_SALT_ + ':' + requestId, secret);
  var nonce = KnowledgeHubClient.randomNonceHex();
  var timestamp = Math.floor(Date.now() / 1000);
  var built = KnowledgeHubClient.buildSignedRequest({
    iss: scriptId,
    requestId: requestId,
    timestamp: timestamp,
    nonce: nonce,
    actorId: actorId,
    question: ASK_HR_DIAG_QUESTION_,
    secret: secret
  });

  var transport = askHrDiagnosticPostJson_(hubUrl, built.request);
  e2e.httpStatus = transport.httpCode || 0;
  e2e.redirectFollowed = transport.redirectFollowed === true;

  if (transport.fetchFailed) {
    e2e.failureCategory = 'HUB_UNREACHABLE';
    push('Hub URL reachable', false, 'UrlFetchApp.fetch threw');
    push('Live signed POST', false, e2e.failureCategory);
    return { checks: checks, e2e: e2e };
  }

  push(
    'Hub URL reachable',
    transport.httpCode >= 200 && transport.httpCode < 300,
    'HTTP ' + (transport.httpCode || 0) + (e2e.redirectFollowed ? ' (302 GET follow)' : '')
  );

  if (transport.httpCode === 429) {
    e2e.failureCategory = 'HUB_RATE_LIMITED';
  } else if (transport.httpCode < 200 || transport.httpCode >= 300) {
    e2e.failureCategory = transport.httpCode ? 'HTTP_ERROR' : 'HUB_UNREACHABLE';
  }

  var parsed = transport.parsed;
  if (!parsed && transport.httpCode >= 200 && transport.httpCode < 300) {
    e2e.failureCategory = e2e.failureCategory || 'INVALID_RESPONSE';
  }

  push('Live signed POST', !!parsed || transport.httpCode > 0, e2e.failureCategory || 'completed');

  if (!parsed) {
    push('Hub JSON response', false, 'Body is not valid JSON');
    push('Response contract', false, 'Missing parsed payload');
    push('Response sanitization', false, 'Skipped');
    return { checks: checks, e2e: e2e };
  }

  push('Hub JSON response', true, 'Parsed JSON object');

  var contractOk =
    parsed.version != null &&
    parsed.requestId != null &&
    (parsed.ok === true || parsed.ok === false);
  push(
    'Response contract (ok/version/requestId)',
    contractOk,
    contractOk ? 'version=' + String(parsed.version) : 'Missing required fields'
  );

  if (parsed.ok !== true) {
    e2e.failureCategory = classifyAskHrHubFailure_(transport.httpCode, parsed);
    push('End-to-end answer', false, e2e.failureCategory);
    return { checks: checks, e2e: e2e };
  }

  var sanitized = KnowledgeHubClient.sanitizeSuccess(parsed, requestId);
  var answerOk = typeof sanitized.answer === 'string';
  var refsOk = sanitized.references && typeof sanitized.references.length === 'number';
  push('Answer/references parsed', answerOk && refsOk, 'references=' + (sanitized.references ? sanitized.references.length : 0));

  var leakFree = !askHrDiagnosticPayloadLeaksSecrets_(parsed, secret);
  push('No secrets in Hub payload', leakFree, leakFree ? 'Clean' : 'Sensitive pattern detected');

  e2e.answerPreview = previewAskHrDiagText_(sanitized.answer, 200);
  e2e.referenceCount = sanitized.references ? sanitized.references.length : 0;
  e2e.failureCategory = '';

  push('End-to-end answer', answerOk, e2e.answerPreview ? 'Answer received' : 'Empty answer (WARN if notFound)');
  return { checks: checks, e2e: e2e };
}

/**
 * Uses KnowledgeHubClient.postJson when available (validated 302 GET follow).
 * @param {string} url
 * @param {Object} body
 * @return {{ httpCode: number, parsed: Object|null, fetchFailed: boolean, redirectFollowed: boolean }}
 */
function askHrDiagnosticPostJson_(url, body) {
  if (KnowledgeHubClient && typeof KnowledgeHubClient.postJson === 'function') {
    var calls = [];
    var fetchFn = function (fetchUrl, options) {
      calls.push({ url: fetchUrl, method: options && options.method });
      return UrlFetchApp.fetch(fetchUrl, options);
    };
    var result = KnowledgeHubClient.postJson(url, body, { fetch: fetchFn });
    var httpCode = 0;
    if (result.ok) {
      httpCode = 200;
    } else if (result.errorCode === 'RATE_LIMITED') {
      httpCode = 429;
    } else {
      httpCode = calls.length ? inferHttpCodeFromFetch_(calls, result) : 0;
    }
    return {
      httpCode: httpCode,
      parsed: result.parsed,
      fetchFailed: false,
      redirectFollowed: calls.length > 1
    };
  }

  try {
    var response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
      followRedirects: false
    });
    return {
      httpCode: response.getResponseCode(),
      parsed: parseAskHrDiagJson_(response.getContentText()),
      fetchFailed: false,
      redirectFollowed: false
    };
  } catch (e) {
    return { httpCode: 0, parsed: null, fetchFailed: true, redirectFollowed: false };
  }
}

function inferHttpCodeFromFetch_(calls, result) {
  if (!result.parsed && calls.length) {
    return 502;
  }
  return result.errorCode === 'UPSTREAM' ? 502 : 200;
}

function classifyAskHrHubFailure_(httpCode, parsed) {
  if (parsed && parsed.error && parsed.error.code) {
    var code = String(parsed.error.code).toUpperCase();
    if (code === 'UNAUTHORIZED' || code === 'INVALID_SIGNATURE') return 'HMAC_FAILURE';
    if (code === 'EXPIRED') return 'HUB_EXPIRED';
    if (code === 'REPLAY') return 'HUB_REPLAY';
    if (code === 'VALIDATION') return 'HUB_VALIDATION';
    if (code === 'RATE_LIMITED') return 'HUB_RATE_LIMITED';
    if (code === 'NOT_CONFIGURED') return 'HUB_NOT_CONFIGURED';
    if (code === 'NOT_FOUND') return 'HUB_NOT_FOUND';
    if (code === 'TIMEOUT') return 'HUB_TIMEOUT';
    if (code === 'UPSTREAM') return 'HUB_UPSTREAM';
  }
  if (httpCode === 429) return 'HUB_RATE_LIMITED';
  if (httpCode >= 500) return 'HUB_UPSTREAM';
  if (httpCode >= 400 && httpCode < 500) return 'HTTP_ERROR';
  if (!parsed) return 'INVALID_RESPONSE';
  return 'UNKNOWN';
}

function askHrDiagnosticPayloadLeaksSecrets_(parsed, secret) {
  var json = JSON.stringify(parsed || {});
  if (secret && json.indexOf(secret) >= 0) return true;
  if (/aiza[0-9a-z_-]{20,}/i.test(json)) return true;
  if (/-----BEGIN [A-Z ]+ KEY-----/.test(json)) return true;
  if (parsed && parsed.signature && String(parsed.signature).length === 64) return false;
  return false;
}

function parseAskHrDiagJson_(text) {
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

function redactExecUrl_(url) {
  url = String(url || '').trim();
  var m = url.match(/^(https:\/\/[^/?#]+)(\/[^?#]*)?/i);
  if (!m) return '[invalid-url]';
  return m[1] + (m[2] || '');
}

function previewAskHrDiagText_(text, maxLen) {
  maxLen = maxLen || 200;
  var s = String(text == null ? '' : text)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > maxLen) s = s.substring(0, maxLen) + '…';
  return s;
}

function repeatCharDiag_(ch, n) {
  var s = '';
  var i;
  for (i = 0; i < n; i++) s += ch;
  return s;
}

function printAskHrDiagnosticSummary_(checks, e2e, elapsedMs) {
  function row(label, pass, reason) {
    var status = pass ? 'PASS' : 'FAIL';
    Logger.log(padAskHrDiagLabel_(label, 20) + status + (reason && !pass ? ' — ' + reason : ''));
  }

  var cfgPass = !findCheckFail_(checks, ['kh_url_exists', 'kh_secret_exists', 'hub_config_ready', 'ask_hr_constants']);
  var urlPass = !findCheckFail_(checks, ['kh_url_valid', 'kh_url_exists']);
  var hmacPass = !findCheckFail_(checks, ['kh_secret_exists', 'hmac_signing', 'knowledge_hub_client']);
  var issPass = !findCheckFail_(checks, ['hrms_script_id']);
  var signingPass = !findCheckFail_(checks, ['hmac_signing', 'request_tokens']);
  var connPass = !findCheckFail_(checks, ['Hub URL reachable']);
  var authPass = e2e.failureCategory !== 'HMAC_FAILURE' && e2e.failureCategory !== 'HUB_UNAUTHORIZED';
  var jsonPass = !findCheckFail_(checks, ['Hub JSON response', 'Response contract (ok/version/requestId)']);
  var e2ePass =
    !e2e.failureCategory &&
    !findCheckFail_(checks, ['End-to-end answer', 'Answer/references parsed', 'No secrets in Hub payload']);

  Logger.log('========================================');
  Logger.log('ASK HR END-TO-END TEST');
  Logger.log('========================================');
  row('HRMS CONFIG', cfgPass);
  row('HUB URL', urlPass);
  row('HMAC CONFIG', hmacPass);
  row('ISS CONFIG', issPass);
  row('KB FOLDER', e2ePass || e2e.referenceCount > 0, e2e.failureCategory === 'HUB_NOT_CONFIGURED' ? 'Hub NOT_CONFIGURED' : '');
  row('GEMINI CONFIG', e2ePass || !!e2e.answerPreview, e2e.failureCategory === 'HUB_NOT_CONFIGURED' ? 'Hub NOT_CONFIGURED' : '');
  row('HMAC SIGNING', signingPass);
  row('HUB CONNECTION', connPass, e2e.failureCategory === 'HUB_UNREACHABLE' ? 'Hub unreachable' : '');
  row('HUB AUTHENTICATION', authPass, e2e.failureCategory === 'HMAC_FAILURE' ? 'HMAC/signature rejected' : '');
  row('DRIVE SEARCH', e2e.referenceCount > 0 || !!e2e.answerPreview, '');
  row('GEMINI', !!e2e.answerPreview, e2e.failureCategory || '');
  row('JSON RESPONSE', jsonPass);
  row('END-TO-END', e2ePass, e2e.failureCategory || '');

  Logger.log('');
  Logger.log('Question:');
  Logger.log('"' + ASK_HR_DIAG_QUESTION_ + '"');
  Logger.log('');
  Logger.log('Answer received:');
  Logger.log(e2e.answerPreview ? e2e.answerPreview : (e2e.failureCategory ? '[none — ' + e2e.failureCategory + ']' : '[none]'));
  Logger.log('');
  Logger.log('References:');
  Logger.log(String(e2e.referenceCount != null ? e2e.referenceCount : 0));
  Logger.log('');
  Logger.log('Execution time:');
  Logger.log(elapsedMs + ' ms');
  Logger.log('========================================');

  if (e2e.failureCategory) {
    Logger.log('');
    Logger.log('FAIL: ' + mapE2eFailureLabel_(e2e.failureCategory));
    Logger.log('Reason: ' + describeAskHrFailureReason_(e2e.failureCategory, checks));
  }
}

function findCheckFail_(checks, ids) {
  var i;
  var j;
  for (i = 0; i < checks.length; i++) {
    for (j = 0; j < ids.length; j++) {
      if ((checks[i].id === ids[j] || checks[i].name === ids[j]) && checks[i].status === 'FAIL') {
        return true;
      }
    }
  }
  return false;
}

function padAskHrDiagLabel_(label, width) {
  label = String(label || '');
  while (label.length < width) label += ' ';
  return label;
}

function mapE2eFailureLabel_(category) {
  if (category === 'CONFIG_MISSING') return 'HRMS CONFIG';
  if (category === 'HMAC_FAILURE') return 'HUB AUTHENTICATION';
  if (category === 'HUB_NOT_CONFIGURED') return 'GEMINI CONFIG';
  if (category === 'HUB_UNREACHABLE') return 'HUB CONNECTION';
  if (category === 'INVALID_RESPONSE') return 'JSON RESPONSE';
  if (category === 'HUB_RATE_LIMITED') return 'HUB RATE LIMIT';
  return category.replace(/_/g, ' ');
}

function describeAskHrFailureReason_(category, checks) {
  if (category === 'CONFIG_MISSING') {
    if (findCheckFail_(checks, ['kh_url_exists'])) return 'KH_WEBAPP_URL Script Property is missing.';
    if (findCheckFail_(checks, ['kh_secret_exists'])) return 'KH_HMAC_SECRET Script Property is missing.';
    return 'Ask HR Script Properties or client config is incomplete.';
  }
  if (category === 'HMAC_FAILURE') {
    return 'Knowledge Hub rejected the HMAC signature or issuer. Verify KH_HMAC_SECRET matches HRMS_HMAC_SECRET and HRMS_ISS matches this project Script ID.';
  }
  if (category === 'HUB_NOT_CONFIGURED') {
    return 'Knowledge Hub returned NOT_CONFIGURED (KB folder and/or Gemini API key on Hub).';
  }
  if (category === 'HUB_UNREACHABLE') {
    return 'Could not reach KH_WEBAPP_URL via UrlFetchApp.';
  }
  if (category === 'INVALID_RESPONSE') {
    return 'Hub did not return valid JSON.';
  }
  if (category === 'HUB_RATE_LIMITED') {
    return 'Hub rate limit exceeded for diagnostic actor.';
  }
  if (category === 'HTTP_ERROR') {
    return 'Hub returned a non-success HTTP status.';
  }
  return 'Live Ask HR request failed (' + category + ').';
}
