/**
 * Ask HR orchestration — session, RBAC, rate limit, Hub client, audit.
 * Does not expose Hub URL, HMAC secret, spreadsheet ID, Drive IDs, email, or employee_id to Hub.
 * Knowledge path only: question → HMAC → Ayurveda-AI Drive/Gemini. No live HRMS DATA/HYBRID.
 */
var HRMS = HRMS || {};

var AskHrService = (function () {
  function defaultStore_() {
    var cache;
    try {
      cache = CacheService.getScriptCache();
    } catch (e) {
      cache = null;
    }
    return {
      get: function (key) {
        if (!cache) return null;
        try {
          return cache.get(key);
        } catch (e) {
          return null;
        }
      },
      put: function (key, value, ttlSeconds) {
        if (!cache) return;
        try {
          cache.put(key, value, ttlSeconds);
        } catch (ignore) {}
      }
    };
  }

  function parseJson_(raw) {
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function rateLimitIdentity_(session) {
    if (session && session.employee_id) {
      return 'emp:' + String(session.employee_id);
    }
    if (session && session.demo && session.email) {
      return 'demo:' + String(session.email).trim().toLowerCase();
    }
    return '';
  }

  /**
   * 10 questions / 15 minutes / employee (or DEMO session identity).
   * No script lock — must not wrap the Hub call.
   * @param {string} identity
   * @param {number} nowMs
   * @param {Object} store
   * @return {boolean} true if the request is allowed
   */
  function consumeRateLimit_(identity, nowMs, store) {
    if (!identity) return false;
    store = store || defaultStore_();
    nowMs = nowMs != null ? Number(nowMs) : Date.now();
    var key = HRMS.CACHE.ASK_HR_RATE_PREFIX + identity;
    var data = parseJson_(store.get(key)) || { times: [] };
    data.times = (data.times || []).filter(function (t) {
      return nowMs - Number(t) < HRMS.ASK_HR.RATE_WINDOW_MS;
    });
    if (data.times.length >= HRMS.ASK_HR.RATE_MAX) {
      return false;
    }
    data.times.push(nowMs);
    store.put(key, JSON.stringify(data), HRMS.ASK_HR.RATE_WINDOW_SEC);
    return true;
  }

  function validateQuestion_(question) {
    var q = question == null ? '' : String(question);
    q = q.replace(/\u0000/g, '').trim();
    if (!q || q.length < HRMS.ASK_HR.MIN_QUESTION_LEN) {
      return { ok: false, question: '' };
    }
    if (q.length > HRMS.ASK_HR.MAX_QUESTION_LEN) {
      return { ok: false, question: '' };
    }
    if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(q)) {
      return { ok: false, question: '' };
    }
    return { ok: true, question: q };
  }

  function resolveSession_(deps) {
    if (deps && deps.session) return deps.session;
    return AuthService.resolveSession();
  }

  function getScriptId_(deps) {
    if (deps && deps.getScriptId) return String(deps.getScriptId() || '');
    try {
      return ScriptApp.getScriptId();
    } catch (e) {
      return '';
    }
  }

  function auditAsk_(session, requestId, question, deps) {
    var summary = String(question || '').substring(0, HRMS.ASK_HR.AUDIT_QUESTION_CHARS);
    var employeeId = session && session.employee_id ? String(session.employee_id) : '';
    try {
      if (deps && deps.auditLog) {
        deps.auditLog('ASK_HR', 'AskHr', requestId, summary, employeeId);
        return;
      }
      AuditService.log('ASK_HR', 'AskHr', requestId, summary, employeeId);
    } catch (e) {
      Logger.log('Ask HR audit skipped requestId=' + String(requestId || ''));
    }
  }

  /**
   * @param {string} question
   * @param {Object=} deps Test seams: session, getScriptProperty, store, now, fetch, getScriptId, uuid, nonce, timestamp, auditLog
   * @return {Object} Chatbot payload { ok, version, requestId, answer|error, ... }
   */
  function ask(question, deps) {
    deps = deps || {};
    var requestId = '';

    try {
      var session = resolveSession_(deps);
      if (!session || !session.authorized) {
        return KnowledgeHubClient.errorResult('', 'UNAUTHORIZED');
      }
      if (!PermissionService.can(HRMS.ACTIONS.ACCESS_APP, {}, session) ||
          !PermissionService.can(HRMS.ACTIONS.ASK_HR, {}, session)) {
        return KnowledgeHubClient.errorResult('', 'UNAUTHORIZED');
      }

      var validated = validateQuestion_(question);
      if (!validated.ok) {
        return KnowledgeHubClient.errorResult('', 'VALIDATION');
      }

      var config = KnowledgeHubClient.readConfig(deps);
      if (!config.ok) {
        return KnowledgeHubClient.errorResult('', 'NOT_CONFIGURED');
      }

      var identity = rateLimitIdentity_(session);
      if (!identity) {
        return KnowledgeHubClient.errorResult('', 'UNAUTHORIZED');
      }
      var nowMs = deps.now != null ? Number(deps.now) : Date.now();
      if (!consumeRateLimit_(identity, nowMs, deps.store)) {
        return KnowledgeHubClient.errorResult('', 'RATE_LIMITED');
      }

      requestId = deps.uuid ? String(deps.uuid()) : Utilities.getUuid();
      var nonce = deps.nonce ? String(deps.nonce) : KnowledgeHubClient.randomNonceHex();
      var timestamp = deps.timestamp != null
        ? Number(deps.timestamp)
        : Math.floor(nowMs / 1000);
      var iss = getScriptId_(deps);
      if (!iss) {
        Logger.log('Ask HR missing script id requestId=' + requestId);
        return KnowledgeHubClient.errorResult(requestId, 'UPSTREAM');
      }

      var actorId = KnowledgeHubClient.actorIdForSession(session, config.secret);
      if (!actorId || !/^[a-f0-9]{64}$/.test(actorId)) {
        Logger.log('Ask HR actorId failed requestId=' + requestId);
        return KnowledgeHubClient.errorResult(requestId, 'UPSTREAM');
      }

      auditAsk_(session, requestId, validated.question, deps);

      var employeeAnswer = AskHrEmployeeLookup.tryAnswer(session, validated.question);
      if (employeeAnswer && employeeAnswer.handled) {
        return {
          ok: true,
          version: HRMS.ASK_HR.VERSION,
          requestId: requestId,
          answer: String(employeeAnswer.answer || ''),
          keyPoints: employeeAnswer.keyPoints || [],
          references: employeeAnswer.references || [],
          notFound: !!employeeAnswer.notFound,
          executionMs: 0
        };
      }

      // Knowledge only — question-only HMAC submit (no mode/context, no live HRMS data).
      var result = KnowledgeHubClient.submit(
        {
          url: config.url,
          secret: config.secret,
          iss: iss,
          requestId: requestId,
          timestamp: timestamp,
          nonce: nonce,
          actorId: actorId,
          question: validated.question
        },
        deps
      );
      if (result && result.requestId === undefined) {
        result.requestId = requestId;
      }
      return result;
    } catch (e) {
      Logger.log('Ask HR failed requestId=' + requestId);
      return KnowledgeHubClient.errorResult(requestId, 'UPSTREAM');
    }
  }

  return {
    ask: ask,
    consumeRateLimit: consumeRateLimit_,
    validateQuestion: validateQuestion_,
    rateLimitIdentity: rateLimitIdentity_
  };
})();
