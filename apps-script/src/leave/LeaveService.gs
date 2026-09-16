/**
 * Leave business service — types, balances, workflow, grants.
 * Employee master is read-only via employee_id. Does not own Employees CRUD.
 */
var HRMS = HRMS || {};

var LeaveService = (function () {
  function now_() {
    return new Date();
  }

  function countMethod_() {
    return String(ConfigService.getSetting('leave_count_method', HRMS.LEAVE_COUNT.WEEKDAYS_ONLY) || HRMS.LEAVE_COUNT.WEEKDAYS_ONLY).toUpperCase();
  }

  function leaveYearStartMonth_() {
    return LeaveEngine.toNumber(ConfigService.getSetting('leave_year_start_month', 1), 1);
  }

  function todayDateOnly_() {
    try {
      if (typeof ConfigService !== 'undefined' && ConfigService.getTimezone && typeof Utilities !== 'undefined') {
        var iso = Utilities.formatDate(now_(), ConfigService.getTimezone() || 'Asia/Kolkata', 'yyyy-MM-dd');
        var parsed = LeaveEngine.toDateOnly(iso);
        if (parsed) return parsed;
      }
    } catch (ignore) {}
    return LeaveEngine.toDateOnly(now_()) || now_();
  }

  function currentLeaveYear_(asOf) {
    return LeaveEngine.getLeaveYear(asOf || todayDateOnly_(), leaveYearStartMonth_());
  }

  function notificationsEnabled_() {
    return LeaveEngine.isTruthy(ConfigService.getSetting('notification_leave', true));
  }

  /**
   * Sequence increment. Caller MUST already hold the script lock (avoid nested LockService).
   */
  function nextSeqLocked_(settingKey) {
    if (DbService.nextSequenceAssumingLocked) {
      return DbService.nextSequenceAssumingLocked(settingKey);
    }
    ConfigService.clearSettingsCache();
    var row = DbService.findOne(HRMS.SHEETS.SETTINGS, { setting_key: settingKey });
    if (!row) {
      throw configurationError_('Missing settings sequence: ' + settingKey + '. Re-run database setup.');
    }
    var next = Number(row.setting_value) + 1;
    if (isNaN(next) || next < 1) next = 1;
    DbService.updateRecord(HRMS.SHEETS.SETTINGS, 'setting_key', settingKey, {
      setting_value: String(next),
      updated_at: now_(),
      updated_by_email: AuthService.getSessionEmail() || 'system'
    });
    ConfigService.clearSettingsCache();
    return next;
  }

  function pad_(n, width) {
    var s = String(n);
    while (s.length < width) s = '0' + s;
    return s;
  }

  function nextLeaveTypeIdLocked_() {
    return 'LT' + pad_(nextSeqLocked_('seq_leave_type'), 3);
  }

  function nextLeaveRequestIdLocked_() {
    return 'LR' + pad_(nextSeqLocked_('seq_leave_request'), 5);
  }

  function nextLeaveBalanceIdLocked_() {
    return 'LB' + pad_(nextSeqLocked_('seq_leave_balance'), 5);
  }

  function getEmployee_(employeeId) {
    if (!employeeId) return null;
    if (typeof EmployeeService !== 'undefined' && EmployeeService.getMasterRecord) {
      return EmployeeService.getMasterRecord(employeeId);
    }
    return DbService.findOne(HRMS.SHEETS.EMPLOYEES, { employee_id: employeeId });
  }

  function requireEmployee_(employeeId) {
    var emp = getEmployee_(employeeId);
    if (!emp) {
      throw notFoundError_('Employee not found: ' + employeeId);
    }
    return emp;
  }

  function applicantUserRole_(employeeId) {
    if (typeof EmployeeRepository !== 'undefined' && EmployeeRepository.findUserByEmployeeId) {
      var norm = LeaveEngine.normalizeEmployeeId(employeeId);
      var user = EmployeeRepository.findUserByEmployeeId(norm) ||
        EmployeeRepository.findUserByEmployeeId(employeeId);
      if (user && user.role) return String(user.role).trim().toUpperCase();
    }
    return HRMS.ROLES.EMPLOYEE;
  }

  /** True when Employees.manager_employee_id resolves to an ACTIVE employee (stage-1 queue). */
  function hasActiveReportingManager_(emp) {
    if (!emp) return false;
    var mgrId = LeaveEngine.normalizeEmployeeId(emp.manager_employee_id);
    if (!mgrId) return false;
    var mgr = getEmployee_(mgrId);
    return !!mgr && String(mgr.status || '').toUpperCase() === 'ACTIVE';
  }

  function publicEmployee_(emp) {
    if (!emp) return null;
    return {
      employee_id: emp.employee_id,
      display_name: employeeDisplayName_(emp),
      department: emp.department,
      designation: emp.designation,
      status: emp.status,
      manager_employee_id: emp.manager_employee_id,
      joining_date: LeaveEngine.formatIsoDate(emp.joining_date),
      work_email: emp.work_email
    };
  }

  function employeeDisplayName_(emp) {
    if (!emp) return '';
    var dn = String(emp.display_name || '').trim();
    if (dn) return dn;
    return String((emp.first_name || '') + ' ' + (emp.last_name || '')).trim() || String(emp.employee_id || '');
  }

  function leaveDecisionNotifySettings_() {
    return {
      notifyEmployee: LeaveEngine.isTruthy(ConfigService.getSetting('leave_decision_notify_employee', true)),
      notifyManager: LeaveEngine.isTruthy(ConfigService.getSetting('leave_decision_notify_manager', true)),
      notifyAdditionalEnabled: LeaveEngine.isTruthy(ConfigService.getSetting('leave_decision_notify_additional_enabled', false)),
      additionalEmail: String(ConfigService.getSetting('leave_decision_notify_additional_email', '') || '').trim()
    };
  }

  function buildLeaveDecisionEmailBody_(emp, type, req, statusLabel, comment) {
    var name = employeeDisplayName_(emp);
    var typeLabel = type ? (type.name || type.code || '') : '';
    var lines = [
      'Employee Name: ' + name,
      'Leave Type: ' + typeLabel,
      'Leave Dates: ' + LeaveEngine.formatIsoDate(req.start_date) + ' to ' + LeaveEngine.formatIsoDate(req.end_date),
      'Number of Days: ' + LeaveEngine.toNumber(req.total_days),
      'Status: ' + statusLabel
    ];
    if (comment) lines.push('Reason: ' + String(comment));
    lines.push('', 'Open HRMS for details.');
    return lines.join('\n');
  }

  function resolveLeaveDecisionEmailRecipients_(emp) {
    var cfg = leaveDecisionNotifySettings_();
    var seen = {};
    var out = [];
    function add(email) {
      var e = String(email || '').trim();
      if (!e) return;
      var key = e.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      out.push({ email: e });
    }
    if (cfg.notifyEmployee) add(emp && emp.work_email);
    if (cfg.notifyManager) add(managerWorkEmail_(emp));
    if (cfg.notifyAdditionalEnabled) add(cfg.additionalEmail);
    return out;
  }

  function sendLeaveDecisionEmail_(eventType, recipientEmail, subject, body, employeeId, entityId) {
    var status = 'PENDING';
    var errorMessage = '';
    var sentAt = '';
    if (!notificationsEnabled_()) {
      status = 'SKIPPED';
      errorMessage = 'notification_leave disabled';
    } else if (!recipientEmail) {
      status = 'FAILED';
      errorMessage = 'NO_EMAIL';
    } else {
      try {
        MailApp.sendEmail({
          to: String(recipientEmail).trim(),
          subject: subject,
          body: body
        });
        status = 'SENT';
        sentAt = now_();
      } catch (e) {
        status = 'FAILED';
        errorMessage = String(e.message || e).substring(0, 300);
      }
    }
    try {
      DbService.insertRecord(HRMS.SHEETS.NOTIFICATIONS, {
        notification_id: DbService.generateId('NTF'),
        event_type: eventType,
        recipient_email: recipientEmail || '',
        employee_id: employeeId,
        subject: subject,
        status: status,
        error_message: errorMessage,
        related_entity_type: 'LeaveRequest',
        related_entity_id: entityId,
        created_at: now_(),
        sent_at: sentAt
      });
    } catch (ignore) {}
    return { status: status, error_message: errorMessage };
  }

  function dispatchLeaveDecisionNotifications_(leaveRequestId, eventType, comment) {
    var row = DbService.findOne(HRMS.SHEETS.LEAVE_REQUESTS, { leave_request_id: leaveRequestId });
    if (!row) return;
    var emp = getEmployee_(row.employee_id);
    if (!emp) return;
    var type = coerceType_(getType_(row.leave_type_id));
    var approved = String(eventType).toUpperCase() === 'LEAVE_APPROVED';
    var subject = approved ? 'Leave approved' : 'Leave rejected';
    var statusLabel = approved ? 'Approved' : 'Rejected';
    var body = buildLeaveDecisionEmailBody_(emp, type, row, statusLabel, comment);
    resolveLeaveDecisionEmailRecipients_(emp).forEach(function (r) {
      sendLeaveDecisionEmail_(eventType, r.email, subject, body, emp.employee_id, leaveRequestId);
    });
    var mgr = emp.manager_employee_id ? getEmployee_(emp.manager_employee_id) : null;
    fireLeaveInbox_(function () {
      if (approved) {
        NotificationLeaveAdapter.notifyApproved(row, emp, { email_body: body, decision_comment: comment });
        NotificationLeaveAdapter.notifyLeaveDecisionToManager(row, emp, mgr, 'approved', { email_body: body, comment: comment });
        NotificationLeaveAdapter.notifyLeaveDecisionToAdditional(row, emp, 'approved', { email_body: body, comment: comment });
      } else {
        NotificationLeaveAdapter.notifyRejected(row, emp, { email_body: body, decision_comment: comment });
        NotificationLeaveAdapter.notifyLeaveDecisionToManager(row, emp, mgr, 'rejected', { email_body: body, comment: comment });
        NotificationLeaveAdapter.notifyLeaveDecisionToAdditional(row, emp, 'rejected', { email_body: body, comment: comment });
      }
    });
  }

  function getType_(leaveTypeId) {
    return DbService.findOne(HRMS.SHEETS.LEAVE_TYPES, { leave_type_id: leaveTypeId });
  }

  function coerceType_(row) {
    if (!row) return null;
    return {
      leave_type_id: row.leave_type_id,
      code: row.code,
      name: row.name,
      is_paid: LeaveEngine.isTruthy(row.is_paid),
      requires_balance: LeaveEngine.isTruthy(row.requires_balance),
      allow_half_day: LeaveEngine.isTruthy(row.allow_half_day),
      counts_as_lop: LeaveEngine.isTruthy(row.counts_as_lop),
      annual_entitlement_days: LeaveEngine.toNumber(row.annual_entitlement_days),
      carry_forward_max_days: LeaveEngine.toNumber(row.carry_forward_max_days),
      max_consecutive_days: row.max_consecutive_days === '' || row.max_consecutive_days == null
        ? null
        : LeaveEngine.toNumber(row.max_consecutive_days),
      min_service_days: LeaveEngine.toNumber(row.min_service_days),
      is_active: LeaveEngine.isTruthy(row.is_active),
      sort_order: LeaveEngine.toNumber(row.sort_order)
    };
  }

  function serializeDateTime_(value) {
    if (value === null || value === undefined || value === '') return '';
    if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
      return value.toISOString();
    }
    return String(value);
  }

  function ensureLeaveRequestColumns_() {
    if (typeof SchemaService === 'undefined' || !SchemaService.ensureSheetHeaders) return;
    try {
      SchemaService.ensureSheetHeaders(HRMS.SHEETS.LEAVE_REQUESTS);
    } catch (e) {
      Logger.log('ensureLeaveRequestColumns_: ' + (e.message || e));
    }
  }

  /**
   * Stamp approver + timestamp for the workflow stage being decided (before status changes).
   */
  function recordApprovalStage_(patch, session, requestStatus, comment) {
    var status = LeaveEngine.normalizeLeaveStatus(requestStatus);
    var approver = String(session.employee_id || '');
    var ts = now_();
    var note = comment || '';
    if (status === HRMS.LEAVE_STATUS.PENDING_MANAGER) {
      patch.manager_approver_employee_id = approver;
      patch.manager_decision_at = ts;
      patch.manager_decision_comment = note;
      return;
    }
    if (status === HRMS.LEAVE_STATUS.PENDING_HR) {
      patch.hr_approver_employee_id = approver;
      patch.hr_decision_at = ts;
      patch.hr_decision_comment = note;
      return;
    }
    if (status === HRMS.LEAVE_STATUS.PENDING_ADMIN) {
      patch.admin_approver_employee_id = approver;
      patch.admin_decision_at = ts;
      patch.admin_decision_comment = note;
    }
  }

  function serializeRequest_(row, typeMap, empMap) {
    var type = typeMap && typeMap[String(row.leave_type_id)];
    var emp = empMap && empMap[String(row.employee_id)];
    return {
      leave_request_id: row.leave_request_id,
      employee_id: row.employee_id,
      employee_name: emp ? (emp.display_name || emp.employee_id) : row.employee_id,
      leave_type_id: row.leave_type_id,
      leave_type_code: type ? type.code : '',
      leave_type_name: type ? type.name : '',
      counts_as_lop: type ? LeaveEngine.isTruthy(type.counts_as_lop) : false,
      start_date: LeaveEngine.formatIsoDate(row.start_date),
      end_date: LeaveEngine.formatIsoDate(row.end_date),
      is_half_day: LeaveEngine.isTruthy(row.is_half_day),
      half_day_session: row.half_day_session || '',
      total_days: LeaveEngine.toNumber(row.total_days),
      status: String(row.status || '').toUpperCase(),
      status_label: LeaveEngine.statusLabel(row.status),
      applicant_role: applicantUserRole_(row.employee_id),
      reason: row.reason || '',
      approver_employee_id: row.approver_employee_id || '',
      decision_at: serializeDateTime_(row.decision_at),
      decision_comment: row.decision_comment || '',
      manager_employee_id_at_submit: row.manager_employee_id_at_submit || '',
      manager_approver_employee_id: row.manager_approver_employee_id || '',
      manager_decision_at: serializeDateTime_(row.manager_decision_at),
      hr_approver_employee_id: row.hr_approver_employee_id || '',
      hr_decision_at: serializeDateTime_(row.hr_decision_at),
      admin_approver_employee_id: row.admin_approver_employee_id || '',
      admin_decision_at: serializeDateTime_(row.admin_decision_at),
      submitted_at: serializeDateTime_(row.submitted_at),
      cancelled_at: serializeDateTime_(row.cancelled_at),
      created_at: serializeDateTime_(row.created_at),
      leave_year: LeaveEngine.getLeaveYear(row.start_date, leaveYearStartMonth_())
    };
  }

  function typeMap_() {
    var map = {};
    listTypes_(false).forEach(function (t) {
      map[String(t.leave_type_id)] = t;
    });
    return map;
  }

  function empMap_() {
    var map = {};
    DbService.getAllRecords(HRMS.SHEETS.EMPLOYEES).forEach(function (e) {
      var key = String(e.employee_id);
      map[key] = e;
      var norm = LeaveEngine.normalizeEmployeeId(e.employee_id);
      if (norm && !map[norm]) map[norm] = e;
    });
    return map;
  }

  function listTypes_(activeOnly) {
    var rows = DbService.getAllRecords(HRMS.SHEETS.LEAVE_TYPES).map(coerceType_);
    if (activeOnly) {
      rows = rows.filter(function (t) { return t.is_active; });
    }
    rows.sort(function (a, b) {
      return a.sort_order - b.sort_order || String(a.code).localeCompare(String(b.code));
    });
    return rows;
  }

  function balanceKey_(employeeId, leaveTypeId, leaveYear) {
    return String(employeeId) + '|' + String(leaveTypeId) + '|' + String(leaveYear);
  }

  function loadBalanceIndex_() {
    var map = {};
    DbService.getAllRecords(HRMS.SHEETS.LEAVE_BALANCES).forEach(function (r) {
      map[balanceKey_(r.employee_id, r.leave_type_id, r.leave_year)] = r;
    });
    return map;
  }

  function findBalanceInIndex_(balanceIndex, employeeId, leaveTypeId, leaveYear) {
    if (!balanceIndex) return null;
    return balanceIndex[balanceKey_(employeeId, leaveTypeId, leaveYear)] || null;
  }

  function putBalanceInIndex_(balanceIndex, record) {
    if (!balanceIndex || !record) return;
    balanceIndex[balanceKey_(record.employee_id, record.leave_type_id, record.leave_year)] = record;
  }

  function findBalance_(employeeId, leaveTypeId, leaveYear, balanceIndex) {
    if (balanceIndex) {
      return findBalanceInIndex_(balanceIndex, employeeId, leaveTypeId, leaveYear);
    }
    var rows = DbService.getAllRecords(HRMS.SHEETS.LEAVE_BALANCES);
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (String(r.employee_id) === String(employeeId) &&
          String(r.leave_type_id) === String(leaveTypeId) &&
          String(r.leave_year) === String(leaveYear)) {
        return r;
      }
    }
    return null;
  }

  function writeBalance_(record, balanceIndex) {
    record.available_days = LeaveEngine.availableDays(record);
    record.updated_at = now_();
    var existing = balanceIndex
      ? findBalanceInIndex_(balanceIndex, record.employee_id, record.leave_type_id, record.leave_year)
      : DbService.findOne(HRMS.SHEETS.LEAVE_BALANCES, { leave_balance_id: record.leave_balance_id });
    if (existing) {
      DbService.updateRecord(HRMS.SHEETS.LEAVE_BALANCES, 'leave_balance_id', record.leave_balance_id, {
        entitled_days: record.entitled_days,
        used_days: record.used_days,
        pending_days: record.pending_days,
        carried_forward_days: record.carried_forward_days,
        available_days: record.available_days,
        updated_at: record.updated_at
      });
    } else {
      DbService.insertRecord(HRMS.SHEETS.LEAVE_BALANCES, record);
    }
    putBalanceInIndex_(balanceIndex, record);
    return record;
  }

  function existingKeysForEmployee_(balanceIndex, employeeId) {
    var rows = [];
    if (!balanceIndex) return rows;
    Object.keys(balanceIndex).forEach(function (key) {
      var row = balanceIndex[key];
      if (row && String(row.employee_id) === String(employeeId)) {
        rows.push({ leave_type_id: row.leave_type_id, leave_year: row.leave_year });
      }
    });
    return rows;
  }

  function syncEntitlementFromTypeLocked_(employeeId, type, leaveYear, balanceIndex) {
    var row = findBalance_(employeeId, type.leave_type_id, leaveYear, balanceIndex);
    if (!row) return null;
    var policyDays = LeaveEngine.toNumber(type.annual_entitlement_days);
    if (policyDays <= 0) return row;
    var current = LeaveEngine.toNumber(row.entitled_days);
    var used = LeaveEngine.toNumber(row.used_days);
    var pending = LeaveEngine.toNumber(row.pending_days);
    if (current > 0 || used > 0 || pending > 0) return row;
    if (current === policyDays) return row;
    row.entitled_days = policyDays;
    row.available_days = LeaveEngine.availableDays(row);
    row.updated_at = now_();
    return writeBalance_(row, balanceIndex);
  }

  function syncEntitlementsForEmployeeLocked_(employeeId, emp, throughYear, balanceIndex) {
    var startMonth = leaveYearStartMonth_();
    var years = LeaveEngine.employeeLeaveYears(emp.joining_date, todayDateOnly_(), startMonth);
    var types = listTypes_(true);
    var through = LeaveEngine.toNumber(throughYear);
    years.forEach(function (y) {
      if (LeaveEngine.toNumber(y) > through) return;
      types.forEach(function (type) {
        syncEntitlementFromTypeLocked_(employeeId, type, y, balanceIndex);
      });
    });
  }

  function buildNewBalanceRecordLocked_(employeeId, type, leaveYear, balanceIndex, joiningDate, startMonth) {
    if (!type.requires_balance) return null;
    var prev = findBalance_(employeeId, type.leave_type_id, LeaveEngine.previousLeaveYear(leaveYear), balanceIndex);
    var cf = LeaveEngine.carryForwardDays(prev, type.carry_forward_max_days);
    var entitled = LeaveEngine.entitledDaysForLeaveYear(
      joiningDate,
      leaveYear,
      startMonth != null ? startMonth : leaveYearStartMonth_(),
      type.annual_entitlement_days
    );
    var record = {
      leave_balance_id: nextLeaveBalanceIdLocked_(),
      employee_id: employeeId,
      leave_type_id: type.leave_type_id,
      leave_year: String(leaveYear),
      entitled_days: entitled,
      used_days: 0,
      pending_days: 0,
      carried_forward_days: cf,
      available_days: 0,
      updated_at: now_()
    };
    record.available_days = LeaveEngine.availableDays(record);
    return record;
  }

  function applyPlanLocked_(employeeId, typeMap, plan, balanceIndex, joiningDate, startMonth) {
    var toInsert = [];
    (plan || []).forEach(function (item) {
      var type = typeMap[String(item.leave_type_id)];
      if (!type || !type.requires_balance) return;
      if (findBalance_(employeeId, type.leave_type_id, item.leave_year, balanceIndex)) return;
      var record = buildNewBalanceRecordLocked_(employeeId, type, item.leave_year, balanceIndex, joiningDate, startMonth);
      if (!record) return;
      toInsert.push(record);
      putBalanceInIndex_(balanceIndex, record);
    });
    if (toInsert.length) {
      DbService.insertRecords(HRMS.SHEETS.LEAVE_BALANCES, toInsert);
    }
    return toInsert;
  }

  function typeMapFromList_(types) {
    var map = {};
    (types || []).forEach(function (t) {
      map[String(t.leave_type_id)] = t;
    });
    return map;
  }

  function summarizeGranted_(rows) {
    return (rows || []).map(function (b) {
      return {
        leave_balance_id: b.leave_balance_id,
        leave_type_id: b.leave_type_id,
        leave_year: b.leave_year,
        entitled_days: LeaveEngine.toNumber(b.entitled_days),
        carried_forward_days: LeaveEngine.toNumber(b.carried_forward_days),
        available_days: LeaveEngine.availableDays(b)
      };
    });
  }

  function ensureBalanceLocked_(employeeId, type, leaveYear, createIfMissing, balanceIndex, joiningDate) {
    var existing = findBalance_(employeeId, type.leave_type_id, leaveYear, balanceIndex);
    if (existing) return existing;
    if (!createIfMissing || !type.requires_balance) return null;
    if (joiningDate === undefined) {
      var empRow = getEmployee_(employeeId);
      joiningDate = empRow ? empRow.joining_date : null;
    }
    var record = buildNewBalanceRecordLocked_(
      employeeId,
      type,
      leaveYear,
      balanceIndex,
      joiningDate,
      leaveYearStartMonth_()
    );
    if (!record) return null;
    return writeBalance_(record, balanceIndex);
  }

  function parsePayloadDates_(payload) {
    var start = LeaveEngine.toDateOnly(payload.start_date);
    var end = LeaveEngine.toDateOnly(payload.end_date);
    if (!start || !end) {
      throw validationError_('Start date and end date are required.');
    }
    if (end.getTime() < start.getTime()) {
      throw validationError_('End date cannot be before start date.');
    }
    var isHalf = LeaveEngine.isTruthy(payload.is_half_day);
    var session = LeaveEngine.normalizeSession(payload.half_day_session);
    if (isHalf) {
      if (start.getTime() !== end.getTime()) {
        throw validationError_('Half-day leave must have the same start and end date.');
      }
      if (session !== 'AM' && session !== 'PM') {
        throw validationError_('Half-day leave requires a session (AM or PM).');
      }
    } else {
      session = '';
    }
    return { start: start, end: end, isHalf: isHalf, session: session };
  }

  function assertNotBeforeJoining_(emp, dates) {
    var join = LeaveEngine.toDateOnly(emp && emp.joining_date);
    if (join && dates.start && dates.start.getTime() < join.getTime()) {
      throw validationError_('Leave cannot start before the employee joining date.');
    }
  }

  function validateAgainstType_(emp, type, dates, totalDays) {
    if (!type || !type.is_active) {
      throw validationError_('Leave type is not active.');
    }
    if (dates.isHalf && !type.allow_half_day) {
      throw validationError_('This leave type does not allow half-day requests.');
    }
    if (type.max_consecutive_days != null && type.max_consecutive_days > 0 && totalDays > type.max_consecutive_days) {
      throw validationError_('Request exceeds the maximum consecutive days for this leave type.');
    }
    var minService = LeaveEngine.toNumber(type.min_service_days);
    if (minService > 0) {
      var served = LeaveEngine.serviceDaysAt(emp.joining_date, dates.start);
      if (served < minService) {
        throw validationError_('Minimum service period for this leave type has not been met.');
      }
    }
  }

  function findOverlap_(employeeId, dates, excludeRequestId) {
    var rows = DbService.findRecords(HRMS.SHEETS.LEAVE_REQUESTS, { employee_id: employeeId });
    var candidate = {
      start_date: dates.start,
      end_date: dates.end,
      is_half_day: dates.isHalf,
      half_day_session: dates.session
    };
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (excludeRequestId && String(row.leave_request_id) === String(excludeRequestId)) continue;
      if (!LeaveEngine.isBlockingStatus(row.status)) continue;
      if (LeaveEngine.requestsOverlap(candidate, row)) return row;
    }
    return null;
  }

  function assertNoOverlap_(employeeId, dates, excludeRequestId) {
    var hit = findOverlap_(employeeId, dates, excludeRequestId);
    if (hit) {
      throw validationError_('This request overlaps an existing submitted or approved leave.');
    }
  }

  function applyPendingDeltaLocked_(employeeId, type, leaveYear, deltaPending, deltaUsed, balanceIndex) {
    if (!type.requires_balance) return null;
    var bal = ensureBalanceLocked_(employeeId, type, leaveYear, true, balanceIndex);
    var pending = LeaveEngine.toNumber(bal.pending_days) + deltaPending;
    var used = LeaveEngine.toNumber(bal.used_days) + deltaUsed;
    if (pending < -0.001 || used < -0.001) {
      throw conflictError_('Leave balance cannot be reduced below zero.');
    }
    if (pending < 0) pending = 0;
    if (used < 0) used = 0;
    bal.pending_days = pending;
    bal.used_days = used;
    return writeBalance_(bal, balanceIndex);
  }

  function assertSufficientLocked_(employeeId, type, leaveYear, totalDays, balanceIndex) {
    if (!type.requires_balance) return;
    var bal = ensureBalanceLocked_(employeeId, type, leaveYear, true, balanceIndex);
    var available = LeaveEngine.availableDays(bal);
    if (available + 1e-9 < totalDays) {
      throw validationError_('Insufficient leave balance.');
    }
  }

  function fireLeaveInbox_(fn) {
    try {
      if (typeof NotificationLeaveAdapter === 'undefined') return;
      fn();
    } catch (e) {
      Logger.log('Leave inbox notify: ' + (e.message || e));
    }
  }
  function notifyLeave_(eventType, recipientEmail, employeeId, subject, entityId, body) {
    var emp = getEmployee_(employeeId);
    var mailBody = body;
    if (!mailBody) {
      var name = employeeDisplayName_(emp);
      mailBody = subject + '\n\nOpen HRMS to review this leave request.\nEmployee Name: ' + name;
    }
    return sendLeaveDecisionEmail_(eventType, recipientEmail, subject, mailBody, employeeId, entityId);
  }

  function managerWorkEmail_(emp) {
    if (!emp || !emp.manager_employee_id) return '';
    var mgr = getEmployee_(emp.manager_employee_id);
    return mgr && mgr.work_email ? String(mgr.work_email).trim() : '';
  }

  function refreshLopIfNeeded_(type, employeeId, start, end) {
    if (!type || !type.counts_as_lop) return;
    try {
      // Caller (approve/cancel) already holds the script lock.
      LeaveLopService.refreshOpenPayrollLop(employeeId, start, end, { alreadyLocked: true });
    } catch (ignore) {}
  }

  function saveDraft(session, payload) {
    PermissionService.require(HRMS.ACTIONS.LEAVE_APPLY, {}, session);
    var targetId = resolveApplyTarget_(session, payload);
    var emp = requireEmployee_(targetId);
    var type = coerceType_(getType_(payload.leave_type_id));
    if (!type) throw validationError_('Leave type is required.');
    var dates = parsePayloadDates_(payload);
    assertNotBeforeJoining_(emp, dates);
    if (dates.isHalf && !type.allow_half_day) {
      throw validationError_('This leave type does not allow half-day requests.');
    }
    var totalDays = LeaveEngine.computeTotalDays(dates.start, dates.end, dates.isHalf, countMethod_());
    if (totalDays <= 0) {
      throw validationError_('Leave duration must be greater than zero.');
    }
    return withScriptLock_(function () {
      var existing = payload.leave_request_id
        ? DbService.findOne(HRMS.SHEETS.LEAVE_REQUESTS, { leave_request_id: payload.leave_request_id })
        : null;
      if (existing) {
        if (String(existing.status).toUpperCase() !== HRMS.LEAVE_STATUS.DRAFT) {
          throw conflictError_('Only draft requests can be updated.');
        }
        if (String(existing.employee_id) !== String(targetId)) {
          throw authorizationError_('You cannot change the employee on this request.');
        }
        var updated = DbService.updateRecord(HRMS.SHEETS.LEAVE_REQUESTS, 'leave_request_id', existing.leave_request_id, {
          leave_type_id: type.leave_type_id,
          start_date: dates.start,
          end_date: dates.end,
          is_half_day: dates.isHalf,
          half_day_session: dates.session,
          total_days: totalDays,
          reason: payload.reason || '',
          status: HRMS.LEAVE_STATUS.DRAFT
        });
        return serializeRequest_(updated, typeMap_(), empMap_());
      }
      var id = nextLeaveRequestIdLocked_();
      var record = {
        leave_request_id: id,
        employee_id: targetId,
        leave_type_id: type.leave_type_id,
        start_date: dates.start,
        end_date: dates.end,
        is_half_day: dates.isHalf,
        half_day_session: dates.session,
        total_days: totalDays,
        status: HRMS.LEAVE_STATUS.DRAFT,
        reason: payload.reason || '',
        approver_employee_id: '',
        decision_at: '',
        decision_comment: '',
        submitted_at: '',
        cancelled_at: '',
        created_at: now_()
      };
      DbService.insertRecord(HRMS.SHEETS.LEAVE_REQUESTS, record);
      return serializeRequest_(record, typeMap_(), empMap_());
    });
  }

  function resolveApplyTarget_(session, payload) {
    var requested = String((payload && payload.employee_id) || '').trim();
    if (!requested || requested === String(session.employee_id)) {
      return session.employee_id;
    }
    if (!LeaveEngine.canApplyFor(session, requested)) {
      throw authorizationError_('You can only apply leave for yourself.');
    }
    return requested;
  }

  function submit(session, payload) {
    PermissionService.require(HRMS.ACTIONS.LEAVE_APPLY, {}, session);
    var targetId = resolveApplyTarget_(session, payload);
    var emp = requireEmployee_(targetId);
    if (String(emp.status).toUpperCase() !== 'ACTIVE') {
      throw validationError_('Leave can only be submitted for ACTIVE employees.');
    }
    var type = coerceType_(getType_(payload.leave_type_id));
    if (!type) throw validationError_('Leave type is required.');
    var reason = String(payload.reason || '').trim();
    if (!reason) {
      throw validationError_('A reason is required to submit leave.');
    }
    var dates = parsePayloadDates_(payload);
    assertNotBeforeJoining_(emp, dates);
    var totalDays = LeaveEngine.computeTotalDays(dates.start, dates.end, dates.isHalf, countMethod_());
    if (totalDays <= 0) {
      throw validationError_('Leave duration must be greater than zero.');
    }
    validateAgainstType_(emp, type, dates, totalDays);
    var leaveYear = LeaveEngine.getLeaveYear(dates.start, leaveYearStartMonth_());
    var proxy = String(targetId) !== String(session.employee_id);

    ensureLeaveRequestColumns_();
    var result = withScriptLock_(function () {
      var balanceIndex = loadBalanceIndex_();
      grantBalancesForEmployee(targetId, leaveYear, { alreadyLocked: true, balanceIndex: balanceIndex });
      var existing = payload.leave_request_id
        ? DbService.findOne(HRMS.SHEETS.LEAVE_REQUESTS, { leave_request_id: payload.leave_request_id })
        : null;
      if (existing) {
        if (String(existing.status).toUpperCase() !== HRMS.LEAVE_STATUS.DRAFT) {
          throw conflictError_('Only a draft can be submitted.');
        }
        if (String(existing.employee_id) !== String(targetId)) {
          throw authorizationError_('You cannot submit this request.');
        }
      }
      assertNoOverlap_(targetId, dates, existing ? existing.leave_request_id : null);
      assertSufficientLocked_(targetId, type, leaveYear, totalDays, balanceIndex);
      applyPendingDeltaLocked_(targetId, type, leaveYear, totalDays, 0, balanceIndex);
      var submittedAt = now_();
      var applicantRole = applicantUserRole_(targetId);
      var hasManager = hasActiveReportingManager_(emp);
      var pendingStatus = LeaveEngine.initialPendingStatus(applicantRole, hasManager);
      var record;
      if (existing) {
        record = DbService.updateRecord(HRMS.SHEETS.LEAVE_REQUESTS, 'leave_request_id', existing.leave_request_id, {
          leave_type_id: type.leave_type_id,
          start_date: dates.start,
          end_date: dates.end,
          is_half_day: dates.isHalf,
          half_day_session: dates.session,
          total_days: totalDays,
          status: pendingStatus,
          reason: reason,
          approver_employee_id: '',
          decision_at: '',
          decision_comment: '',
          manager_employee_id_at_submit: String(emp.manager_employee_id || ''),
          submitted_at: submittedAt
        });
      } else {
        record = {
          leave_request_id: nextLeaveRequestIdLocked_(),
          employee_id: targetId,
          leave_type_id: type.leave_type_id,
          start_date: dates.start,
          end_date: dates.end,
          is_half_day: dates.isHalf,
          half_day_session: dates.session,
          total_days: totalDays,
          status: pendingStatus,
          reason: reason,
          approver_employee_id: '',
          decision_at: '',
          decision_comment: '',
          manager_employee_id_at_submit: String(emp.manager_employee_id || ''),
          submitted_at: submittedAt,
          cancelled_at: '',
          created_at: now_()
        };
        DbService.insertRecord(HRMS.SHEETS.LEAVE_REQUESTS, record);
      }
      var summary = 'Submitted ' + totalDays + ' day(s)' + (proxy ? ' (HR proxy)' : '');
      AuditService.log(HRMS.LEAVE_AUDIT.SUBMIT, 'LeaveRequest', record.leave_request_id, summary, targetId);
      return serializeRequest_(record, typeMap_(), empMap_());
    });

    fireLeaveInbox_(function () {
      var mgr = emp.manager_employee_id ? getEmployee_(emp.manager_employee_id) : null;
      var queued = LeaveEngine.normalizeLeaveStatus(result.status);
      if (queued === HRMS.LEAVE_STATUS.PENDING_MANAGER && mgr) {
        notifyLeave_(
          'LEAVE_SUBMITTED',
          managerWorkEmail_(emp),
          targetId,
          'Leave submitted for ' + (emp.display_name || targetId),
          result.leave_request_id
        );
        NotificationLeaveAdapter.notifyManagerApprovalRequired(result, emp, mgr);
      } else {
        NotificationLeaveAdapter.notifyHrReviewRequired(result, emp, null);
      }
    });
    return result;
  }

  function approve(session, leaveRequestId, comment) {
    PermissionService.require(HRMS.ACTIONS.LEAVE_APPROVE, {}, session);
    var outcome = withScriptLock_(function () {
      var balanceIndex = loadBalanceIndex_();
      var row = DbService.findOne(HRMS.SHEETS.LEAVE_REQUESTS, { leave_request_id: leaveRequestId });
      if (!row) throw notFoundError_('Leave request not found.');
      if (!LeaveEngine.isPendingApprovalStatus(row.status)) {
        throw conflictError_('Only pending leave can be approved.');
      }
      var emp = requireEmployee_(row.employee_id);
      var applicantRole = applicantUserRole_(row.employee_id);
      if (!LeaveEngine.canApproveRequest(session, row.employee_id, emp.manager_employee_id, row.status, applicantRole)) {
        throw authorizationError_('You cannot approve this leave request.');
      }
      var type = coerceType_(getType_(row.leave_type_id));
      var year = LeaveEngine.getLeaveYear(row.start_date, leaveYearStartMonth_());
      var days = LeaveEngine.toNumber(row.total_days);
      ensureLeaveRequestColumns_();
      var step = LeaveEngine.statusAfterApproval(row.status, applicantRole);
      var patch = {};
      recordApprovalStage_(patch, session, row.status, comment);
      if (step.final) {
        applyPendingDeltaLocked_(row.employee_id, type, year, -days, days, balanceIndex);
        patch.status = HRMS.LEAVE_STATUS.APPROVED;
        patch.approver_employee_id = session.employee_id;
        patch.decision_at = now_();
        patch.decision_comment = comment || '';
      } else {
        patch.status = step.status;
      }
      var updated = DbService.updateRecord(HRMS.SHEETS.LEAVE_REQUESTS, 'leave_request_id', leaveRequestId, patch);
      var auditNote = step.final
        ? 'Approved ' + days + ' day(s)'
        : ('Stage approved → ' + step.status);
      AuditService.log(HRMS.LEAVE_AUDIT.APPROVE, 'LeaveRequest', leaveRequestId, auditNote, row.employee_id);
      if (step.final) {
        refreshLopIfNeeded_(type, row.employee_id, row.start_date, row.end_date);
      }
      return {
        serialized: serializeRequest_(updated, typeMap_(), empMap_()),
        work_email: emp.work_email,
        employee_id: row.employee_id,
        employee: emp,
        request: updated,
        final: step.final,
        next_status: step.status
      };
    });
    if (outcome.final) {
      dispatchLeaveDecisionNotifications_(leaveRequestId, 'LEAVE_APPROVED', comment);
    } else {
      fireLeaveInbox_(function () {
        NotificationLeaveAdapter.notifyHrReviewRequired(
          outcome.request || outcome.serialized,
          outcome.employee,
          null
        );
      });
    }
    return outcome.serialized;
  }

  function approveMany(session, leaveRequestIds, comment) {
    PermissionService.require(HRMS.ACTIONS.LEAVE_APPROVE, {}, session);
    var ids = Array.isArray(leaveRequestIds) ? leaveRequestIds : [];
    var results = [];
    ids.forEach(function (id) {
      var key = String(id || '').trim();
      if (!key) return;
      try {
        results.push({ leave_request_id: key, ok: true, result: approve(session, key, comment || '') });
      } catch (e) {
        results.push({ leave_request_id: key, ok: false, error: String(e.message || e) });
      }
    });
    var succeeded = results.filter(function (r) { return r.ok; }).length;
    return {
      total: results.length,
      succeeded: succeeded,
      failed: results.length - succeeded,
      results: results
    };
  }

  function reject(session, leaveRequestId, comment) {
    PermissionService.require(HRMS.ACTIONS.LEAVE_APPROVE, {}, session);
    var outcome = withScriptLock_(function () {
      var balanceIndex = loadBalanceIndex_();
      var row = DbService.findOne(HRMS.SHEETS.LEAVE_REQUESTS, { leave_request_id: leaveRequestId });
      if (!row) throw notFoundError_('Leave request not found.');
      if (!LeaveEngine.isPendingApprovalStatus(row.status)) {
        throw conflictError_('Only pending leave can be rejected.');
      }
      var emp = requireEmployee_(row.employee_id);
      var applicantRole = applicantUserRole_(row.employee_id);
      if (!LeaveEngine.canApproveRequest(session, row.employee_id, emp.manager_employee_id, row.status, applicantRole)) {
        throw authorizationError_('You cannot reject this leave request.');
      }
      var type = coerceType_(getType_(row.leave_type_id));
      var year = LeaveEngine.getLeaveYear(row.start_date, leaveYearStartMonth_());
      var days = LeaveEngine.toNumber(row.total_days);
      applyPendingDeltaLocked_(row.employee_id, type, year, -days, 0, balanceIndex);
      ensureLeaveRequestColumns_();
      var rejectPatch = {
        status: HRMS.LEAVE_STATUS.REJECTED,
        approver_employee_id: session.employee_id,
        decision_at: now_(),
        decision_comment: comment || ''
      };
      recordApprovalStage_(rejectPatch, session, row.status, comment);
      var updated = DbService.updateRecord(HRMS.SHEETS.LEAVE_REQUESTS, 'leave_request_id', leaveRequestId, rejectPatch);
      AuditService.log(HRMS.LEAVE_AUDIT.REJECT, 'LeaveRequest', leaveRequestId, 'Rejected', row.employee_id);
      return {
        serialized: serializeRequest_(updated, typeMap_(), empMap_()),
        work_email: emp.work_email,
        employee_id: row.employee_id,
        employee: emp,
        request: updated
      };
    });
    dispatchLeaveDecisionNotifications_(leaveRequestId, 'LEAVE_REJECTED', comment);
    return outcome.serialized;
  }

  function rejectMany(session, leaveRequestIds, comment) {
    PermissionService.require(HRMS.ACTIONS.LEAVE_APPROVE, {}, session);
    var ids = Array.isArray(leaveRequestIds) ? leaveRequestIds : [];
    var results = [];
    ids.forEach(function (id) {
      var key = String(id || '').trim();
      if (!key) return;
      try {
        results.push({ leave_request_id: key, ok: true, result: reject(session, key, comment || '') });
      } catch (e) {
        results.push({ leave_request_id: key, ok: false, error: String(e.message || e) });
      }
    });
    var succeeded = results.filter(function (r) { return r.ok; }).length;
    return {
      total: results.length,
      succeeded: succeeded,
      failed: results.length - succeeded,
      results: results
    };
  }

  function cancel(session, leaveRequestId) {
    PermissionService.require(HRMS.ACTIONS.LEAVE_APPLY, {}, session);
    var packed = withScriptLock_(function () {
      var balanceIndex = loadBalanceIndex_();
      var row = DbService.findOne(HRMS.SHEETS.LEAVE_REQUESTS, { leave_request_id: leaveRequestId });
      if (!row) throw notFoundError_('Leave request not found.');
      if (!LeaveEngine.canCancel(session, row)) {
        throw authorizationError_('You cannot cancel this leave request.');
      }
      var status = String(row.status).toUpperCase();
      var type = coerceType_(getType_(row.leave_type_id));
      var year = LeaveEngine.getLeaveYear(row.start_date, leaveYearStartMonth_());
      var days = LeaveEngine.toNumber(row.total_days);
      if (LeaveEngine.isPendingApprovalStatus(status)) {
        applyPendingDeltaLocked_(row.employee_id, type, year, -days, 0, balanceIndex);
      } else if (status === HRMS.LEAVE_STATUS.APPROVED) {
        applyPendingDeltaLocked_(row.employee_id, type, year, 0, -days, balanceIndex);
      } else if (status !== HRMS.LEAVE_STATUS.DRAFT) {
        throw conflictError_('This leave request cannot be cancelled.');
      }
      var updated = DbService.updateRecord(HRMS.SHEETS.LEAVE_REQUESTS, 'leave_request_id', leaveRequestId, {
        status: HRMS.LEAVE_STATUS.CANCELLED,
        cancelled_at: now_()
      });
      AuditService.log(HRMS.LEAVE_AUDIT.CANCEL, 'LeaveRequest', leaveRequestId, 'Cancelled from ' + status, row.employee_id);
      if (status === HRMS.LEAVE_STATUS.APPROVED) {
        refreshLopIfNeeded_(type, row.employee_id, row.start_date, row.end_date);
      }
      return {
        serialized: serializeRequest_(updated, typeMap_(), empMap_()),
        previous_status: status,
        employee_id: row.employee_id,
        request: updated
      };
    });
    fireLeaveInbox_(function () {
      var emp = getEmployee_(packed.employee_id);
      var mgr = emp && emp.manager_employee_id ? getEmployee_(emp.manager_employee_id) : null;
      var req = packed.request || packed.serialized;
      req.previous_status = packed.previous_status;
      NotificationLeaveAdapter.notifyCancelled(req, emp, mgr, session.displayName || session.email || '');
    });
    return packed.serialized;
  }

  function revokeRejection(session, leaveRequestId, comment) {
    PermissionService.require(HRMS.ACTIONS.LEAVE_ADMIN, {}, session);
    return withScriptLock_(function () {
      var balanceIndex = loadBalanceIndex_();
      var row = DbService.findOne(HRMS.SHEETS.LEAVE_REQUESTS, { leave_request_id: leaveRequestId });
      if (!row) throw notFoundError_('Leave request not found.');
      if (!LeaveEngine.canRevokeDecision(session, row)) {
        throw authorizationError_('You cannot revoke this leave decision.');
      }
      if (String(row.status).toUpperCase() !== HRMS.LEAVE_STATUS.REJECTED) {
        throw conflictError_('Only rejected leave can be restored to pending.');
      }
      var type = coerceType_(getType_(row.leave_type_id));
      var year = LeaveEngine.getLeaveYear(row.start_date, leaveYearStartMonth_());
      var days = LeaveEngine.toNumber(row.total_days);
      applyPendingDeltaLocked_(row.employee_id, type, year, days, 0, balanceIndex);
      var emp = requireEmployee_(row.employee_id);
      var applicantRole = applicantUserRole_(row.employee_id);
      var hasManager = hasActiveReportingManager_(emp);
      var restored = LeaveEngine.initialPendingStatus(applicantRole, hasManager);
      var updated = DbService.updateRecord(HRMS.SHEETS.LEAVE_REQUESTS, 'leave_request_id', leaveRequestId, {
        status: restored,
        approver_employee_id: '',
        decision_at: '',
        decision_comment: comment || ''
      });
      AuditService.log(
        HRMS.LEAVE_AUDIT.REVOKE,
        'LeaveRequest',
        leaveRequestId,
        'Revoked rejection — restored to ' + restored,
        row.employee_id
      );
      return serializeRequest_(updated, typeMap_(), empMap_());
    });
  }

  function serializeBalanceRow_(type, row, year) {
    if (!row) {
      return {
        leave_type_id: type.leave_type_id,
        code: type.code,
        name: type.name,
        requires_balance: type.requires_balance,
        leave_year: year,
        entitled_days: 0,
        used_days: 0,
        pending_days: 0,
        carried_forward_days: 0,
        available_days: type.requires_balance ? 0 : null,
        granted: false
      };
    }
    return {
      leave_type_id: type.leave_type_id,
      code: type.code,
      name: type.name,
      requires_balance: type.requires_balance,
      leave_year: row.leave_year,
      entitled_days: LeaveEngine.toNumber(row.entitled_days),
      used_days: LeaveEngine.toNumber(row.used_days),
      pending_days: LeaveEngine.toNumber(row.pending_days),
      carried_forward_days: LeaveEngine.toNumber(row.carried_forward_days),
      available_days: LeaveEngine.availableDays(row),
      granted: true
    };
  }

  function persistedYearsForEmployee_(balanceIndex, employeeId) {
    var seen = {};
    var years = [];
    existingKeysForEmployee_(balanceIndex, employeeId).forEach(function (row) {
      var y = String(row.leave_year);
      if (!y || seen[y]) return;
      seen[y] = true;
      years.push(y);
    });
    years.sort();
    return years;
  }

  function getMyLeave(session, employeeId, leaveYear) {
    PermissionService.require(HRMS.ACTIONS.LEAVE_APPLY, {}, session);
    var target = employeeId || session.employee_id;
    var emp = requireEmployee_(target);
    if (!LeaveEngine.canViewEmployeeLeave(session, target, emp.manager_employee_id)) {
      throw authorizationError_('You cannot view leave for this employee.');
    }
    var currentYear = currentLeaveYear_();
    var startMonth = leaveYearStartMonth_();
    var joinYear = emp.joining_date ? LeaveEngine.getLeaveYear(emp.joining_date, startMonth) : currentYear;
    var isActive = String(emp.status || '').toUpperCase() === 'ACTIVE';
    if (isActive) {
      grantBalancesForEmployee(target, currentYear);
    }
    var types = listTypes_(false);
    var balanceIndex = loadBalanceIndex_();
    var availableYears = isActive
      ? LeaveEngine.employeeLeaveYears(emp.joining_date, todayDateOnly_(), startMonth)
      : persistedYearsForEmployee_(balanceIndex, target);
    if (!availableYears.length && isActive &&
        LeaveEngine.isEligibleForLeaveYear(emp.joining_date, currentYear, startMonth)) {
      availableYears = [currentYear];
    }
    var year = leaveYear ? String(leaveYear) : currentYear;
    if (availableYears.length && availableYears.indexOf(year) < 0) {
      year = availableYears.indexOf(currentYear) >= 0
        ? currentYear
        : availableYears[availableYears.length - 1];
    }
    var balances = types.filter(function (t) {
      return !!findBalance_(target, t.leave_type_id, year, balanceIndex);
    }).map(function (t) {
      var row = findBalance_(target, t.leave_type_id, year, balanceIndex);
      return serializeBalanceRow_(t, row, year);
    });
    var tmap = typeMap_();
    var emap = empMap_();
    var requests = DbService.findRecords(HRMS.SHEETS.LEAVE_REQUESTS, { employee_id: target })
      .map(function (r) { return serializeRequest_(r, tmap, emap); })
      .sort(function (a, b) { return String(b.created_at) > String(a.created_at) ? 1 : -1; });
    return {
      employee: publicEmployee_(emp),
      leave_year: year,
      current_leave_year: currentYear,
      joining_leave_year: joinYear,
      available_years: availableYears.length ? availableYears : [year],
      balances: balances,
      requests: requests,
      types: listTypes_(true),
      can_proxy: PermissionService.isHrOrAdmin(session)
    };
  }

  function getApprovals(session) {
    PermissionService.require(HRMS.ACTIONS.LEAVE_APPROVE, {}, session);
    var tmap = typeMap_();
    var emap = empMap_();
    var rows = DbService.getAllRecords(HRMS.SHEETS.LEAVE_REQUESTS).filter(function (r) {
      return LeaveEngine.isPendingApprovalStatus(r.status);
    });
    var visible = rows.filter(function (r) {
      var emp = emap[String(r.employee_id)] || emap[LeaveEngine.normalizeEmployeeId(r.employee_id)];
      var mgr = emp ? emp.manager_employee_id : '';
      var applicantRole = applicantUserRole_(r.employee_id);
      return LeaveEngine.canApproveRequest(session, r.employee_id, mgr, r.status, applicantRole);
    });
    return visible.map(function (r) { return serializeRequest_(r, tmap, emap); });
  }

  function getAdminList(session, filters) {
    PermissionService.require(HRMS.ACTIONS.LEAVE_ADMIN, {}, session);
    filters = filters || {};
    var tmap = typeMap_();
    var emap = empMap_();
    var rows = DbService.getAllRecords(HRMS.SHEETS.LEAVE_REQUESTS);
    if (filters.employee_id) {
      rows = rows.filter(function (r) { return String(r.employee_id) === String(filters.employee_id); });
    }
    if (filters.status) {
      rows = rows.filter(function (r) {
        return LeaveEngine.matchesStatusFilter(r.status, filters.status);
      });
    }
    if (filters.leave_type_id) {
      rows = rows.filter(function (r) { return String(r.leave_type_id) === String(filters.leave_type_id); });
    }
    rows.sort(function (a, b) { return String(b.created_at) > String(a.created_at) ? 1 : -1; });
    return {
      requests: rows.map(function (r) {
        var emp = emap[String(r.employee_id)] || emap[LeaveEngine.normalizeEmployeeId(r.employee_id)];
        var serialized = serializeRequest_(r, tmap, emap);
        serialized.can_approve = LeaveEngine.canApproveRequest(
          session,
          r.employee_id,
          emp ? emp.manager_employee_id : '',
          r.status,
          applicantUserRole_(r.employee_id)
        );
        return serialized;
      }),
      types: listTypes_(false)
    };
  }

  function getCalendar(session, year, month, employeeId) {
    PermissionService.require(HRMS.ACTIONS.LEAVE_APPLY, {}, session);
    var today = todayDateOnly_();
    var y = LeaveEngine.toNumber(year, today.getFullYear());
    var m = LeaveEngine.toNumber(month, today.getMonth() + 1);
    var tmap = typeMap_();
    var emap = empMap_();
    var rows = DbService.getAllRecords(HRMS.SHEETS.LEAVE_REQUESTS).filter(function (r) {
      if (String(r.status).toUpperCase() !== HRMS.LEAVE_STATUS.APPROVED) return false;
      if (employeeId && String(r.employee_id) !== String(employeeId)) return false;
      var emp = emap[String(r.employee_id)];
      var mgr = emp ? emp.manager_employee_id : '';
      if (!LeaveEngine.canViewEmployeeLeave(session, r.employee_id, mgr)) return false;
      return LeaveEngine.lopDaysInMonth(r.start_date, r.end_date, false, HRMS.LEAVE_COUNT.CALENDAR_DAYS, y, m) > 0 ||
        LeaveEngine.lopDaysInMonth(r.start_date, r.end_date, r.is_half_day, HRMS.LEAVE_COUNT.CALENDAR_DAYS, y, m) > 0;
    });
    return {
      year: y,
      month: m,
      items: rows.map(function (r) { return serializeRequest_(r, tmap, emap); })
    };
  }

  function saveType(session, payload) {
    PermissionService.require(HRMS.ACTIONS.LEAVE_ADMIN, {}, session);
    var code = String(payload.code || '').trim().toUpperCase();
    var name = String(payload.name || '').trim();
    if (!code || !name) {
      throw validationError_('Leave type code and name are required.');
    }
    if (LeaveEngine.toNumber(payload.annual_entitlement_days) < 0 ||
        LeaveEngine.toNumber(payload.carry_forward_max_days) < 0 ||
        LeaveEngine.toNumber(payload.min_service_days) < 0) {
      throw validationError_('Numeric leave-type fields cannot be negative.');
    }
    return withScriptLock_(function () {
      var all = DbService.getAllRecords(HRMS.SHEETS.LEAVE_TYPES);
      var duplicate = all.filter(function (t) {
        return String(t.code).toUpperCase() === code &&
          String(t.leave_type_id) !== String(payload.leave_type_id || '');
      })[0];
      if (duplicate) {
        throw validationError_('Leave type code must be unique.');
      }
      var record = {
        code: code,
        name: name,
        is_paid: LeaveEngine.isTruthy(payload.is_paid),
        requires_balance: LeaveEngine.isTruthy(payload.requires_balance),
        allow_half_day: LeaveEngine.isTruthy(payload.allow_half_day),
        counts_as_lop: LeaveEngine.isTruthy(payload.counts_as_lop),
        annual_entitlement_days: LeaveEngine.toNumber(payload.annual_entitlement_days),
        carry_forward_max_days: LeaveEngine.toNumber(payload.carry_forward_max_days),
        max_consecutive_days: payload.max_consecutive_days === '' || payload.max_consecutive_days == null
          ? ''
          : LeaveEngine.toNumber(payload.max_consecutive_days),
        min_service_days: LeaveEngine.toNumber(payload.min_service_days),
        is_active: payload.is_active === undefined ? true : LeaveEngine.isTruthy(payload.is_active),
        sort_order: LeaveEngine.toNumber(payload.sort_order, 0)
      };
      var saved;
      if (payload.leave_type_id) {
        var existing = DbService.findOne(HRMS.SHEETS.LEAVE_TYPES, { leave_type_id: payload.leave_type_id });
        if (!existing) throw notFoundError_('Leave type not found.');
        saved = DbService.updateRecord(HRMS.SHEETS.LEAVE_TYPES, 'leave_type_id', payload.leave_type_id, record);
      } else {
        record.leave_type_id = nextLeaveTypeIdLocked_();
        DbService.insertRecord(HRMS.SHEETS.LEAVE_TYPES, record);
        saved = record;
      }
      AuditService.log(HRMS.LEAVE_AUDIT.TYPE_SAVE, 'LeaveType', saved.leave_type_id, 'Saved type ' + code, session.employee_id);
      return coerceType_(saved);
    });
  }

  /**
   * Persist leave balances from joining year through the target/current leave year.
   * Existing rows are never overwritten. Called on hire, reactivation, profile/leave
   * reads, and HR "start leave year".
   * @param {string} employeeId
   * @param {string|number=} leaveYear through-year; default is the current leave year
   * @param {Object=} options { alreadyLocked, balanceIndex, includeInactive }
   */
  function grantBalancesForEmployee(employeeId, leaveYear, options) {
    options = options || {};
    var emp = requireEmployee_(employeeId);
    var throughYear = String(leaveYear || currentLeaveYear_());
    var isActive = String(emp.status || '').toUpperCase() === 'ACTIVE';
    if (!isActive && !options.includeInactive) {
      return [];
    }

    function collectExisting_(balanceIndex) {
      return existingKeysForEmployee_(balanceIndex, employeeId);
    }

    function run_(balanceIndex) {
      var startMonth = leaveYearStartMonth_();
      var types = listTypes_(true).filter(function (t) { return t.requires_balance; });
      var plan = LeaveEngine.planBalanceGrants({
        joiningDate: emp.joining_date,
        asOfDate: todayDateOnly_(),
        startMonth: startMonth,
        targetYear: throughYear,
        types: types,
        existing: collectExisting_(balanceIndex)
      });
      var inserted = applyPlanLocked_(
        employeeId,
        typeMapFromList_(types),
        plan,
        balanceIndex,
        emp.joining_date,
        startMonth
      );
      syncEntitlementsForEmployeeLocked_(employeeId, emp, throughYear, balanceIndex);
      if (inserted.length) {
        AuditService.log(
          HRMS.LEAVE_AUDIT.GRANT,
          'LeaveBalance',
          employeeId,
          'Granted ' + inserted.length + ' balance(s) through leave year ' + throughYear,
          employeeId
        );
      }
      var out = [];
      types.forEach(function (type) {
        var throughRow = findBalance_(employeeId, type.leave_type_id, throughYear, balanceIndex);
        if (throughRow) out.push(throughRow);
      });
      return summarizeGranted_(out.length ? out : inserted);
    }

    if (options.alreadyLocked) {
      return run_(options.balanceIndex || loadBalanceIndex_());
    }

    var peekIndex = loadBalanceIndex_();
    var peekTypes = listTypes_(true).filter(function (t) { return t.requires_balance; });
    var peekPlan = LeaveEngine.planBalanceGrants({
      joiningDate: emp.joining_date,
      asOfDate: todayDateOnly_(),
      startMonth: leaveYearStartMonth_(),
      targetYear: throughYear,
      types: peekTypes,
      existing: collectExisting_(peekIndex)
    });
    if (!peekPlan.length) {
      return run_(peekIndex);
    }
    return withScriptLock_(function () { return run_(loadBalanceIndex_()); });
  }

  function startLeaveYear(session, leaveYear) {
    PermissionService.require(HRMS.ACTIONS.LEAVE_ADMIN, {}, session);
    var year = String(leaveYear || currentLeaveYear_());
    return withScriptLock_(function () {
      var employees = DbService.getAllRecords(HRMS.SHEETS.EMPLOYEES).filter(function (e) {
        return String(e.status).toUpperCase() === 'ACTIVE';
      });
      var startMonth = leaveYearStartMonth_();
      var types = listTypes_(true).filter(function (t) { return t.requires_balance; });
      var typeMap = typeMapFromList_(types);
      var balanceIndex = loadBalanceIndex_();
      var toInsert = [];
      employees.forEach(function (emp) {
        var plan = LeaveEngine.planBalanceGrants({
          joiningDate: emp.joining_date,
          asOfDate: todayDateOnly_(),
          startMonth: startMonth,
          targetYear: year,
          types: types,
          existing: existingKeysForEmployee_(balanceIndex, emp.employee_id)
        });
        plan.forEach(function (item) {
          var type = typeMap[String(item.leave_type_id)];
          if (!type) return;
          if (findBalanceInIndex_(balanceIndex, emp.employee_id, type.leave_type_id, item.leave_year)) return;
          var record = buildNewBalanceRecordLocked_(
            emp.employee_id,
            type,
            item.leave_year,
            balanceIndex,
            emp.joining_date,
            startMonth
          );
          if (!record) return;
          toInsert.push(record);
          putBalanceInIndex_(balanceIndex, record);
        });
      });
      if (toInsert.length) {
        DbService.insertRecords(HRMS.SHEETS.LEAVE_BALANCES, toInsert);
      }
      AuditService.log(
        HRMS.LEAVE_AUDIT.YEAR_START,
        'LeaveBalances',
        year,
        'Started leave year ' + year + ' for ' + employees.length + ' employees (' + toInsert.length + ' new balances)',
        session.employee_id
      );
      return { leave_year: year, employees: employees.length, granted: toInsert.length };
    });
  }

  function getApplyBootstrap(session) {
    PermissionService.require(HRMS.ACTIONS.LEAVE_APPLY, {}, session);
    return {
      types: listTypes_(true),
      employees: listEmployeeOptions(session),
      can_proxy: PermissionService.isHrOrAdmin(session)
    };
  }

  function previewDays(payload) {
    AuthService.requireAuth();
    var dates = parsePayloadDates_(payload);
    return {
      total_days: LeaveEngine.computeTotalDays(dates.start, dates.end, dates.isHalf, countMethod_()),
      leave_year: LeaveEngine.getLeaveYear(dates.start, leaveYearStartMonth_()),
      count_method: countMethod_()
    };
  }

  function listEmployeeOptions(session) {
    PermissionService.require(HRMS.ACTIONS.LEAVE_APPLY, {}, session);
    if (!PermissionService.isHrOrAdmin(session)) {
      var self = getEmployee_(session.employee_id);
      return self ? [publicEmployee_(self)] : [];
    }
    var rows;
    if (typeof EmployeeService !== 'undefined' && EmployeeService.listActiveEmployees) {
      rows = EmployeeService.listActiveEmployees();
    } else {
      rows = DbService.getAllRecords(HRMS.SHEETS.EMPLOYEES)
        .filter(function (e) { return String(e.status).toUpperCase() === 'ACTIVE'; });
    }
    return rows.map(publicEmployee_);
  }

  function getTypes(session, includeInactive) {
    PermissionService.require(HRMS.ACTIONS.LEAVE_APPLY, {}, session);
    if (includeInactive && !PermissionService.isHrOrAdmin(session)) {
      includeInactive = false;
    }
    return listTypes_(!includeInactive);
  }

  return {
    saveDraft: saveDraft,
    submit: submit,
    approve: approve,
    approveMany: approveMany,
    reject: reject,
    rejectMany: rejectMany,
    cancel: cancel,
    revokeRejection: revokeRejection,
    getMyLeave: getMyLeave,
    getApprovals: getApprovals,
    getAdminList: getAdminList,
    getCalendar: getCalendar,
    saveType: saveType,
    getTypes: getTypes,
    grantBalancesForEmployee: grantBalancesForEmployee,
    startLeaveYear: startLeaveYear,
    getApplyBootstrap: getApplyBootstrap,
    previewDays: previewDays,
    listEmployeeOptions: listEmployeeOptions,
    currentLeaveYear: currentLeaveYear_,
    getApprovedLopForPayroll: function (employeeId, periodYear, periodMonth) {
      return LeaveLopService.computeLopFromLeave(employeeId, periodYear, periodMonth);
    }
  };
})();