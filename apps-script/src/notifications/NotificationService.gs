/**
 * Notification Center service — inbox, preferences, optional MailApp.
 * Does not use LockService. Duplicate prevention is dedupe_key on insert.
 * Email failure never rolls back inbox rows.
 */
var HRMS = HRMS || {};

var NotificationService = (function () {
  var schemaReady_ = false;
  var EMAIL_BATCH_LIMIT_ = 40;

  function ensure_() {
    if (schemaReady_) {
      if (typeof HrmsPerf !== 'undefined' && HrmsPerf.mark) {
        HrmsPerf.mark('ensure.skip');
      }
      return;
    }
    try {
      NotificationSchema.ensureSheets();
      schemaReady_ = true;
    } catch (e) {
      if (e && e.hrmsCode) throw e;
      throw configurationError_(
        'Notification Center is not set up yet. Run database setup or HRMS → Ensure notification sheets from the spreadsheet menu.'
      );
    }
  }

  function now_() {
    return new Date();
  }

  function trim_(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
  }

  function lower_(v) {
    return trim_(v).toLowerCase();
  }

  function requireAccess_() {
    return PermissionService.require(HRMS.ACTIONS.ACCESS_APP);
  }

  function orgSettings_() {
    var leaveOn = true;
    var payrollOn = true;
    try {
      leaveOn = ConfigService.getSetting('notification_leave', true);
      payrollOn = ConfigService.getSetting('notification_payroll', true);
    } catch (ignore) {}
    return {
      notification_leave: leaveOn,
      notification_payroll: payrollOn
    };
  }

  function companyName_() {
    try {
      return ConfigService.getCompanyName();
    } catch (e) {
      return 'AyurCentral HRMS';
    }
  }

  var INBOX_UNREAD_COLS_ = [
    'notification_id', 'recipient_employee_id', 'recipient_email', 'status', 'read_at'
  ];

  function sheetStore_() {
    var name = NotificationSchema.INBOX;
    return {
      list: function () {
        return DbService.getAllRecords(name);
      },
      insert: function (row) {
        return DbService.insertRecord(name, row);
      },
      insertMany: function (rows) {
        return DbService.insertRecords(name, rows);
      },
      find: function (id) {
        return DbService.findOne(name, { notification_id: id });
      },
      update: function (id, fields) {
        return DbService.updateRecord(name, 'notification_id', id, fields);
      },
      updateMany: function (ids, fields) {
        var items = (ids || []).map(function (id) {
          return { pk: id, updates: fields };
        });
        return DbService.updateRecords(name, 'notification_id', items);
      }
    };
  }

  function idFactory_() {
    return DbService.generateId('INB');
  }

  function loadPreferences_(employeeId) {
    var filter = employeeId ? { employee_id: employeeId } : null;
    var rows = filter
      ? DbService.findRecords(NotificationSchema.PREFS, filter)
      : DbService.getAllRecords(NotificationSchema.PREFS);
    return rows || [];
  }

  function runtimeCtx_(employeeId) {
    return {
      now: now_(),
      idFactory: idFactory_,
      preferences: loadPreferences_(employeeId),
      orgSettings: orgSettings_()
    };
  }

  function getEmployee_(employeeId) {
    if (!trim_(employeeId)) return null;
    return DbService.findOne(HRMS.SHEETS.EMPLOYEES, { employee_id: employeeId });
  }

  function getUserByEmail_(email) {
    if (!lower_(email)) return null;
    return DbService.findOne(HRMS.SHEETS.USERS, { google_email: lower_(email) });
  }

  function getUserByEmployeeId_(employeeId) {
    var id = trim_(employeeId);
    if (!id) return null;
    return DbService.findOne(HRMS.SHEETS.USERS, { employee_id: id });
  }

  function bestRecipientEmail_(emp, hintEmail) {
    var work = lower_(emp && emp.work_email);
    if (work) return work;
    var user = getUserByEmployeeId_(emp && emp.employee_id);
    if (user && lower_(user.google_email)) return lower_(user.google_email);
    return lower_(hintEmail);
  }

  /**
   * Resolve recipient to employee_id + email without exposing salary/PII beyond work_email.
   */
  function resolveRecipient(hint) {
    hint = hint || {};
    var employeeId = trim_(hint.employee_id || hint.recipient_employee_id);
    var email = lower_(hint.email || hint.recipient_email || hint.work_email);
    var emp = employeeId ? getEmployee_(employeeId) : null;
    if (!emp && email) {
      var user = getUserByEmail_(email);
      if (user && user.employee_id) {
        emp = getEmployee_(user.employee_id);
      }
    }
    if (emp) {
      return {
        employee_id: trim_(emp.employee_id),
        email: bestRecipientEmail_(emp, email),
        display_name: trim_(emp.display_name) || trim_(emp.first_name + ' ' + emp.last_name),
        status: emp.status,
        manager_employee_id: trim_(emp.manager_employee_id),
        date_of_birth: emp.date_of_birth,
        joining_date: emp.joining_date
      };
    }
    if (email) {
      var u = getUserByEmail_(email);
      return {
        employee_id: u ? trim_(u.employee_id) : employeeId,
        email: email,
        display_name: email,
        status: u ? u.status : '',
        manager_employee_id: '',
        date_of_birth: '',
        joining_date: ''
      };
    }
    return null;
  }

  function listHrAdminRecipients() {
    var users = DbService.getAllRecords(HRMS.SHEETS.USERS) || [];
    var out = [];
    var seen = {};
    users.forEach(function (u) {
      if (String(u.status || '').toUpperCase() !== 'ACTIVE') return;
      var role = String(u.role || '').toUpperCase();
      if (role !== 'HR' && role !== 'ADMIN') return;
      var rec = resolveRecipient({ employee_id: u.employee_id, email: u.google_email });
      if (!rec) return;
      var key = rec.employee_id || rec.email;
      if (!key || seen[key]) return;
      seen[key] = true;
      out.push(rec);
    });
    return out;
  }

  function writeEmailLog_(payload) {
    var row = {
      notification_id: DbService.generateId('NTF'),
      event_type: payload.event_type,
      recipient_email: payload.recipient_email || '',
      employee_id: payload.employee_id || '',
      subject: payload.subject || '',
      status: payload.status || NotificationEngine.EMAIL_STATUS.PENDING,
      error_message: String(payload.error_message || '').substring(0, 300),
      related_entity_type: payload.related_entity_type || '',
      related_entity_id: payload.related_entity_id || '',
      created_at: now_(),
      sent_at: payload.sent_at || ''
    };
    try {
      DbService.insertRecord(NotificationSchema.EMAIL_LOG, row);
      return row;
    } catch (e) {
      Logger.log('Notification email log write failed: ' + (e.message || e));
      return row;
    }
  }

  function updateEmailLog_(logId, fields) {
    if (!logId) return;
    try {
      DbService.updateRecord(NotificationSchema.EMAIL_LOG, 'notification_id', logId, fields);
    } catch (ignore) {}
  }

  function sendMail_(to, subject, body) {
    if (typeof NotificationService !== 'undefined' && NotificationService._testSendEmail) {
      return NotificationService._testSendEmail(to, subject, body);
    }
    MailApp.sendEmail({
      to: String(to).trim(),
      subject: subject,
      body: body
    });
  }

  function deliverEmail_(record, normalized) {
    var to = trim_(record.recipient_email);
    var subject = (normalized && normalized.email_subject) || record.title;
    var body = (normalized && normalized.email_body) || record.message || subject;
    var company = companyName_();
    if (body.indexOf(company) < 0) {
      body = body + '\n\n— ' + company;
    }
    var log = writeEmailLog_({
      event_type: record.type,
      recipient_email: to,
      employee_id: record.recipient_employee_id,
      subject: subject,
      status: NotificationEngine.EMAIL_STATUS.PENDING,
      related_entity_type: record.source_module,
      related_entity_id: record.source_record_id
    });
    var status = NotificationEngine.EMAIL_STATUS.PENDING;
    var errorMessage = '';
    var sentAt = '';
    if (!to) {
      status = NotificationEngine.EMAIL_STATUS.NO_EMAIL;
      errorMessage = 'NO_EMAIL';
    } else {
      try {
        sendMail_(to, subject, body);
        status = NotificationEngine.EMAIL_STATUS.SENT;
        sentAt = now_();
      } catch (e) {
        status = NotificationEngine.EMAIL_STATUS.FAILED;
        errorMessage = String(e.message || e).substring(0, 300);
      }
    }
    updateEmailLog_(log.notification_id, {
      status: status,
      error_message: errorMessage,
      sent_at: sentAt
    });
    if (record.notification_id && record.created) {
      try {
        DbService.updateRecord(NotificationSchema.INBOX, 'notification_id', record.notification_id, {
          email_status: status,
          email_log_id: log.notification_id
        });
      } catch (ignore) {}
    } else if (record.notification_id) {
      try {
        DbService.updateRecord(NotificationSchema.INBOX, 'notification_id', record.notification_id, {
          email_status: status,
          email_log_id: log.notification_id
        });
      } catch (ignore) {}
    }
    return { status: status, error_message: errorMessage, email_log_id: log.notification_id };
  }

  function maybeAuditCreate_(type, record, count) {
    var def = NotificationEngine.getTypeDef(type);
    if (!def || !def.auditCreate) return;
    try {
      AuditService.log(
        'NOTIFICATION_CREATE',
        'NotificationInbox',
        record && record.notification_id || type,
        (def.label || type) + (count && count > 1 ? ' × ' + count : ''),
        record && record.recipient_employee_id || ''
      );
    } catch (ignore) {}
  }

  /**
   * Server-side create (adapters / modules). Not a browser RPC.
   * @param {Object} input
   * @return {Object}
   */
  function createNotification(input) {
    ensure_();
    input = input || {};
    if (!trim_(input.recipient_email) || !trim_(input.recipient_employee_id)) {
      var resolved = resolveRecipient(input);
      if (resolved) {
        input.recipient_employee_id = input.recipient_employee_id || resolved.employee_id;
        input.recipient_email = input.recipient_email || resolved.email;
      }
    }
    var store = sheetStore_();
    var result = NotificationEngine.inbox.create(store, input, runtimeCtx_(input.recipient_employee_id));
    if (!result.ok) {
      throw validationError_(result.errors.join(' '));
    }
    if (result.duplicate) {
      return {
        ok: true,
        created: false,
        duplicate: true,
        notification: NotificationEngine.serializeRow(result.record)
      };
    }
    if (result.skipped) {
      return { ok: true, created: false, skipped: true, reason: result.reason };
    }
    if (result.emailPending && result.record) {
      var mail = deliverEmail_(result.record, result.normalized);
      result.record.email_status = mail.status;
      result.record.email_log_id = mail.email_log_id;
    }
    maybeAuditCreate_(input.type, result.record, 1);
    return {
      ok: true,
      created: !!result.created,
      email_status: result.record ? result.record.email_status : '',
      notification: NotificationEngine.serializeRow(result.record)
    };
  }

  /**
   * Batch create. Emails are sent after inbox inserts, up to EMAIL_BATCH_LIMIT_.
   * Remainder stays PENDING for processPendingEmails.
   * @param {Array.<Object>} inputs
   * @return {Object}
   */
  function createNotifications(inputs) {
    ensure_();
    inputs = inputs || [];
    var prepared = inputs.map(function (input) {
      input = input || {};
      if (!trim_(input.recipient_email) || !trim_(input.recipient_employee_id)) {
        var resolved = resolveRecipient(input);
        if (resolved) {
          input.recipient_employee_id = input.recipient_employee_id || resolved.employee_id;
          input.recipient_email = input.recipient_email || resolved.email;
        }
      }
      return input;
    });
    var prefs = loadPreferences_('');
    var store = sheetStore_();
    var results = NotificationEngine.inbox.createMany(store, prepared, {
      now: now_(),
      idFactory: idFactory_,
      preferences: prefs,
      orgSettings: orgSettings_()
    });
    var created = 0;
    var duplicates = 0;
    var emailed = 0;
    var pendingEmail = [];
    results.forEach(function (r) {
      if (r.duplicate) duplicates++;
      if (r.created) created++;
      if (r.emailPending && r.record) pendingEmail.push(r);
    });
    var sendCap = EMAIL_BATCH_LIMIT_;
    for (var i = 0; i < pendingEmail.length && i < sendCap; i++) {
      var mail = deliverEmail_(pendingEmail[i].record, pendingEmail[i].normalized);
      pendingEmail[i].record.email_status = mail.status;
      emailed++;
    }
    if (created && NotificationEngine.getTypeDef(prepared[0] && prepared[0].type)) {
      maybeAuditCreate_(prepared[0].type, pendingEmail[0] && pendingEmail[0].record, created);
    }
    return {
      ok: true,
      created: created,
      duplicates: duplicates,
      emailed: emailed,
      email_queued: Math.max(0, pendingEmail.length - emailed),
      results: results
    };
  }

  function getNotifications(session, query) {
    session = session || requireAccess_();
    return NotificationEngine.inbox.list(sheetStore_(), session, query || {});
  }

  function getUnreadCount(session) {
    session = session || requireAccess_();
    var rows;
    try {
      rows = DbService.getProjectedRecords(NotificationSchema.INBOX, INBOX_UNREAD_COLS_);
    } catch (e) {
      return NotificationEngine.inbox.unreadCount(sheetStore_(), session);
    }
    return NotificationEngine.inbox.unreadCount({
      list: function () { return rows; }
    }, session);
  }

  function markNotificationRead(session, notificationId) {
    var t0 = Date.now();
    session = session || requireAccess_();
    var result = NotificationEngine.inbox.markRead(sheetStore_(), notificationId, session, now_());
    if (typeof HrmsPerf !== 'undefined') {
      HrmsPerf.addStage('business', Date.now() - t0);
      HrmsPerf.mark('ntf.markReadDone');
    }
    if (result.forbidden) throw authorizationError_(result.error);
    if (result.notFound) throw notFoundError_(result.error);
    if (!result.ok) throw validationError_(result.error || 'Unable to mark read.');
    if (result.unread_count == null) {
      result.unread_count = getUnreadCount(session);
    }
    return result;
  }

  function markAllNotificationsRead(session) {
    var t0 = Date.now();
    session = session || requireAccess_();
    var result = NotificationEngine.inbox.markAllRead(sheetStore_(), session, now_());
    if (typeof HrmsPerf !== 'undefined') {
      HrmsPerf.addStage('business', Date.now() - t0);
      HrmsPerf.mark('ntf.markAllReadDone');
    }
    return result;
  }

  function getBellState(session, limit) {
    session = session || requireAccess_();
    var listed = getNotifications(session, { limit: limit || 8 });
    if (typeof HrmsPerf !== 'undefined' && HrmsPerf.mark) {
      HrmsPerf.mark('ntf.bellStateDone');
    }
    return {
      unread_count: listed.unread_count,
      items: listed.items
    };
  }

  function getPreferences(session) {
    session = session || requireAccess_();
    var empId = trim_(session.employee_id);
    return NotificationEngine.mergePreferences(empId, loadPreferences_(empId));
  }

  function savePreferences(session, patches) {
    ensure_();
    session = session || requireAccess_();
    var empId = trim_(session.employee_id);
    if (!empId) {
      throw validationError_('An employee record is required to save notification preferences.');
    }
    patches = patches || [];
    if (Object.prototype.toString.call(patches) !== '[object Array]') {
      patches = [patches];
    }
    var saved = [];
    patches.forEach(function (patch) {
      patch = patch || {};
      patch.notification_type = trim_(patch.notification_type).toUpperCase();
      var errors = NotificationEngine.validatePreferencePatch(patch);
      if (errors.length) throw validationError_(errors.join(' '));
      var existing = DbService.findRecords(NotificationSchema.PREFS, {
        employee_id: empId,
        notification_type: patch.notification_type
      })[0];
      var inApp = patch.in_app_enabled;
      var email = patch.email_enabled;
      if (existing) {
        var updates = { updated_at: now_() };
        if (inApp !== undefined) updates.in_app_enabled = !!inApp;
        if (email !== undefined) updates.email_enabled = !!email;
        saved.push(DbService.updateRecord(NotificationSchema.PREFS, 'preference_id', existing.preference_id, updates));
      } else {
        var def = NotificationEngine.getTypeDef(patch.notification_type);
        var row = {
          preference_id: DbService.generateId('NPF'),
          employee_id: empId,
          notification_type: patch.notification_type,
          in_app_enabled: inApp === undefined ? !!def.inAppDefault : !!inApp,
          email_enabled: email === undefined ? !!def.emailDefault : !!email,
          updated_at: now_()
        };
        DbService.insertRecord(NotificationSchema.PREFS, row);
        saved.push(row);
      }
    });
    return { ok: true, preferences: getPreferences(session), saved: saved.length };
  }

  function createAnnouncement(session, payload) {
    session = session || requireAccess_();
    if (!NotificationEngine.canAnnounce(session)) {
      throw authorizationError_('Only HR or Admin can send announcements.');
    }
    payload = payload || {};
    var type = trim_(payload.type).toUpperCase() || NotificationEngine.TYPE.HR_ANNOUNCEMENT;
    var allowed = [
      NotificationEngine.TYPE.HR_ANNOUNCEMENT,
      NotificationEngine.TYPE.POLICY_ANNOUNCEMENT,
      NotificationEngine.TYPE.SYSTEM_ANNOUNCEMENT
    ];
    if (allowed.indexOf(type) < 0) {
      throw validationError_('Announcement type must be HR, policy, or system.');
    }
    if (!trim_(payload.title)) throw validationError_('Title is required.');
    var batchId = trim_(payload.batch_id) || DbService.generateId('ANN');
    var audience = trim_(payload.audience || 'ALL').toUpperCase();
    var targets = [];
    var employees = DbService.getAllRecords(HRMS.SHEETS.EMPLOYEES) || [];
    var users = DbService.getAllRecords(HRMS.SHEETS.USERS) || [];
    var userByEmp = {};
    users.forEach(function (u) {
      if (u.employee_id) userByEmp[trim_(u.employee_id)] = u;
    });

    function includeEmp_(emp) {
      if (!emp || String(emp.status || '').toUpperCase() !== 'ACTIVE') return;
      var rec = resolveRecipient({ employee_id: emp.employee_id, email: emp.work_email });
      if (rec) targets.push(rec);
    }

    if (audience === 'EMPLOYEE_IDS') {
      var ids = payload.employee_ids || [];
      ids.forEach(function (id) {
        includeEmp_(getEmployee_(id));
      });
    } else if (audience === 'ROLE') {
      var roles = (payload.roles || []).map(function (r) { return String(r).toUpperCase(); });
      employees.forEach(function (emp) {
        var u = userByEmp[trim_(emp.employee_id)];
        if (u && roles.indexOf(String(u.role || '').toUpperCase()) >= 0) includeEmp_(emp);
      });
    } else {
      employees.forEach(includeEmp_);
    }

    if (!targets.length) {
      throw validationError_(
        'No active employees matched this audience. Ensure Employees are ACTIVE and linked to Users with email addresses.'
      );
    }

    var inputs = targets.map(function (rec) {
      return NotificationEngine.payloads.announcement(type, rec, {
        title: payload.title,
        message: payload.message || '',
        batch_id: batchId,
        announcement_id: batchId,
        action_route: payload.action_route,
        send_email: !!payload.send_email,
        actor_employee_id: session.employee_id
      });
    });
    var result = createNotifications(inputs);
    try {
      AuditService.log(
        'NOTIFICATION_ANNOUNCE',
        'NotificationInbox',
        batchId,
        type + ' to ' + result.created + ' recipient(s): ' + String(payload.title).substring(0, 80),
        session.employee_id
      );
    } catch (ignore) {}
    return {
      ok: true,
      batch_id: batchId,
      targeted: targets.length,
      created: result.created,
      duplicates: result.duplicates,
      emailed: result.emailed
    };
  }

  function listEmailLog(session, query) {
    session = session || requireAccess_();
    if (!NotificationEngine.canViewEmailLog(session)) {
      throw authorizationError_('Only HR or Admin can view the notification email log.');
    }
    query = query || {};
    var rows = DbService.getAllRecords(NotificationSchema.EMAIL_LOG) || [];
    if (query.status) {
      var st = trim_(query.status).toUpperCase();
      rows = rows.filter(function (r) { return String(r.status || '').toUpperCase() === st; });
    }
    if (query.event_type) {
      var et = trim_(query.event_type).toUpperCase();
      rows = rows.filter(function (r) { return String(r.event_type || '').toUpperCase() === et; });
    }
    rows.sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
    var failed = rows.filter(function (r) {
      var s = String(r.status || '').toUpperCase();
      return s === 'FAILED' || s === 'NO_EMAIL';
    }).length;
    var limit = query.limit == null ? 50 : Number(query.limit);
    if (limit > 200) limit = 200;
    return {
      items: rows.slice(0, limit),
      total: rows.length,
      failed_count: failed
    };
  }

  function countFailedEmails() {
    ensure_();
    var rows = DbService.getAllRecords(NotificationSchema.EMAIL_LOG) || [];
    var n = 0;
    rows.forEach(function (r) {
      var s = String(r.status || '').toUpperCase();
      if (s === 'FAILED' || s === 'NO_EMAIL') n++;
    });
    return n;
  }

  function retryEmail(session, emailLogId) {
    session = session || requireAccess_();
    if (!NotificationEngine.canRetryEmail(session)) {
      throw authorizationError_('Only HR or Admin can retry notification emails.');
    }
    var row = DbService.findOne(NotificationSchema.EMAIL_LOG, { notification_id: emailLogId });
    if (!row) throw notFoundError_('Email log row not found.');
    var status = String(row.status || '').toUpperCase();
    if (status !== 'FAILED' && status !== 'NO_EMAIL' && status !== 'PENDING') {
      throw validationError_('Only failed or pending emails can be retried.');
    }
    var to = trim_(row.recipient_email);
    var newStatus = NotificationEngine.EMAIL_STATUS.FAILED;
    var errorMessage = '';
    var sentAt = '';
    if (!to) {
      newStatus = NotificationEngine.EMAIL_STATUS.NO_EMAIL;
      errorMessage = 'NO_EMAIL';
    } else {
      try {
        sendMail_(to, row.subject, row.subject + '\n\nOpen HRMS to continue.\nEmployee ID: ' + (row.employee_id || ''));
        newStatus = NotificationEngine.EMAIL_STATUS.SENT;
        sentAt = now_();
      } catch (e) {
        newStatus = NotificationEngine.EMAIL_STATUS.FAILED;
        errorMessage = String(e.message || e).substring(0, 300);
      }
    }
    DbService.updateRecord(NotificationSchema.EMAIL_LOG, 'notification_id', emailLogId, {
      status: newStatus,
      error_message: errorMessage,
      sent_at: sentAt
    });
    try {
      AuditService.log('NOTIFICATION_RETRY', 'Notifications', emailLogId,
        'Retry email ' + row.event_type + ' → ' + newStatus, row.employee_id);
    } catch (ignore) {}
    return { ok: true, status: newStatus, error_message: errorMessage };
  }

  /**
   * Send PENDING inbox emails (payslip follow-up). No script lock.
   * @param {Object=} opts { limit: number }
   */
  function processPendingEmails(opts) {
    ensure_();
    opts = opts || {};
    var limit = Number(opts.limit) || EMAIL_BATCH_LIMIT_;
    var rows = DbService.findRecords(NotificationSchema.INBOX, {
      email_status: NotificationEngine.EMAIL_STATUS.PENDING
    }) || [];
    var sent = 0;
    var failed = 0;
    for (var i = 0; i < rows.length && i < limit; i++) {
      var mail = deliverEmail_(rows[i], {
        email_subject: rows[i].title,
        email_body: rows[i].message
      });
      if (mail.status === NotificationEngine.EMAIL_STATUS.SENT) sent++;
      else failed++;
    }
    return { ok: true, processed: sent + failed, sent: sent, failed: failed };
  }

  /**
   * Send a candidate-facing email without creating an HRMS inbox row.
   */
  function sendCandidateEmail(payload) {
    ensure_();
    payload = payload || {};
    if (!payload.to) {
      return { ok: false, status: NotificationEngine.EMAIL_STATUS.NO_EMAIL, error_message: 'NO_EMAIL' };
    }
    var log = writeEmailLog_({
      event_type: payload.type || 'ATS_CANDIDATE',
      recipient_email: payload.to,
      employee_id: '',
      subject: payload.subject,
      status: NotificationEngine.EMAIL_STATUS.PENDING,
      related_entity_type: payload.related_entity_type || 'AtsCandidate',
      related_entity_id: payload.related_entity_id || ''
    });
    var status = NotificationEngine.EMAIL_STATUS.SENT;
    var errorMessage = '';
    var sentAt = now_();
    try {
      sendMail_(payload.to, payload.subject, payload.body);
    } catch (e) {
      status = NotificationEngine.EMAIL_STATUS.FAILED;
      errorMessage = String(e.message || e).substring(0, 300);
      sentAt = '';
    }
    updateEmailLog_(log.notification_id, {
      status: status,
      error_message: errorMessage,
      sent_at: sentAt
    });
    return { ok: status === NotificationEngine.EMAIL_STATUS.SENT, status: status, error_message: errorMessage };
  }

  function catalogForClient(session) {
    session = session || {};
    return {
      types: NotificationEngine.preferenceCatalog(),
      can_announce: NotificationEngine.canAnnounce(session),
      can_view_email_log: NotificationEngine.canViewEmailLog(session)
    };
  }

  return {
    createNotification: createNotification,
    createNotifications: createNotifications,
    getNotifications: getNotifications,
    getUnreadCount: getUnreadCount,
    markNotificationRead: markNotificationRead,
    markAllNotificationsRead: markAllNotificationsRead,
    getBellState: getBellState,
    getPreferences: getPreferences,
    savePreferences: savePreferences,
    createAnnouncement: createAnnouncement,
    listEmailLog: listEmailLog,
    countFailedEmails: countFailedEmails,
    retryEmail: retryEmail,
    processPendingEmails: processPendingEmails,
    sendCandidateEmail: sendCandidateEmail,
    resolveRecipient: resolveRecipient,
    listHrAdminRecipients: listHrAdminRecipients,
    catalogForClient: catalogForClient,
    ensureSchema: ensure_,
    EMAIL_BATCH_LIMIT: EMAIL_BATCH_LIMIT_,
    _testSendEmail: null
  };
})();
