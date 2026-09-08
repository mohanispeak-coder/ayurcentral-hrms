/**
 * Pure notification logic — no spreadsheet, MailApp, or LockService.
 * NotificationService persists; adapters build typed payloads.
 */
var HRMS = HRMS || {};

var NotificationEngine = (function () {
  var PRIORITY = {
    LOW: 'LOW',
    NORMAL: 'NORMAL',
    HIGH: 'HIGH'
  };

  var STATUS = {
    UNREAD: 'UNREAD',
    READ: 'READ'
  };

  var EMAIL_STATUS = {
    PENDING: 'PENDING',
    SENT: 'SENT',
    FAILED: 'FAILED',
    SKIPPED: 'SKIPPED',
    NO_EMAIL: 'NO_EMAIL'
  };

  var MODULE = {
    LEAVE: 'LEAVE',
    PAYROLL: 'PAYROLL',
    PMS: 'PMS',
    ATS: 'ATS',
    GENERAL: 'GENERAL',
    SYSTEM: 'SYSTEM'
  };

  var TYPE = {
    LEAVE_SUBMITTED: 'LEAVE_SUBMITTED',
    LEAVE_APPROVED: 'LEAVE_APPROVED',
    LEAVE_REJECTED: 'LEAVE_REJECTED',
    LEAVE_CANCELLED: 'LEAVE_CANCELLED',
    PAYROLL_READY_REVIEW: 'PAYROLL_READY_REVIEW',
    PAYROLL_APPROVED: 'PAYROLL_APPROVED',
    PAYROLL_LOCKED: 'PAYROLL_LOCKED',
    PAYSLIP_AVAILABLE: 'PAYSLIP_AVAILABLE',
    PMS_CYCLE_OPEN: 'PMS_CYCLE_OPEN',
    PMS_SELF_ASSESSMENT_DUE: 'PMS_SELF_ASSESSMENT_DUE',
    PMS_MANAGER_REVIEW_PENDING: 'PMS_MANAGER_REVIEW_PENDING',
    PMS_FINALIZED: 'PMS_FINALIZED',
    ATS_NEW_APPLICATION: 'ATS_NEW_APPLICATION',
    ATS_SHORTLISTED: 'ATS_SHORTLISTED',
    ATS_INTERVIEW_SCHEDULED: 'ATS_INTERVIEW_SCHEDULED',
    ATS_FEEDBACK_PENDING: 'ATS_FEEDBACK_PENDING',
    ATS_SELECTED: 'ATS_SELECTED',
    ATS_CANDIDATE_APPLICATION: 'ATS_CANDIDATE_APPLICATION',
    ATS_CANDIDATE_INTERVIEW: 'ATS_CANDIDATE_INTERVIEW',
    ATS_CANDIDATE_UPDATE: 'ATS_CANDIDATE_UPDATE',
    HAPPY_BIRTHDAY: 'HAPPY_BIRTHDAY',
    WORK_ANNIVERSARY: 'WORK_ANNIVERSARY',
    HR_ANNOUNCEMENT: 'HR_ANNOUNCEMENT',
    POLICY_ANNOUNCEMENT: 'POLICY_ANNOUNCEMENT',
    SYSTEM_ANNOUNCEMENT: 'SYSTEM_ANNOUNCEMENT'
  };

  var MONTHS_ = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  function def_(type, module, label, priority, inApp, email, extra) {
    extra = extra || {};
    return {
      type: type,
      module: module,
      label: label,
      priority: priority,
      inAppDefault: !!inApp,
      emailDefault: !!email,
      orgEmailSetting: extra.orgEmailSetting || '',
      audience: extra.audience || 'internal',
      preferenceVisible: extra.preferenceVisible !== false,
      actionRoute: extra.actionRoute || '',
      auditCreate: !!extra.auditCreate
    };
  }

  var CATALOG_ = {};
  CATALOG_[TYPE.LEAVE_SUBMITTED] = def_(TYPE.LEAVE_SUBMITTED, MODULE.LEAVE, 'Leave submitted', PRIORITY.HIGH, true, true, {
    orgEmailSetting: 'notification_leave', actionRoute: 'leave-approvals'
  });
  CATALOG_[TYPE.LEAVE_APPROVED] = def_(TYPE.LEAVE_APPROVED, MODULE.LEAVE, 'Leave approved', PRIORITY.NORMAL, true, true, {
    orgEmailSetting: 'notification_leave', actionRoute: 'my-leave'
  });
  CATALOG_[TYPE.LEAVE_REJECTED] = def_(TYPE.LEAVE_REJECTED, MODULE.LEAVE, 'Leave rejected', PRIORITY.HIGH, true, true, {
    orgEmailSetting: 'notification_leave', actionRoute: 'my-leave'
  });
  CATALOG_[TYPE.LEAVE_CANCELLED] = def_(TYPE.LEAVE_CANCELLED, MODULE.LEAVE, 'Leave cancelled', PRIORITY.NORMAL, true, false, {
    orgEmailSetting: 'notification_leave', actionRoute: 'my-leave'
  });
  CATALOG_[TYPE.PAYROLL_READY_REVIEW] = def_(TYPE.PAYROLL_READY_REVIEW, MODULE.PAYROLL, 'Payroll ready for review', PRIORITY.HIGH, true, true, {
    orgEmailSetting: 'notification_payroll', actionRoute: 'payroll-run'
  });
  CATALOG_[TYPE.PAYROLL_APPROVED] = def_(TYPE.PAYROLL_APPROVED, MODULE.PAYROLL, 'Payroll approved', PRIORITY.NORMAL, true, true, {
    orgEmailSetting: 'notification_payroll', actionRoute: 'payroll-run'
  });
  CATALOG_[TYPE.PAYROLL_LOCKED] = def_(TYPE.PAYROLL_LOCKED, MODULE.PAYROLL, 'Payroll locked', PRIORITY.NORMAL, true, false, {
    orgEmailSetting: 'notification_payroll', actionRoute: 'payroll-run'
  });
  CATALOG_[TYPE.PAYSLIP_AVAILABLE] = def_(TYPE.PAYSLIP_AVAILABLE, MODULE.PAYROLL, 'Payslip available', PRIORITY.HIGH, true, true, {
    orgEmailSetting: 'notification_payroll', actionRoute: 'my-payslips'
  });
  CATALOG_[TYPE.PMS_CYCLE_OPEN] = def_(TYPE.PMS_CYCLE_OPEN, MODULE.PMS, 'Review cycle open', PRIORITY.NORMAL, true, true, {
    actionRoute: 'pms-cycle'
  });
  CATALOG_[TYPE.PMS_SELF_ASSESSMENT_DUE] = def_(TYPE.PMS_SELF_ASSESSMENT_DUE, MODULE.PMS, 'Self-assessment due', PRIORITY.HIGH, true, true, {
    actionRoute: 'pms-self'
  });
  CATALOG_[TYPE.PMS_MANAGER_REVIEW_PENDING] = def_(TYPE.PMS_MANAGER_REVIEW_PENDING, MODULE.PMS, 'Manager review pending', PRIORITY.HIGH, true, true, {
    actionRoute: 'pms-review'
  });
  CATALOG_[TYPE.PMS_FINALIZED] = def_(TYPE.PMS_FINALIZED, MODULE.PMS, 'Review finalized', PRIORITY.NORMAL, true, false, {
    actionRoute: 'pms-cycle'
  });
  CATALOG_[TYPE.ATS_NEW_APPLICATION] = def_(TYPE.ATS_NEW_APPLICATION, MODULE.ATS, 'New application', PRIORITY.NORMAL, true, false, {
    actionRoute: 'ats-applications'
  });
  CATALOG_[TYPE.ATS_SHORTLISTED] = def_(TYPE.ATS_SHORTLISTED, MODULE.ATS, 'Candidate shortlisted', PRIORITY.NORMAL, true, false, {
    actionRoute: 'ats-applications'
  });
  CATALOG_[TYPE.ATS_INTERVIEW_SCHEDULED] = def_(TYPE.ATS_INTERVIEW_SCHEDULED, MODULE.ATS, 'Interview scheduled', PRIORITY.HIGH, true, true, {
    actionRoute: 'ats-interviews'
  });
  CATALOG_[TYPE.ATS_FEEDBACK_PENDING] = def_(TYPE.ATS_FEEDBACK_PENDING, MODULE.ATS, 'Interview feedback pending', PRIORITY.HIGH, true, true, {
    actionRoute: 'ats-interviews'
  });
  CATALOG_[TYPE.ATS_SELECTED] = def_(TYPE.ATS_SELECTED, MODULE.ATS, 'Candidate selected', PRIORITY.NORMAL, true, false, {
    actionRoute: 'ats-applications'
  });
  CATALOG_[TYPE.ATS_CANDIDATE_APPLICATION] = def_(TYPE.ATS_CANDIDATE_APPLICATION, MODULE.ATS, 'Application received', PRIORITY.NORMAL, false, true, {
    audience: 'candidate', preferenceVisible: false
  });
  CATALOG_[TYPE.ATS_CANDIDATE_INTERVIEW] = def_(TYPE.ATS_CANDIDATE_INTERVIEW, MODULE.ATS, 'Interview invitation', PRIORITY.HIGH, false, true, {
    audience: 'candidate', preferenceVisible: false
  });
  CATALOG_[TYPE.ATS_CANDIDATE_UPDATE] = def_(TYPE.ATS_CANDIDATE_UPDATE, MODULE.ATS, 'Application update', PRIORITY.NORMAL, false, true, {
    audience: 'candidate', preferenceVisible: false
  });
  CATALOG_[TYPE.HAPPY_BIRTHDAY] = def_(TYPE.HAPPY_BIRTHDAY, MODULE.GENERAL, 'Happy birthday', PRIORITY.LOW, true, false, {});
  CATALOG_[TYPE.WORK_ANNIVERSARY] = def_(TYPE.WORK_ANNIVERSARY, MODULE.GENERAL, 'Work anniversary', PRIORITY.LOW, true, false, {});
  CATALOG_[TYPE.HR_ANNOUNCEMENT] = def_(TYPE.HR_ANNOUNCEMENT, MODULE.GENERAL, 'HR announcement', PRIORITY.NORMAL, true, false, {
    auditCreate: true
  });
  CATALOG_[TYPE.POLICY_ANNOUNCEMENT] = def_(TYPE.POLICY_ANNOUNCEMENT, MODULE.GENERAL, 'Policy announcement', PRIORITY.NORMAL, true, true, {
    auditCreate: true
  });
  CATALOG_[TYPE.SYSTEM_ANNOUNCEMENT] = def_(TYPE.SYSTEM_ANNOUNCEMENT, MODULE.SYSTEM, 'System announcement', PRIORITY.NORMAL, true, false, {
    auditCreate: true
  });

  function trim_(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
  }

  function lower_(v) {
    return trim_(v).toLowerCase();
  }

  function isTruthy(value) {
    if (value === true || value === 1) return true;
    var s = String(value == null ? '' : value).trim().toUpperCase();
    return s === 'TRUE' || s === 'YES' || s === 'Y' || s === '1';
  }

  function isFalseyPref_(value) {
    if (value === false || value === 0) return true;
    var s = String(value == null ? '' : value).trim().toUpperCase();
    return s === 'FALSE' || s === 'NO' || s === 'N' || s === '0';
  }

  function catalog() {
    var out = [];
    Object.keys(CATALOG_).forEach(function (k) {
      out.push(CATALOG_[k]);
    });
    return out;
  }

  function preferenceCatalog() {
    return catalog().filter(function (d) {
      return d.preferenceVisible && d.audience === 'internal';
    });
  }

  function getTypeDef(type) {
    return CATALOG_[String(type || '').trim().toUpperCase()] || null;
  }

  function isCandidateType(type) {
    var def = getTypeDef(type);
    return !!(def && def.audience === 'candidate');
  }

  function interpolate(template, vars) {
    var out = String(template == null ? '' : template);
    vars = vars || {};
    Object.keys(vars).forEach(function (key) {
      var token = '{' + key + '}';
      var val = vars[key] == null ? '' : String(vars[key]);
      while (out.indexOf(token) >= 0) {
        out = out.replace(token, val);
      }
    });
    return out;
  }

  function periodLabel(year, month) {
    var y = Number(year);
    var m = Number(month);
    if (!y || !m || m < 1 || m > 12) {
      return trim_(year) + (month ? '-' + month : '');
    }
    return MONTHS_[m - 1] + ' ' + y;
  }

  function payslipSubject(year, month) {
    return 'Payslip available — ' + periodLabel(year, month);
  }

  function payslipContainsNet_(text) {
    return /net\s*pay|net_pay|₹|inr\s*\d/i.test(String(text || ''));
  }

  function buildDedupeKey(input) {
    input = input || {};
    var type = trim_(input.type).toUpperCase();
    var recipient = trim_(input.recipient_employee_id) || lower_(input.recipient_email);
    var module = trim_(input.source_module).toUpperCase();
    var recordId = trim_(input.source_record_id);
    var bucket = trim_(input.dedupe_bucket);
    return [type, recipient, module, recordId, bucket].join('|');
  }

  function statusOf(row) {
    if (!row) return STATUS.UNREAD;
    if (trim_(row.status).toUpperCase() === STATUS.READ) return STATUS.READ;
    return trim_(row.read_at) ? STATUS.READ : STATUS.UNREAD;
  }

  function isUnread(row) {
    return statusOf(row) === STATUS.UNREAD;
  }

  function isHrOrAdmin(session) {
    if (!session || !session.authorized) return false;
    var role = String(session.role || '').toUpperCase();
    return role === 'HR' || role === 'ADMIN';
  }

  function isAdmin(session) {
    return !!(session && session.authorized && String(session.role || '').toUpperCase() === 'ADMIN');
  }

  function ownsRow(row, session) {
    if (!row || !session || !session.authorized) return false;
    var emp = trim_(session.employee_id);
    var email = lower_(session.email);
    if (emp && trim_(row.recipient_employee_id) === emp) return true;
    if (email && lower_(row.recipient_email) === email) return true;
    return false;
  }

  function canViewInboxRow(session, row) {
    return ownsRow(row, session);
  }

  function canViewEmailLog(session) {
    return isHrOrAdmin(session);
  }

  function canAnnounce(session) {
    return isHrOrAdmin(session);
  }

  function canRetryEmail(session) {
    return isHrOrAdmin(session);
  }

  function parseActionParams(raw) {
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try {
      var parsed = JSON.parse(String(raw));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function stringifyActionParams(obj) {
    if (!obj || typeof obj !== 'object') return '';
    try {
      return JSON.stringify(obj);
    } catch (e) {
      return '';
    }
  }

  function actionFor(type, sourceRecordId, extra) {
    extra = extra || {};
    var def = getTypeDef(type) || {};
    var route = extra.action_route || def.actionRoute || '';
    var params = extra.action_params ? parseActionParams(extra.action_params) : {};
    if (route === 'leave-approvals' && sourceRecordId && !params.leaveRequestId) {
      params.leaveRequestId = sourceRecordId;
    }
    if (route === 'payroll-run' && sourceRecordId && !params.runId) {
      params.runId = sourceRecordId;
    }
    if ((route === 'employee-profile' || route === 'my-profile') && extra.employee_id && !params.employeeId) {
      params.employeeId = extra.employee_id;
    }
    if (route.indexOf('pms') === 0 && sourceRecordId && !params.cycleId) {
      params.cycleId = sourceRecordId;
    }
    if (route.indexOf('ats') === 0 && sourceRecordId && !params.applicationId) {
      params.applicationId = sourceRecordId;
    }
    return { action_route: route, action_params: params };
  }

  function findPref_(prefs, employeeId, type) {
    prefs = prefs || [];
    var emp = trim_(employeeId);
    var t = trim_(type).toUpperCase();
    for (var i = 0; i < prefs.length; i++) {
      if (trim_(prefs[i].employee_id) === emp && trim_(prefs[i].notification_type).toUpperCase() === t) {
        return prefs[i];
      }
    }
    return null;
  }

  function resolveChannels(typeDef, prefRow, orgSettings, override) {
    typeDef = typeDef || {};
    orgSettings = orgSettings || {};
    override = override || {};
    var inApp = typeDef.inAppDefault;
    var email = typeDef.emailDefault;

    if (prefRow) {
      if (prefRow.in_app_enabled !== '' && prefRow.in_app_enabled !== null && prefRow.in_app_enabled !== undefined) {
        inApp = isTruthy(prefRow.in_app_enabled);
        if (isFalseyPref_(prefRow.in_app_enabled)) inApp = false;
      }
      if (prefRow.email_enabled !== '' && prefRow.email_enabled !== null && prefRow.email_enabled !== undefined) {
        email = isTruthy(prefRow.email_enabled);
        if (isFalseyPref_(prefRow.email_enabled)) email = false;
      }
    }

    if (typeDef.orgEmailSetting && orgSettings.hasOwnProperty(typeDef.orgEmailSetting)) {
      if (!isTruthy(orgSettings[typeDef.orgEmailSetting])) {
        email = false;
      }
    }

    if (override.force_email === true) email = true;
    if (override.force_email === false) email = false;
    if (override.force_in_app === true) inApp = true;
    if (override.force_in_app === false) inApp = false;

    if (typeDef.audience === 'candidate') {
      inApp = false;
    }

    return { inApp: !!inApp, email: !!email };
  }

  function validateCreate(input) {
    var errors = [];
    input = input || {};
    var def = getTypeDef(input.type);
    if (!def) errors.push('Unknown notification type.');
    if (!trim_(input.title) && !(def && def.label)) errors.push('Title is required.');
    if (!trim_(input.recipient_employee_id) && !trim_(input.recipient_email)) {
      errors.push('Recipient employee_id or email is required.');
    }
    if (def && def.audience === 'candidate' && trim_(input.recipient_employee_id)) {
      errors.push('Candidate emails must not target an HRMS employee inbox.');
    }
    if (payslipContainsNet_(input.title) || payslipContainsNet_(input.email_subject) ||
        payslipContainsNet_(input.message)) {
      if (def && def.type === TYPE.PAYSLIP_AVAILABLE) {
        errors.push('Payslip notifications must not include net pay.');
      }
    }
    var priority = trim_(input.priority).toUpperCase();
    if (priority && !PRIORITY[priority]) errors.push('Invalid priority.');
    return errors;
  }

  function normalizeCreateInput_(input) {
    input = input || {};
    var type = trim_(input.type).toUpperCase();
    var def = getTypeDef(type) || {};
    var action = actionFor(type, input.source_record_id, input);
    var priority = trim_(input.priority).toUpperCase() || def.priority || PRIORITY.NORMAL;
    return {
      type: type,
      title: trim_(input.title) || def.label || type,
      message: trim_(input.message),
      recipient_employee_id: trim_(input.recipient_employee_id),
      recipient_email: lower_(input.recipient_email),
      source_module: trim_(input.source_module).toUpperCase() || def.module || '',
      source_record_id: trim_(input.source_record_id),
      priority: PRIORITY[priority] || PRIORITY.NORMAL,
      action_route: action.action_route,
      action_params: action.action_params,
      dedupe_bucket: trim_(input.dedupe_bucket),
      email_subject: trim_(input.email_subject) || trim_(input.title) || def.label || type,
      email_body: trim_(input.email_body) || trim_(input.message),
      actor_employee_id: trim_(input.actor_employee_id),
      force_email: input.force_email,
      force_in_app: input.force_in_app
    };
  }

  function toRecord_(normalized, id, now, channels, dedupeKey) {
    var created = now || new Date();
    return {
      notification_id: id,
      recipient_employee_id: normalized.recipient_employee_id,
      recipient_email: normalized.recipient_email,
      type: normalized.type,
      title: normalized.title,
      message: normalized.message,
      source_module: normalized.source_module,
      source_record_id: normalized.source_record_id,
      created_at: created,
      read_at: '',
      priority: normalized.priority,
      action_route: normalized.action_route,
      action_params: stringifyActionParams(normalized.action_params),
      dedupe_key: dedupeKey,
      status: STATUS.UNREAD,
      actor_employee_id: normalized.actor_employee_id,
      email_status: channels.email ? EMAIL_STATUS.PENDING : EMAIL_STATUS.SKIPPED,
      email_log_id: ''
    };
  }

  function findByDedupe_(rows, key) {
    if (!key) return null;
    rows = rows || [];
    for (var i = 0; i < rows.length; i++) {
      if (trim_(rows[i].dedupe_key) === key) return rows[i];
    }
    return null;
  }

  function sortNewest_(rows) {
    return (rows || []).slice().sort(function (a, b) {
      return new Date(b.created_at) - new Date(a.created_at);
    });
  }

  function serializeRow(row) {
    if (!row) return null;
    function iso_(value) {
      if (value === null || value === undefined || value === '') return '';
      if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
        return value.toISOString();
      }
      return String(value);
    }
    return {
      notification_id: row.notification_id,
      recipient_employee_id: row.recipient_employee_id || '',
      recipient_email: row.recipient_email || '',
      type: row.type,
      title: row.title || '',
      message: row.message || '',
      source_module: row.source_module || '',
      source_record_id: row.source_record_id || '',
      created_at: iso_(row.created_at),
      read_at: iso_(row.read_at),
      priority: row.priority || PRIORITY.NORMAL,
      action_route: row.action_route || '',
      action_params: parseActionParams(row.action_params),
      status: statusOf(row),
      unread: isUnread(row),
      email_status: row.email_status || ''
    };
  }

  function listInStore_(store, session, query) {
    query = query || {};
    var rows = (store.list() || []).filter(function (row) {
      return canViewInboxRow(session, row);
    });
    if (query.unreadOnly) {
      rows = rows.filter(isUnread);
    }
    if (query.type) {
      var t = trim_(query.type).toUpperCase();
      rows = rows.filter(function (r) { return trim_(r.type).toUpperCase() === t; });
    }
    if (query.source_module) {
      var m = trim_(query.source_module).toUpperCase();
      rows = rows.filter(function (r) { return trim_(r.source_module).toUpperCase() === m; });
    }
    rows = sortNewest_(rows);
    var offset = Number(query.offset) || 0;
    var limit = query.limit == null ? 50 : Number(query.limit);
    if (limit < 1) limit = 50;
    if (limit > 200) limit = 200;
    var sliced = rows.slice(offset, offset + limit);
    return {
      items: sliced.map(serializeRow),
      total: rows.length,
      unread_count: rows.filter(isUnread).length,
      offset: offset,
      limit: limit
    };
  }

  function unreadCountInStore_(store, session) {
    return (store.list() || []).filter(function (row) {
      return canViewInboxRow(session, row) && isUnread(row);
    }).length;
  }

  function createInStore_(store, input, options) {
    options = options || {};
    var normalized = normalizeCreateInput_(input);
    var errors = validateCreate(normalized);
    if (errors.length) {
      return { ok: false, created: false, errors: errors };
    }
    var def = getTypeDef(normalized.type);
    if (def && def.audience === 'candidate') {
      return {
        ok: true,
        created: false,
        candidateEmail: true,
        record: null,
        channels: { inApp: false, email: true },
        normalized: normalized
      };
    }
    var dedupeKey = buildDedupeKey(normalized);
    var existing = findByDedupe_(store.list(), dedupeKey);
    if (existing) {
      return { ok: true, created: false, duplicate: true, record: existing, channels: { inApp: false, email: false } };
    }
    var pref = findPref_(options.preferences, normalized.recipient_employee_id, normalized.type);
    var channels = resolveChannels(def, pref, options.orgSettings, normalized);
    if (!channels.inApp && !channels.email) {
      return { ok: true, created: false, skipped: true, reason: 'disabled', channels: channels };
    }
    var idFactory = options.idFactory || function () {
      return 'INB-' + String(Date.now()) + '-' + Math.floor(Math.random() * 10000);
    };
    var record = toRecord_(normalized, idFactory(), options.now || new Date(), channels, dedupeKey);
    if (channels.inApp) {
      store.insert(record);
    }
    return {
      ok: true,
      created: !!channels.inApp,
      emailPending: !!channels.email,
      record: record,
      channels: channels,
      normalized: normalized
    };
  }

  function createManyInStore_(store, inputs, options) {
    options = options || {};
    var results = [];
    var toInsert = [];
    inputs = inputs || [];
    var existingKeys = {};
    (store.list() || []).forEach(function (row) {
      if (row.dedupe_key) existingKeys[row.dedupe_key] = row;
    });
    var idFactory = options.idFactory || function () {
      return 'INB-' + String(Date.now()) + '-' + Math.floor(Math.random() * 10000);
    };
    for (var i = 0; i < inputs.length; i++) {
      var normalized = normalizeCreateInput_(inputs[i]);
      var errors = validateCreate(normalized);
      if (errors.length) {
        results.push({ ok: false, created: false, errors: errors });
        continue;
      }
      var def = getTypeDef(normalized.type);
      if (def && def.audience === 'candidate') {
        results.push({
          ok: true,
          created: false,
          candidateEmail: true,
          channels: { inApp: false, email: true },
          normalized: normalized
        });
        continue;
      }
      var key = buildDedupeKey(normalized);
      if (existingKeys[key]) {
        results.push({ ok: true, created: false, duplicate: true, record: existingKeys[key], channels: { inApp: false, email: false } });
        continue;
      }
      var pref = findPref_(options.preferences, normalized.recipient_employee_id, normalized.type);
      var channels = resolveChannels(def, pref, options.orgSettings, normalized);
      if (!channels.inApp && !channels.email) {
        results.push({ ok: true, created: false, skipped: true, reason: 'disabled', channels: channels });
        continue;
      }
      var record = toRecord_(normalized, idFactory(), options.now || new Date(), channels, key);
      existingKeys[key] = record;
      if (channels.inApp) toInsert.push(record);
      results.push({
        ok: true,
        created: !!channels.inApp,
        emailPending: !!channels.email,
        record: record,
        channels: channels,
        normalized: normalized
      });
    }
    if (toInsert.length && store.insertMany) {
      store.insertMany(toInsert);
    } else {
      toInsert.forEach(function (row) { store.insert(row); });
    }
    return results;
  }

  function markReadInStore_(store, notificationId, session, now) {
    var id = trim_(notificationId);
    if (!id) return { ok: false, error: 'notification_id is required.' };
    var rows = null;
    var row = null;
    if (store.find) {
      row = store.find(id);
    } else {
      rows = store.list() || [];
      for (var i = 0; i < rows.length; i++) {
        if (trim_(rows[i].notification_id) === id) {
          row = rows[i];
          break;
        }
      }
    }
    if (!row) return { ok: false, error: 'Notification not found.', notFound: true };
    if (!canViewInboxRow(session, row)) {
      return { ok: false, error: 'You do not have permission to update this notification.', forbidden: true };
    }
    var remaining = null;
    if (rows) {
      remaining = 0;
      rows.forEach(function (r) {
        if (canViewInboxRow(session, r) && isUnread(r)) remaining++;
      });
    }
    if (!isUnread(row)) {
      return { ok: true, changed: false, record: serializeRow(row), unread_count: remaining };
    }
    var stamp = now || new Date();
    var updated = store.update(id, { read_at: stamp, status: STATUS.READ }) || row;
    updated.read_at = stamp;
    updated.status = STATUS.READ;
    if (remaining != null) remaining = Math.max(0, remaining - 1);
    return { ok: true, changed: true, record: serializeRow(updated), unread_count: remaining };
  }

  function markAllReadInStore_(store, session, now) {
    var stamp = now || new Date();
    var rows = store.list() || [];
    var ids = [];
    rows.forEach(function (row) {
      if (canViewInboxRow(session, row) && isUnread(row)) {
        ids.push(row.notification_id);
      }
    });
    if (!ids.length) {
      return { ok: true, changed: 0, unread_count: 0 };
    }
    if (store.updateMany) {
      store.updateMany(ids, { read_at: stamp, status: STATUS.READ });
    } else {
      ids.forEach(function (nid) {
        store.update(nid, { read_at: stamp, status: STATUS.READ });
      });
    }
    return { ok: true, changed: ids.length, unread_count: 0 };
  }

  function mdFromDate_(value) {
    if (value === null || value === undefined || value === '') return '';
    if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
      var m = value.getMonth() + 1;
      var d = value.getDate();
      return (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
    }
    var s = String(value);
    var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return iso[2] + '-' + iso[3];
    var parsed = new Date(s);
    if (!isNaN(parsed.getTime())) {
      var mm = parsed.getMonth() + 1;
      var dd = parsed.getDate();
      return (mm < 10 ? '0' : '') + mm + '-' + (dd < 10 ? '0' : '') + dd;
    }
    return '';
  }

  function yearFromDate_(value) {
    if (value === null || value === undefined || value === '') return 0;
    if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
      return value.getFullYear();
    }
    var s = String(value);
    var iso = s.match(/^(\d{4})-/);
    if (iso) return Number(iso[1]);
    var parsed = new Date(s);
    return isNaN(parsed.getTime()) ? 0 : parsed.getFullYear();
  }

  function isLeapYear_(year) {
    return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  }

  function birthdayMatches(dateOfBirth, today) {
    var dobMd = mdFromDate_(dateOfBirth);
    var todayMd = mdFromDate_(today);
    if (!dobMd || !todayMd) return false;
    if (dobMd === todayMd) return true;
    if (dobMd === '02-29' && todayMd === '02-28' && !isLeapYear_(yearFromDate_(today))) {
      return true;
    }
    return false;
  }

  function anniversaryMatches(joiningDate, today) {
    var joinMd = mdFromDate_(joiningDate);
    var todayMd = mdFromDate_(today);
    if (!joinMd || !todayMd) return false;
    var joinYear = yearFromDate_(joiningDate);
    var todayYear = yearFromDate_(today);
    if (!joinYear || !todayYear || todayYear <= joinYear) return false;
    if (joinMd === todayMd) return true;
    if (joinMd === '02-29' && todayMd === '02-28' && !isLeapYear_(todayYear)) return true;
    return false;
  }

  function anniversaryYears(joiningDate, today) {
    var joinYear = yearFromDate_(joiningDate);
    var todayYear = yearFromDate_(today);
    if (!joinYear || !todayYear) return 0;
    return Math.max(0, todayYear - joinYear);
  }

  function payloadBase_(type, recipient, recordId, vars, extra) {
    extra = extra || {};
    vars = vars || {};
    var def = getTypeDef(type) || {};
    var title = extra.title || interpolate(extra.titleTemplate || def.label, vars);
    var message = extra.message || interpolate(extra.messageTemplate || '', vars);
    var action = actionFor(type, recordId, extra);
    return {
      type: type,
      title: title,
      message: message,
      recipient_employee_id: recipient && recipient.employee_id || '',
      recipient_email: recipient && recipient.email || '',
      source_module: def.module,
      source_record_id: recordId || '',
      priority: extra.priority || def.priority,
      action_route: extra.action_route || action.action_route,
      action_params: extra.action_params || action.action_params,
      dedupe_bucket: extra.dedupe_bucket || '',
      email_subject: extra.email_subject || title,
      email_body: extra.email_body || message,
      actor_employee_id: extra.actor_employee_id || '',
      force_email: extra.force_email,
      force_in_app: extra.force_in_app
    };
  }

  function buildLeaveSubmitted(rec, employee, manager) {
    var vars = {
      employee_id: employee.employee_id,
      display_name: employee.display_name || employee.employee_id,
      start_date: rec.start_date,
      end_date: rec.end_date,
      total_days: rec.total_days
    };
    return payloadBase_(TYPE.LEAVE_SUBMITTED, manager, rec.leave_request_id, vars, {
      title: 'Leave submitted for ' + vars.display_name,
      message: vars.display_name + ' (' + vars.employee_id + ') submitted leave from ' +
        vars.start_date + ' to ' + vars.end_date + ' (' + vars.total_days + ' day(s)).',
      email_body: interpolate(
        '{display_name} ({employee_id}) submitted leave from {start_date} to {end_date}.\nOpen HRMS to review this request.',
        vars
      )
    });
  }

  function buildLeaveApproved(rec, employee) {
    var vars = {
      employee_id: employee.employee_id,
      display_name: employee.display_name || employee.employee_id,
      start_date: rec.start_date,
      end_date: rec.end_date
    };
    return payloadBase_(TYPE.LEAVE_APPROVED, employee, rec.leave_request_id, vars, {
      title: 'Leave approved',
      message: 'Your leave from ' + vars.start_date + ' to ' + vars.end_date + ' was approved.',
      email_subject: 'Leave approved'
    });
  }

  function buildLeaveRejected(rec, employee) {
    var vars = {
      employee_id: employee.employee_id,
      display_name: employee.display_name || employee.employee_id,
      start_date: rec.start_date,
      end_date: rec.end_date
    };
    return payloadBase_(TYPE.LEAVE_REJECTED, employee, rec.leave_request_id, vars, {
      title: 'Leave rejected',
      message: 'Your leave from ' + vars.start_date + ' to ' + vars.end_date + ' was not approved.',
      email_subject: 'Leave rejected'
    });
  }

  function buildLeaveCancelled(rec, recipient, actorName) {
    var vars = {
      employee_id: rec.employee_id,
      display_name: rec.display_name || rec.employee_id,
      start_date: rec.start_date,
      end_date: rec.end_date,
      actor: actorName || 'HR'
    };
    return payloadBase_(TYPE.LEAVE_CANCELLED, recipient, rec.leave_request_id, vars, {
      title: 'Leave cancelled',
      message: 'Leave for ' + vars.display_name + ' from ' + vars.start_date + ' to ' +
        vars.end_date + ' was cancelled' + (actorName ? ' by ' + actorName : '') + '.'
    });
  }

  function buildPayslipAvailable(record, employee, run) {
    var period = periodLabel(run.period_year, run.period_month);
    var vars = {
      employee_id: employee.employee_id,
      display_name: employee.display_name || employee.employee_id,
      period: period
    };
    var subject = payslipSubject(run.period_year, run.period_month);
    return payloadBase_(TYPE.PAYSLIP_AVAILABLE, employee, run.payroll_run_id, vars, {
      title: subject,
      message: 'Your payslip for ' + period + ' is available in My Payslips.',
      email_subject: subject,
      email_body: 'Hello ' + vars.display_name + ',\n\nYour payslip for ' + period +
        ' is available in AyurCentral HRMS.\nOpen My Payslips to download it.\n\nEmployee ID: ' +
        vars.employee_id,
      dedupe_bucket: String(record && record.payroll_record_id || run.payroll_run_id)
    });
  }

  function buildPayrollReadyReview(run, recipient) {
    var period = periodLabel(run.period_year, run.period_month);
    return payloadBase_(TYPE.PAYROLL_READY_REVIEW, recipient, run.payroll_run_id, { period: period }, {
      title: 'Payroll ready for review — ' + period,
      message: 'The ' + period + ' payroll run is under review.',
      email_subject: 'Payroll ready for review — ' + period
    });
  }

  function buildPayrollApproved(run, recipient) {
    var period = periodLabel(run.period_year, run.period_month);
    return payloadBase_(TYPE.PAYROLL_APPROVED, recipient, run.payroll_run_id, { period: period }, {
      title: 'Payroll approved — ' + period,
      message: 'The ' + period + ' payroll run was approved.',
      email_subject: 'Payroll approved — ' + period
    });
  }

  function buildPayrollLocked(run, recipient) {
    var period = periodLabel(run.period_year, run.period_month);
    return payloadBase_(TYPE.PAYROLL_LOCKED, recipient, run.payroll_run_id, { period: period }, {
      title: 'Payroll locked — ' + period,
      message: 'The ' + period + ' payroll run is locked. Amounts will not change.',
      email_subject: 'Payroll locked — ' + period
    });
  }

  function buildPmsCycleOpen(cycle, recipient) {
    return payloadBase_(TYPE.PMS_CYCLE_OPEN, recipient, cycle.cycle_id, {
      cycle_name: cycle.name || cycle.cycle_id
    }, {
      title: 'Performance cycle open',
      message: (cycle.name || 'A performance cycle') + ' is open. Complete your self-assessment when due.'
    });
  }

  function buildPmsSelfAssessmentDue(cycle, recipient) {
    return payloadBase_(TYPE.PMS_SELF_ASSESSMENT_DUE, recipient, cycle.cycle_id, {}, {
      title: 'Self-assessment due',
      message: 'Your self-assessment is due for ' + (cycle.name || 'the current cycle') + '.',
      priority: PRIORITY.HIGH
    });
  }

  function buildPmsManagerReviewPending(cycle, recipient, employeeName) {
    return payloadBase_(TYPE.PMS_MANAGER_REVIEW_PENDING, recipient, cycle.cycle_id, {}, {
      title: 'Manager review pending',
      message: 'A review is waiting for you' + (employeeName ? ' (' + employeeName + ')' : '') + '.'
    });
  }

  function buildPmsFinalized(cycle, recipient) {
    return payloadBase_(TYPE.PMS_FINALIZED, recipient, cycle.cycle_id, {}, {
      title: 'Review finalized',
      message: 'Your review for ' + (cycle.name || 'the cycle') + ' has been finalized.'
    });
  }

  function buildAtsInternal(type, application, recipient) {
    var name = application.candidate_name || 'A candidate';
    var titles = {};
    titles[TYPE.ATS_NEW_APPLICATION] = 'New application received';
    titles[TYPE.ATS_SHORTLISTED] = name + ' shortlisted';
    titles[TYPE.ATS_INTERVIEW_SCHEDULED] = 'Interview scheduled — ' + name;
    titles[TYPE.ATS_FEEDBACK_PENDING] = 'Interview feedback pending — ' + name;
    titles[TYPE.ATS_SELECTED] = name + ' selected';
    var messages = {};
    messages[TYPE.ATS_NEW_APPLICATION] = name + ' applied for ' + (application.requisition_title || 'a role') + '.';
    messages[TYPE.ATS_SHORTLISTED] = name + ' was shortlisted for ' + (application.requisition_title || 'a role') + '.';
    messages[TYPE.ATS_INTERVIEW_SCHEDULED] = 'An interview is scheduled for ' + name + '.';
    messages[TYPE.ATS_FEEDBACK_PENDING] = 'Feedback is pending for ' + name + '.';
    messages[TYPE.ATS_SELECTED] = name + ' was selected. Complete offer steps in ATS.';
    return payloadBase_(type, recipient, application.application_id, {}, {
      title: titles[type] || 'ATS update',
      message: messages[type] || ''
    });
  }

  function buildAtsCandidateEmail(type, candidate, extra) {
    extra = extra || {};
    var def = getTypeDef(type);
    if (!def || def.audience !== 'candidate') {
      return { ok: false, errors: ['Not a candidate email type.'] };
    }
    var name = candidate.candidate_name || 'there';
    var role = extra.requisition_title || candidate.requisition_title || 'the role';
    var subject = extra.subject;
    var body = extra.body;
    if (type === TYPE.ATS_CANDIDATE_APPLICATION) {
      subject = subject || 'We received your application';
      body = body || 'Hello ' + name + ',\n\nThank you for applying for ' + role +
        '. We will contact you if there is an update.\n\nThis inbox is not an HRMS login.';
    } else if (type === TYPE.ATS_CANDIDATE_INTERVIEW) {
      subject = subject || 'Interview invitation';
      body = body || 'Hello ' + name + ',\n\nYou are invited to interview for ' + role +
        (extra.interview_at ? ' on ' + extra.interview_at : '') +
        '.\n\nReply to the recruiter email if you have questions.';
    } else {
      subject = subject || 'Update on your application';
      body = body || 'Hello ' + name + ',\n\nThere is an update on your application for ' + role + '.';
    }
    return {
      ok: true,
      type: type,
      to: lower_(candidate.candidate_email),
      subject: subject,
      body: body,
      related_entity_type: 'AtsCandidate',
      related_entity_id: candidate.application_id || '',
      internal: false
    };
  }

  function buildHappyBirthday(employee, year) {
    var name = employee.display_name || employee.employee_id;
    return payloadBase_(TYPE.HAPPY_BIRTHDAY, employee, employee.employee_id, {}, {
      title: 'Happy birthday, ' + name,
      message: 'Wishing you a happy birthday from AyurCentral.',
      dedupe_bucket: String(year || '')
    });
  }

  function buildWorkAnniversary(employee, years, year) {
    var name = employee.display_name || employee.employee_id;
    var y = Number(years) || 0;
    return payloadBase_(TYPE.WORK_ANNIVERSARY, employee, employee.employee_id, {}, {
      title: 'Work anniversary — ' + name,
      message: name + ' completes ' + y + ' year' + (y === 1 ? '' : 's') + ' with AyurCentral.',
      dedupe_bucket: String(year || '')
    });
  }

  function buildAnnouncement(type, recipient, payload) {
    payload = payload || {};
    return payloadBase_(type, recipient, payload.announcement_id || payload.batch_id || '', {}, {
      title: payload.title,
      message: payload.message,
      email_subject: payload.email_subject || payload.title,
      email_body: payload.email_body || payload.message,
      action_route: payload.action_route || '',
      action_params: payload.action_params,
      dedupe_bucket: payload.batch_id || '',
      actor_employee_id: payload.actor_employee_id,
      force_email: payload.send_email === true ? true : (payload.send_email === false ? false : undefined)
    });
  }

  function defaultPreferenceRow(employeeId, typeDef) {
    return {
      employee_id: employeeId,
      notification_type: typeDef.type,
      in_app_enabled: !!typeDef.inAppDefault,
      email_enabled: !!typeDef.emailDefault,
      label: typeDef.label,
      module: typeDef.module
    };
  }

  function mergePreferences(employeeId, savedRows) {
    savedRows = savedRows || [];
    return preferenceCatalog().map(function (def) {
      var existing = findPref_(savedRows, employeeId, def.type);
      var row = defaultPreferenceRow(employeeId, def);
      if (existing) {
        row.in_app_enabled = isTruthy(existing.in_app_enabled);
        if (isFalseyPref_(existing.in_app_enabled)) row.in_app_enabled = false;
        row.email_enabled = isTruthy(existing.email_enabled);
        if (isFalseyPref_(existing.email_enabled)) row.email_enabled = false;
        row.preference_id = existing.preference_id;
      }
      return row;
    });
  }

  function validatePreferencePatch(patch) {
    var errors = [];
    patch = patch || {};
    if (!getTypeDef(patch.notification_type)) errors.push('Unknown notification type.');
    var def = getTypeDef(patch.notification_type);
    if (def && !def.preferenceVisible) errors.push('This notification type cannot be changed.');
    return errors;
  }

  function memoryStore(seed) {
    var rows = (seed || []).slice();
    return {
      list: function () { return rows.slice(); },
      insert: function (row) { rows.push(row); return row; },
      insertMany: function (list) {
        (list || []).forEach(function (row) { rows.push(row); });
        return (list || []).length;
      },
      update: function (id, fields) {
        for (var i = 0; i < rows.length; i++) {
          if (String(rows[i].notification_id) === String(id)) {
            Object.keys(fields || {}).forEach(function (k) {
              rows[i][k] = fields[k];
            });
            return rows[i];
          }
        }
        return null;
      },
      updateMany: function (ids, fields) {
        var set = {};
        (ids || []).forEach(function (id) { set[String(id)] = true; });
        var n = 0;
        rows.forEach(function (row) {
          if (!set[String(row.notification_id)]) return;
          Object.keys(fields || {}).forEach(function (k) { row[k] = fields[k]; });
          n++;
        });
        return n;
      }
    };
  }

  return {
    PRIORITY: PRIORITY,
    STATUS: STATUS,
    EMAIL_STATUS: EMAIL_STATUS,
    MODULE: MODULE,
    TYPE: TYPE,
    catalog: catalog,
    preferenceCatalog: preferenceCatalog,
    getTypeDef: getTypeDef,
    isCandidateType: isCandidateType,
    interpolate: interpolate,
    periodLabel: periodLabel,
    payslipSubject: payslipSubject,
    payslipContainsNet: payslipContainsNet_,
    buildDedupeKey: buildDedupeKey,
    statusOf: statusOf,
    isUnread: isUnread,
    isTruthy: isTruthy,
    isHrOrAdmin: isHrOrAdmin,
    isAdmin: isAdmin,
    ownsRow: ownsRow,
    canViewInboxRow: canViewInboxRow,
    canViewEmailLog: canViewEmailLog,
    canAnnounce: canAnnounce,
    canRetryEmail: canRetryEmail,
    parseActionParams: parseActionParams,
    stringifyActionParams: stringifyActionParams,
    actionFor: actionFor,
    resolveChannels: resolveChannels,
    validateCreate: validateCreate,
    serializeRow: serializeRow,
    birthdayMatches: birthdayMatches,
    anniversaryMatches: anniversaryMatches,
    anniversaryYears: anniversaryYears,
    mergePreferences: mergePreferences,
    validatePreferencePatch: validatePreferencePatch,
    defaultPreferenceRow: defaultPreferenceRow,
    memoryStore: memoryStore,
    payloads: {
      leaveSubmitted: buildLeaveSubmitted,
      leaveApproved: buildLeaveApproved,
      leaveRejected: buildLeaveRejected,
      leaveCancelled: buildLeaveCancelled,
      payslipAvailable: buildPayslipAvailable,
      payrollReadyReview: buildPayrollReadyReview,
      payrollApproved: buildPayrollApproved,
      payrollLocked: buildPayrollLocked,
      pmsCycleOpen: buildPmsCycleOpen,
      pmsSelfAssessmentDue: buildPmsSelfAssessmentDue,
      pmsManagerReviewPending: buildPmsManagerReviewPending,
      pmsFinalized: buildPmsFinalized,
      atsInternal: buildAtsInternal,
      atsCandidateEmail: buildAtsCandidateEmail,
      happyBirthday: buildHappyBirthday,
      workAnniversary: buildWorkAnniversary,
      announcement: buildAnnouncement
    },
    inbox: {
      create: createInStore_,
      createMany: createManyInStore_,
      list: listInStore_,
      unreadCount: unreadCountInStore_,
      markRead: markReadInStore_,
      markAllRead: markAllReadInStore_
    }
  };
})();
