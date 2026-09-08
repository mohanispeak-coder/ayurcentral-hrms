/**
 * Ask HR / Knowledge Hub client tests — no live Gemini, no Hub deploy required.
 * Run testAskHr_All from the Apps Script editor.
 */

function testAskHr_All() {
  var results = [];
  function record(name, passed, detail) {
    results.push({ name: name, passed: passed, detail: detail || '' });
    Logger.log((passed ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ': ' + detail : ''));
  }

  var GOLDEN_SECRET = 'ayurcentral-hrms-kh-golden-v1';
  var GOLDEN_CANONICAL = [
    'v1',
    '11111111-2222-4333-8444-555555555555',
    '1700000000',
    'deadbeefcafebabe',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'What is the leave notice period?'
  ].join('\n');
  var GOLDEN_HMAC = 'eddeb0f02679a43090e65f523666768bfbdd1e4d371565a3bc6d2eeac9a932f4';
  var GOLDEN_ACTOR = '1772860fcf4b315ac1f8a0a0e44fcb6026a2dbfd5d04ebec58d946162e05399b';
  var GOLDEN_DEMO = 'a6ec3a9bafa72884b288815762dc5ce8301f7be8df62f21d5cb5e40657200faa';
  var HUB_URL = 'https://script.google.com/macros/s/AKfycbxAskHrTestExec/exec';
  var SCRIPT_ID = '1AskHrTestScriptId000000000000000000000';

  var empSession = {
    authorized: true,
    email: 'alice@client.com',
    employee_id: 'EMP001',
    role: HRMS.ROLES.EMPLOYEE,
    demo: false
  };
  var demoSession = {
    authorized: true,
    email: 'demo@example.com',
    employee_id: '',
    role: HRMS.ROLES.ADMIN,
    demo: true
  };
  var guestSession = {
    authorized: true,
    email: 'guest@client.com',
    employee_id: 'EMP999',
    role: 'GUEST',
    demo: false
  };
  var unauthSession = {
    authorized: false,
    email: '',
    employee_id: '',
    role: '',
    demo: false,
    message: 'Sign in with your registered email to continue.'
  };

  function memoryStore() {
    var mem = {};
    return {
      get: function (key) {
        return mem.hasOwnProperty(key) ? mem[key] : null;
      },
      put: function (key, value) {
        mem[key] = value;
      },
      remove: function (key) {
        delete mem[key];
      }
    };
  }

  function hubOkBody(overrides) {
    var body = {
      ok: true,
      version: '1',
      requestId: 'should-be-replaced',
      answer: 'Give at least 15 days notice before planned leave.',
      keyPoints: ['15 days notice'],
      references: [{ url: 'https://drive.google.com/file/d/abc123', fileName: 'Leave Policy.pdf' }],
      notFound: false,
      executionMs: 42,
      email: 'alice@client.com',
      employee_id: 'EMP001',
      actorId: 'should-not-leak',
      secret: GOLDEN_SECRET
    };
    var k;
    overrides = overrides || {};
    for (k in overrides) {
      if (overrides.hasOwnProperty(k)) body[k] = overrides[k];
    }
    return JSON.stringify(body);
  }

  function mockResponse(code, body, headers) {
    return {
      getResponseCode: function () { return code; },
      getContentText: function () { return body || ''; },
      getHeaders: function () { return headers || {}; },
      getAllHeaders: function () { return headers || {}; }
    };
  }

  function recordingFetch(handler) {
    var calls = [];
    var fn = function (url, options) {
      calls.push({ url: url, options: options });
      return handler(url, options, calls.length);
    };
    fn.calls = calls;
    return fn;
  }

  function successFetch() {
    return recordingFetch(function () {
      return mockResponse(200, hubOkBody());
    });
  }

  function baseDeps(session, extras) {
    extras = extras || {};
    var store = extras.store || memoryStore();
    var fetch = extras.fetch || successFetch();
    var audits = extras.audits || [];
    return {
      session: session,
      store: store,
      fetch: fetch,
      now: extras.now != null ? extras.now : 1700000000000,
      timestamp: extras.timestamp != null ? extras.timestamp : 1700000000,
      uuid: extras.uuid || function () { return '11111111-2222-4333-8444-555555555555'; },
      nonce: extras.nonce || 'deadbeefcafebabe',
      getScriptId: extras.getScriptId || function () { return SCRIPT_ID; },
      getScriptProperty: extras.getScriptProperty || function (key) {
        if (key === HRMS.PROPS.KH_WEBAPP_URL) return HUB_URL;
        if (key === HRMS.PROPS.KH_HMAC_SECRET) return GOLDEN_SECRET;
        return '';
      },
      auditLog: extras.auditLog || function (action, entityType, entityId, summary, employeeId) {
        audits.push({
          action: action,
          entityType: entityType,
          entityId: entityId,
          summary: summary,
          employeeId: employeeId
        });
      },
      audits: audits
    };
  }

  function lastPayload(fetchFn) {
    if (!fetchFn.calls || !fetchFn.calls.length) return null;
    var raw = fetchFn.calls[fetchFn.calls.length - 1].options.payload;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  record('apiAskHrExported', typeof apiAskHr === 'function');
  record('askHrActionDefined', HRMS.ACTIONS.ASK_HR === 'ASK_HR');
  record('khPropsNamed',
    HRMS.PROPS.KH_WEBAPP_URL === 'KH_WEBAPP_URL' && HRMS.PROPS.KH_HMAC_SECRET === 'KH_HMAC_SECRET');
  record('hubTestUrlTrusted', KnowledgeHubClient.isHttpsAppsScriptExecUrl(HUB_URL) === true, HUB_URL);
  record('referenceUrlParserWorks',
    KnowledgeHubClient.isAllowedReferenceUrl('https://drive.google.com/file/d/abc') === true);
  record('noAskHrOrchestrator', typeof AskHrOrchestrator === 'undefined');
  record('noAskHrRouter', typeof AskHrRouter === 'undefined');
  record('noAskHrDataService', typeof AskHrDataService === 'undefined');
  record('knowledgeClientHasNoMode', KnowledgeHubClient.MODE === undefined);

  record('employeeMayAskHr', PermissionService.can(HRMS.ACTIONS.ASK_HR, {}, empSession) === true);
  record('accessAppGrantsAskHrV1',
    PermissionService.can(HRMS.ACTIONS.ACCESS_APP, {}, empSession) === true &&
    PermissionService.can(HRMS.ACTIONS.ASK_HR, {}, empSession) === true);

  var unauthDeps = baseDeps(unauthSession);
  var unauth = AskHrService.ask('What is the leave notice period?', unauthDeps);
  record('unauthenticatedDenied',
    unauth.ok === false && unauth.error && unauth.error.code === 'UNAUTHORIZED',
    unauth.error ? unauth.error.code : 'no-error');
  record('unauthenticatedNoHubCall', unauthDeps.fetch.calls.length === 0);

  var guestDeps = baseDeps(guestSession);
  var guest = AskHrService.ask('What is the leave notice period?', guestDeps);
  record('unauthorizedRoleDenied',
    guest.ok === false && guest.error && guest.error.code === 'UNAUTHORIZED',
    guest.error ? guest.error.code : 'no-error');
  record('unauthorizedRoleNoHubCall', guestDeps.fetch.calls.length === 0, 'calls=' + guestDeps.fetch.calls.length);

  var emptyDeps = baseDeps(empSession);
  var emptyQ = AskHrService.ask('  ', emptyDeps);
  record('emptyQuestionDenied',
    emptyQ.ok === false && emptyQ.error && emptyQ.error.code === 'VALIDATION',
    emptyQ.error ? emptyQ.error.code : 'no-error');
  record('emptyQuestionNoHubCall', emptyDeps.fetch.calls.length === 0);

  var shortQ = AskHrService.ask('hi', baseDeps(empSession));
  record('shortQuestionDenied',
    shortQ.ok === false && shortQ.error.code === 'VALIDATION');

  function repeatChar_(ch, n) {
    var s = '';
    var j;
    for (j = 0; j < n; j++) s += ch;
    return s;
  }

  var longQ = AskHrService.ask(repeatChar_('a', 1001), baseDeps(empSession));
  record('oversizeQuestionDenied',
    longQ.ok === false && longQ.error.code === 'VALIDATION',
    String((longQ.error && longQ.error.code) || ''));

  var maxQ = AskHrService.validateQuestion(repeatChar_('a', 1000));
  record('maxQuestionLenAllowed', maxQ.ok === true && maxQ.question.length === 1000);

  var missingCfgDeps = baseDeps(empSession, {
    getScriptProperty: function () { return ''; }
  });
  var missingCfg = AskHrService.ask('What is the leave notice period?', missingCfgDeps);
  record('missingConfigNotConfigured',
    missingCfg.ok === false && missingCfg.error.code === 'NOT_CONFIGURED',
    missingCfg.error ? missingCfg.error.code : '');
  record('missingConfigNoHubCall', missingCfgDeps.fetch.calls.length === 0);

  var badUrl = AskHrService.ask('What is the leave notice period?', baseDeps(empSession, {
    getScriptProperty: function (key) {
      if (key === HRMS.PROPS.KH_WEBAPP_URL) return 'https://evil.example.com/exec';
      if (key === HRMS.PROPS.KH_HMAC_SECRET) return GOLDEN_SECRET;
      return '';
    }
  }));
  record('untrustedHubUrlRejected',
    badUrl.ok === false && badUrl.error.code === 'NOT_CONFIGURED');

  var rateStore = memoryStore();
  var rateNow = 1700000000000;
  var i;
  var rateResult;
  var allowed = 0;
  var limited = 0;
  var eleventhFetch = successFetch();
  for (i = 0; i < 11; i++) {
    rateResult = AskHrService.ask('What is the leave notice period?', baseDeps(empSession, {
      store: rateStore,
      now: rateNow + i,
      fetch: i === 10 ? eleventhFetch : successFetch()
    }));
    if (rateResult.ok) allowed++;
    if (rateResult.ok === false && rateResult.error && rateResult.error.code === 'RATE_LIMITED') limited++;
  }
  record('rateLimitTenthAllowed', allowed === 10, 'allowed=' + allowed);
  record('rateLimitEleventhDenied', limited === 1 && rateResult.ok === false && rateResult.error.code === 'RATE_LIMITED',
    'limited=' + limited + ' last=' + (rateResult.error && rateResult.error.code));
  record('rateLimitFriendlyMessage',
    !!(rateResult.error && rateResult.error.message && rateResult.error.message.indexOf('wait') >= 0));
  record('rateLimitDoesNotCallHub', eleventhFetch.calls.length === 0, 'calls=' + eleventhFetch.calls.length);

  var canonical = KnowledgeHubClient.canonicalize({
    requestId: '11111111-2222-4333-8444-555555555555',
    timestamp: 1700000000,
    nonce: 'deadbeefcafebabe',
    actorId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    question: 'What is the leave notice period?'
  });
  record('canonicalExactGolden', canonical === GOLDEN_CANONICAL, canonical === GOLDEN_CANONICAL ? 'match' : canonical);

  var hmac = KnowledgeHubClient.hmacSha256Hex(GOLDEN_CANONICAL, GOLDEN_SECRET);
  record('hmacGoldenVector', hmac === GOLDEN_HMAC, hmac);
  record('hmacHex64', /^[a-f0-9]{64}$/.test(hmac), hmac);

  var builtGolden = KnowledgeHubClient.buildSignedRequest({
    requestId: '11111111-2222-4333-8444-555555555555',
    timestamp: 1700000000,
    nonce: 'deadbeefcafebabe',
    actorId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    question: 'What is the leave notice period?',
    iss: SCRIPT_ID,
    secret: GOLDEN_SECRET
  });
  record('buildSignedGoldenHmac', builtGolden.request.signature === GOLDEN_HMAC, builtGolden.request.signature);
  record('buildSignedGoldenCanonical', builtGolden.canonical === GOLDEN_CANONICAL);
  record('buildSignedHasIss', builtGolden.request.iss === SCRIPT_ID);
  record('buildSignedNoSecretOrEmail',
    builtGolden.request.secret === undefined &&
    builtGolden.request.email === undefined &&
    builtGolden.request.employee_id === undefined);

  var actor = KnowledgeHubClient.actorIdForEmployee('EMP001', GOLDEN_SECRET);
  record('actorIdGoldenEmployee', actor === GOLDEN_ACTOR, actor);
  record('actorIdHex64', /^[a-f0-9]{64}$/.test(actor), actor);

  var demoActor = KnowledgeHubClient.actorIdForDemo('demo@example.com', GOLDEN_SECRET);
  record('actorIdGoldenDemo', demoActor === GOLDEN_DEMO, demoActor);
  record('demoActorIdHex64', /^[a-f0-9]{64}$/.test(demoActor), demoActor);

  record('signedByteHex',
    KnowledgeHubClient.bytesToHex([-128, -1, 0, 15, 127]) === '80ff000f7f');

  var empFetch = successFetch();
  var empAudits = [];
  var empDeps = baseDeps(empSession, { fetch: empFetch, audits: empAudits });
  empDeps.auditLog = function (action, entityType, entityId, summary, employeeId) {
    empAudits.push({ action: action, entityType: entityType, entityId: entityId, summary: summary, employeeId: employeeId });
  };
  var empOk = AskHrService.ask('What is the leave notice period?', empDeps);
  var empPayload = lastPayload(empFetch);
  record('employeeAskSuccess', empOk.ok === true && empOk.version === '1' && !!empOk.answer, empOk.ok ? 'ok' : (empOk.error && empOk.error.code));
  record('successHasRequestId', empOk.requestId === '11111111-2222-4333-8444-555555555555');
  record('outboundKeysOnly', (function () {
    if (!empPayload) return false;
    var keys = Object.keys(empPayload).sort();
    return keys.join(',') === 'actorId,iss,nonce,question,requestId,signature,timestamp,version';
  })(), empPayload ? Object.keys(empPayload).sort().join(',') : 'no-payload');
  record('outboundIssIsScriptId', !!(empPayload && empPayload.iss === SCRIPT_ID), empPayload && empPayload.iss);
  record('outboundNoEmail', !!(empPayload && JSON.stringify(empPayload).indexOf('alice@client.com') < 0));
  record('outboundNoEmployeeId', !!(empPayload && JSON.stringify(empPayload).indexOf('EMP001') < 0 && JSON.stringify(empPayload).indexOf('employee_id') < 0));
  record('outboundNoRole', !!(empPayload && empPayload.role === undefined && JSON.stringify(empPayload).indexOf('"role"') < 0));
  record('outboundActorIdMatches', !!(empPayload && empPayload.actorId === GOLDEN_ACTOR && /^[a-f0-9]{64}$/.test(empPayload.actorId)));
  record('outboundSignatureMatchesCanonical', (function () {
    if (!empPayload) return false;
    var expectedSig = KnowledgeHubClient.hmacSha256Hex(KnowledgeHubClient.canonicalize({
      requestId: empPayload.requestId,
      timestamp: empPayload.timestamp,
      nonce: empPayload.nonce,
      actorId: empPayload.actorId,
      question: empPayload.question
    }), GOLDEN_SECRET);
    return empPayload.signature === expectedSig;
  })(), empPayload && empPayload.signature);
  record('firstPostNoFollowRedirects', !!(empFetch.calls[0] && empFetch.calls[0].options.followRedirects === false));
  record('postJsonContentType',
    !!(empFetch.calls[0] && String(empFetch.calls[0].options.contentType).indexOf('application/json') === 0));
  record('responseStripsHubSecrets',
    empOk.email === undefined && empOk.employee_id === undefined && empOk.secret === undefined && empOk.actorId === undefined);
  record('responseKeepsSafeReference',
    empOk.references && empOk.references.length === 1 &&
    empOk.references[0].url === 'https://drive.google.com/file/d/abc123');
  record('auditTruncatedQuestion',
    empAudits.length === 1 &&
    empAudits[0].action === 'ASK_HR' &&
    empAudits[0].employeeId === 'EMP001' &&
    empAudits[0].entityId === '11111111-2222-4333-8444-555555555555' &&
    empAudits[0].summary === 'What is the leave notice period?' &&
    empAudits[0].summary.length <= 80);
  record('auditNoFullAnswer',
    empAudits.length === 1 && String(JSON.stringify(empAudits[0])).indexOf('Give at least 15 days') < 0);

  var longAudits = [];
  var longAskQ = 'Please explain the full leave notice rules ' + repeatChar_('x', 80);
  AskHrService.ask(longAskQ, baseDeps(empSession, {
    fetch: successFetch(),
    auditLog: function (action, entityType, entityId, summary, employeeId) {
      longAudits.push({ summary: summary, employeeId: employeeId, action: action });
    }
  }));
  record('auditQuestionTruncated80',
    longAudits.length === 1 &&
    longAudits[0].summary.length === 80 &&
    longAskQ.indexOf(longAudits[0].summary) === 0);

  var demoFetch = successFetch();
  var demoOk = AskHrService.ask('What is the leave notice period?', baseDeps(demoSession, { fetch: demoFetch }));
  var demoPayload = lastPayload(demoFetch);
  record('demoAskSuccess', demoOk.ok === true);
  record('demoOutboundNoEmail', !!(demoPayload && JSON.stringify(demoPayload).indexOf('demo@example.com') < 0));
  record('demoActorIdMatches', !!(demoPayload && demoPayload.actorId === GOLDEN_DEMO));

  var hubErr = KnowledgeHubClient.mapHubError({
    ok: false,
    error: { code: 'INVALID_SIGNATURE', message: 'HMAC secret ayurcentral-hrms-kh-golden-v1 mismatch for alice@client.com' }
  }, 'req-map-1');
  record('hubInvalidSignatureMappedUpstream', hubErr.ok === false && hubErr.error.code === 'UPSTREAM');
  record('hubErrorMessageSafe',
    hubErr.error.message.indexOf('secret') < 0 &&
    hubErr.error.message.indexOf('ayurcentral') < 0 &&
    hubErr.error.message.indexOf('alice@') < 0);

  var hubRate = KnowledgeHubClient.mapHubError({
    ok: false,
    error: { code: 'RATE_LIMITED', message: 'internal limiter dump' }
  }, 'req-map-2');
  record('hubRateLimitMapped', hubRate.error.code === 'RATE_LIMITED');
  record('hubRateLimitMessageSafe', hubRate.error.message.indexOf('internal') < 0);

  var hubVal = KnowledgeHubClient.mapHubError({
    ok: false,
    error: { code: 'VALIDATION', message: 'question leaked EMP001' }
  }, 'req-map-3');
  record('hubValidationMapped', hubVal.error.code === 'VALIDATION' && hubVal.error.message.indexOf('EMP001') < 0);

  var hubReplay = KnowledgeHubClient.mapHubError({
    ok: false,
    error: { code: 'REPLAY', message: 'nonce reused' }
  }, 'req-map-4');
  record('hubReplayMapped', hubReplay.error.code === 'REPLAY' && hubReplay.error.message.indexOf('nonce') < 0);

  var hubTimeout = KnowledgeHubClient.mapHubError({
    ok: false,
    error: { code: 'TIMEOUT', message: 'gemini deadline' }
  }, 'req-map-5');
  record('hubTimeoutMapped', hubTimeout.error.code === 'TIMEOUT' && hubTimeout.error.message.indexOf('gemini') < 0);

  var malicious = KnowledgeHubClient.sanitizeSuccess({
    ok: true,
    answer: '<script>alert(1)</script>Notice is 15 days.',
    keyPoints: ['<b>bold</b>', { evil: true }, 'Plain point'],
    references: [
      { url: 'javascript:alert(1)', fileName: 'xss' },
      { url: 'data:text/html,hi', fileName: 'data' },
      { url: 'file:///etc/passwd', fileName: 'file' },
      { url: 'https://evil.example.com/policy.pdf', fileName: 'evil' },
      { url: 'http://drive.google.com/file/d/abc', fileName: 'insecure' },
      { url: 'https://drive.google.com.evil.com/file', fileName: 'spoof' },
      { url: 'https://docs.google.com/document/d/xyz', fileName: '<img src=x onerror=alert(1)>Policy' },
      { url: 'https://drive.google.com/file/d/ok', fileName: 'OK.pdf' }
    ],
    notFound: false,
    executionMs: 9,
    payroll: { net: 99999 },
    email: 'alice@client.com'
  }, 'req-san-1');
  record('maliciousJsUrlRejected', (function () {
    var urls = (malicious.references || []).map(function (r) { return r.url; }).join(' ');
    return urls.indexOf('javascript:') < 0 && urls.indexOf('data:') < 0 && urls.indexOf('file:') < 0 &&
      urls.indexOf('evil.example.com') < 0 && urls.indexOf('drive.google.com.evil.com') < 0;
  })(), JSON.stringify(malicious.references));
  record('onlyDriveDocsUrlsKept',
    malicious.references.length === 2 &&
    malicious.references[0].url.indexOf('docs.google.com') >= 0 &&
    malicious.references[1].url.indexOf('drive.google.com') >= 0);
  record('fileNameStrippedHtml',
    malicious.references.length > 0 &&
    malicious.references[0].fileName.indexOf('<') < 0 &&
    malicious.references[0].fileName.indexOf('onerror') < 0);
  record('answerStrippedScript',
    malicious.answer.indexOf('<script') < 0 && malicious.answer.indexOf('Notice is 15 days.') >= 0);
  record('sanitizedDropsPayrollAndEmail',
    malicious.payroll === undefined && malicious.email === undefined);
  record('keyPointsStringsOnly',
    malicious.keyPoints.length === 2 && malicious.keyPoints[0].indexOf('<') < 0);

  record('referenceUrlAllowlist',
    KnowledgeHubClient.isAllowedReferenceUrl('https://drive.google.com/file/d/abc') &&
    KnowledgeHubClient.isAllowedReferenceUrl('https://docs.google.com/document/d/xyz') &&
    !KnowledgeHubClient.isAllowedReferenceUrl('javascript:alert(1)') &&
    !KnowledgeHubClient.isAllowedReferenceUrl('https://example.com/') &&
    !KnowledgeHubClient.isAllowedReferenceUrl('http://docs.google.com/document/d/xyz'));

  var unsafeRedirectFetch = recordingFetch(function (url, options, n) {
    if (n === 1) {
      return mockResponse(302, '', { Location: 'https://evil.example.com/steal' });
    }
    return mockResponse(200, hubOkBody());
  });
  var unsafeRedirect = AskHrService.ask('What is the leave notice period?', baseDeps(empSession, { fetch: unsafeRedirectFetch }));
  record('unsafe302NotFollowed',
    unsafeRedirect.ok === false &&
    unsafeRedirect.error.code === 'UPSTREAM' &&
    unsafeRedirectFetch.calls.length === 1,
    'calls=' + unsafeRedirectFetch.calls.length + ' code=' + (unsafeRedirect.error && unsafeRedirect.error.code));

  var safeRedirectFetch = recordingFetch(function (url, options, n) {
    if (n === 1) {
      return mockResponse(302, '', {
        Location: 'https://script.googleusercontent.com/macros/echo?user_content_key=test'
      });
    }
    return mockResponse(200, hubOkBody({ answer: 'Redirected answer.' }));
  });
  var safeRedirect = AskHrService.ask('What is the leave notice period?', baseDeps(empSession, { fetch: safeRedirectFetch }));
  record('safe302FollowedOnce',
    safeRedirect.ok === true &&
    safeRedirect.answer.indexOf('Redirected answer') >= 0 &&
    safeRedirectFetch.calls.length === 2,
    'calls=' + safeRedirectFetch.calls.length);
  record('safe302FollowsWithGet',
    safeRedirectFetch.calls.length === 2 &&
    String(safeRedirectFetch.calls[0].options.method).toLowerCase() === 'post' &&
    String(safeRedirectFetch.calls[1].options.method).toLowerCase() === 'get' &&
    !safeRedirectFetch.calls[1].options.payload &&
    safeRedirectFetch.calls[0].options.followRedirects === false &&
    safeRedirectFetch.calls[1].options.followRedirects === false);
  record('safe302NoRetryNonce',
    safeRedirectFetch.calls.length === 2 &&
    JSON.parse(safeRedirectFetch.calls[0].options.payload).nonce === 'deadbeefcafebabe' &&
    JSON.parse(safeRedirectFetch.calls[0].options.payload).requestId === '11111111-2222-4333-8444-555555555555');

  var htmlFetch = recordingFetch(function () {
    return mockResponse(200, '<html>login</html>');
  });
  var htmlRes = AskHrService.ask('What is the leave notice period?', baseDeps(empSession, { fetch: htmlFetch }));
  record('nonJsonHubIsUpstream', htmlRes.ok === false && htmlRes.error.code === 'UPSTREAM');

  var malAskFetch = recordingFetch(function () {
    return mockResponse(200, JSON.stringify({
      ok: true,
      answer: 'Policy text',
      references: [{ url: 'javascript:alert(1)', fileName: '<b>xss</b>' }]
    }));
  });
  var malAsk = AskHrService.ask('What is the leave notice period?', baseDeps(empSession, { fetch: malAskFetch }));
  record('askHrDropsMaliciousReference',
    malAsk.ok === true && malAsk.references.length === 0);

  var hubFileUrlFetch = recordingFetch(function () {
    return mockResponse(200, JSON.stringify({
      ok: true,
      version: '1',
      answer: 'Notice is in the policy.',
      keyPoints: [],
      references: [{ fileUrl: 'https://drive.google.com/file/d/hubref123', fileName: 'Leave Policy.pdf' }],
      notFound: false
    }));
  });
  var hubFileUrlAsk = AskHrService.ask('What is the leave notice period?', baseDeps(empSession, { fetch: hubFileUrlFetch }));
  record('hubFileUrlMappedToSafeUrl',
    hubFileUrlAsk.ok === true &&
    hubFileUrlAsk.references.length === 1 &&
    hubFileUrlAsk.references[0].url === 'https://drive.google.com/file/d/hubref123' &&
    hubFileUrlAsk.references[0].fileName === 'Leave Policy.pdf');

  var httpRedirectFetch = recordingFetch(function (url, options, n) {
    if (n === 1) {
      return mockResponse(302, '', { Location: 'http://script.google.com/macros/s/x/exec' });
    }
    return mockResponse(200, hubOkBody());
  });
  var httpRedirect = AskHrService.ask('What is the leave notice period?', baseDeps(empSession, { fetch: httpRedirectFetch }));
  record('http302NotFollowed',
    httpRedirect.ok === false && httpRedirect.error.code === 'UPSTREAM' && httpRedirectFetch.calls.length === 1);

  var wrapped = hrmsRun_(function () {
    return AskHrService.ask('What is the leave notice period?', baseDeps(empSession, { fetch: successFetch() }));
  }, 'unused-token');
  record('callServerEnvelopeInnerPayload',
    wrapped.ok === true && wrapped.data && wrapped.data.ok === true && !!wrapped.data.answer,
    wrapped.ok ? 'data.ok=' + (wrapped.data && wrapped.data.ok) : (wrapped.error && wrapped.error.code));

  record('testAskHrConfigurationExported', typeof testAskHrConfiguration === 'function');
  record('knowledgeHubClientPostJsonExported', typeof KnowledgeHubClient.postJson === 'function');
  record('askHrDiagnosticHelpersExported',
    typeof redactExecUrl_ === 'function' &&
    typeof classifyAskHrHubFailure_ === 'function' &&
    redactExecUrl_(HUB_URL).indexOf('script.google.com') >= 0 &&
    classifyAskHrHubFailure_(401, { error: { code: 'UNAUTHORIZED' } }) === 'HMAC_FAILURE');

  var genFailMapped = KnowledgeHubClient.mapHubError({
    ok: false,
    error: { code: 'GENERATION_FAILED', message: 'hidden' }
  }, 'req-gen');
  record('generationFailedMapped',
    genFailMapped.ok === false &&
    genFailMapped.error.code === 'GENERATION_FAILED' &&
    /unable to generate the answer/i.test(genFailMapped.error.message));

  var retFailMapped = KnowledgeHubClient.mapHubError({
    ok: false,
    error: { code: 'RETRIEVAL_FAILED', message: 'hidden' }
  }, 'req-ret');
  record('retrievalFailedMapped',
    retFailMapped.ok === false &&
    retFailMapped.error.code === 'RETRIEVAL_FAILED' &&
    /Unable to search the HR knowledge base/i.test(retFailMapped.error.message));

  var notFoundSanitized = KnowledgeHubClient.sanitizeSuccess({
    ok: true,
    version: '1',
    requestId: 'ignored',
    answer: '',
    keyPoints: [],
    references: [{ fileUrl: 'https://drive.google.com/file/d/x/view', fileName: 'Policy.pdf' }],
    notFound: true,
    executionMs: 10
  }, 'req-nf');
  record('notFoundFlagPreserved',
    notFoundSanitized.ok === true && notFoundSanitized.notFound === true);

  var sourceUrlKept = KnowledgeHubClient.sanitizeSuccess({
    ok: true,
    version: '1',
    requestId: 'ignored',
    answer: 'Notice is 15 days.',
    keyPoints: [],
    references: [{ fileUrl: 'https://drive.google.com/file/d/kept123/view', fileName: 'Leave Policy.pdf' }],
    notFound: false,
    executionMs: 11
  }, 'req-src');
  record('sourceUrlPreservedThroughSanitize',
    sourceUrlKept.references.length === 1 &&
    sourceUrlKept.references[0].url === 'https://drive.google.com/file/d/kept123/view' &&
    sourceUrlKept.references[0].fileName === 'Leave Policy.pdf');

  var clientCannotInjectDocs = KnowledgeHubClient.sanitizeSuccess({
    ok: true,
    version: '1',
    requestId: 'ignored',
    answer: 'ok',
    keyPoints: [],
    references: [
      { fileUrl: 'https://evil.example/doc', fileName: 'Injected' },
      { fileUrl: 'javascript:alert(1)', fileName: 'XSS' },
      { fileUrl: 'https://drive.google.com/file/d/ok/view', fileName: 'OK.pdf' }
    ],
    notFound: false,
    executionMs: 12
  }, 'req-inj');
  record('clientCannotIntroduceUnauthorizedDocs',
    clientCannotInjectDocs.references.length === 1 &&
    clientCannotInjectDocs.references[0].fileName === 'OK.pdf');

  record('employeeLookupModuleExported', typeof AskHrEmployeeLookup !== 'undefined' && typeof AskHrEmployeeLookup.tryAnswer === 'function');
  record('directoryQuestionNotClassified', !AskHrEmployeeLookup.classifyQuestion('who is manjunath reporting to'));
  record('reportsToQuestionNotClassified', !AskHrEmployeeLookup.classifyQuestion('who reports to product head'));
  record('selfManagerClassified',
    AskHrEmployeeLookup.classifyQuestion('who is my manager') &&
    AskHrEmployeeLookup.classifyQuestion('who is my manager').kind === 'MY_MANAGER');
  record('policyQuestionNotMisclassified',
    !AskHrEmployeeLookup.classifyQuestion('What is the maternity leave policy?'));
  record('directoryQuestionFallsThroughToHub',
    AskHrEmployeeLookup.tryAnswer({ authorized: true, employee_id: 'EMP001', role: 'ADMIN' }, 'Who does Manjunath report to?').handled === false);

  // Knowledge path: Hub once; no liveSource; no mode/context on wire
  (function () {
    var fetchFn = successFetch();
    var ok = AskHrService.ask('What is the leave notice period?', baseDeps(empSession, { fetch: fetchFn }));
    record('knowledgeStillUsesHub',
      ok.ok === true && fetchFn.calls.length >= 1,
      'calls=' + fetchFn.calls.length);
    record('knowledgeNoLiveSource', ok.liveSource !== true && ok.liveHrmsData !== true);
    var payload = lastPayload(fetchFn);
    record('knowledgePayloadNoModeContext',
      !!payload && payload.mode === undefined && payload.context === undefined);
  })();

  // Live-looking questions still use knowledge Hub (no ATS DB path)
  (function () {
    var fetchFn = successFetch();
    var result = AskHrService.ask('How many interviews are scheduled this week?', baseDeps(empSession, { fetch: fetchFn }));
    record('liveLookingQuestionStillKnowledgeHub',
      result.ok === true && fetchFn.calls.length >= 1,
      'calls=' + fetchFn.calls.length);
    var payload = lastPayload(fetchFn);
    record('liveLookingNoModeContext',
      !!payload && payload.mode === undefined && payload.context === undefined);
  })();

  var failed = results.filter(function (r) { return !r.passed; });
  Logger.log('Ask HR tests: ' + (results.length - failed.length) + '/' + results.length + ' passed (' + failed.length + ' failed)');
  return { results: results, allPassed: failed.length === 0, failedCount: failed.length };
}
