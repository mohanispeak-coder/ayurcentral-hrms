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

  function currentLeaveYear_(asOf) {
    return LeaveEngine.getLeaveYear(asOf || now_(), leaveYearStartMonth_());
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

  function publicEmployee_(emp) {
    if (!emp) return null;
    return {
      employee_id: emp.employee_id,
      display_name: emp.display_name || ((emp.first_name || '') + ' ' + (emp.last_name || '')).trim(),
      department: emp.department,
      designation: emp.designation,
      status: emp.status,
      manager_employee_id: emp.manager_employee_id,
      joining_date: LeaveEngine.formatIsoDate(emp.joining_date),
      work_email: emp.work_email
    };
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
      reason: row.reason || '',
      approver_employee_id: row.approver_employee_id || '',
      decision_at: serializeDateTime_(row.decision_at),
      decision_comment: row.decision_comment || '',
      submitted_at: serializeDateTime_(row.submitted_at),
      cancelled_at: serializeDateTime_(row.cancelled_at),
      created_at: serializeDateTime_(row.created_at)
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
      map[String(e.employee_id)] = e;
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

  function ensureBalanceLocked_(employeeId, type, leaveYear, createIfMissing, balanceIndex) {
    var existing = findBalance_(employeeId, type.leave_type_id, leaveYear, balanceIndex);
    if (existing) return existing;
    if (!createIfMissing) return null;
    var prev = findBalance_(employeeId, type.leave_type_id, LeaveEngine.previousLeaveYear(leaveYear), balanceIndex);
    var cf = LeaveEngine.carryForwardDays(prev, type.carry_forward_max_days);
    var record = {
      leave_balance_id: nextLeaveBalanceIdLocked_(),
      employee_id: employeeId,
      leave_type_id: type.leave_type_id,
      leave_year: String(leaveYear),
      entitled_days: LeaveEngine.toNumber(type.annual_entitlement_days),
      used_days: 0,
      pending_days: 0,
      carried_forward_days: cf,
      available_days: 0,
      updated_at: now_()
    };
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
  function notifyLeave_(eventType, recipientEmail, employeeId, subject, entityId) {
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
          body: subject + '\n\nOpen HRMS to review this leave request.\nEmployee ID: ' + employeeId
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
    var totalDays = LeaveEngine.computeTotalDays(dates.start, dates.end, dates.isHalf, countMethod_());
    if (totalDays <= 0) {
      throw validationError_('Leave duration must be greater than zero.');
    }
    validateAgainstType_(emp, type, dates, totalDays);
    var leaveYear = LeaveEngine.getLeaveYear(dates.start, leaveYearStartMonth_());
    var proxy = String(targetId) !== String(session.employee_id);

    var result = withScriptLock_(function () {
      var balanceIndex = loadBalanceIndex_();
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
      var record;
      if (existing) {
        record = DbService.updateRecord(HRMS.SHEETS.LEAVE_REQUESTS, 'leave_request_id', existing.leave_request_id, {
          leave_type_id: type.leave_type_id,
          start_date: dates.start,
          end_date: dates.end,
          is_half_day: dates.isHalf,
          half_day_session: dates.session,
          total_days: totalDays,
          status: HRMS.LEAVE_STATUS.SUBMITTED,
          reason: reason,
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
          status: HRMS.LEAVE_STATUS.SUBMITTED,
          reason: reason,
          approver_employee_id: '',
          decision_at: '',
          decision_comment: '',
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

    var mgrEmail = managerWorkEmail_(emp);
    notifyLeave_(
      'LEAVE_SUBMITTED',
      mgrEmail,
      targetId,
      'Leave submitted for ' + (emp.display_name || targetId),
      result.leave_request_id
    );
    fireLeaveInbox_(function () {
      var mgr = emp.manager_employee_id ? getEmployee_(emp.manager_employee_id) : null;
      NotificationLeaveAdapter.notifySubmitted(result, emp, mgr);
    });
    return result;
  }

  function approve(session, leaveRequestId, comment) {
    PermissionService.require(HRMS.ACTIONS.LEAVE_APPROVE, {}, session);
    var outcome = withScriptLock_(function () {
      var balanceIndex = loadBalanceIndex_();
      var row = DbService.findOne(HRMS.SHEETS.LEAVE_REQUESTS, { leave_request_id: leaveRequestId });
      if (!row) throw notFoundError_('Leave request not found.');
      if (String(row.status).toUpperCase() !== HRMS.LEAVE_STATUS.SUBMITTED) {
        throw conflictError_('Only submitted leave can be approved.');
      }
      var emp = requireEmployee_(row.employee_id);
      if (!LeaveEngine.canApproveRequest(session, row.employee_id, emp.manager_employee_id)) {
        throw authorizationError_('You cannot approve this leave request.');
      }
      var type = coerceType_(getType_(row.leave_type_id));
      var year = LeaveEngine.getLeaveYear(row.start_date, leaveYearStartMonth_());
      var days = LeaveEngine.toNumber(row.total_days);
      applyPendingDeltaLocked_(row.employee_id, type, year, -days, days, balanceIndex);
      var updated = DbService.updateRecord(HRMS.SHEETS.LEAVE_REQUESTS, 'leave_request_id', leaveRequestId, {
        status: HRMS.LEAVE_STATUS.APPROVED,
        approver_employee_id: session.employee_id,
        decision_at: now_(),
        decision_comment: comment || ''
      });
      AuditService.log(HRMS.LEAVE_AUDIT.APPROVE, 'LeaveRequest', leaveRequestId, 'Approved ' + days + ' day(s)', row.employee_id);
      refreshLopIfNeeded_(type, row.employee_id, row.start_date, row.end_date);
      return {
        serialized: serializeRequest_(updated, typeMap_(), empMap_()),
        work_email: emp.work_email,
        employee_id: row.employee_id,
        employee: emp,
        request: updated
      };
    });
    notifyLeave_('LEAVE_APPROVED', outcome.work_email, outcome.employee_id, 'Leave approved', leaveRequestId);
    fireLeaveInbox_(function () {
      NotificationLeaveAdapter.notifyApproved(outcome.request || outcome.serialized, outcome.employee);
    });
    return outcome.serialized;
  }

  function reject(session, leaveRequestId, comment) {
    PermissionService.require(HRMS.ACTIONS.LEAVE_APPROVE, {}, session);
    var outcome = withScriptLock_(function () {
      var balanceIndex = loadBalanceIndex_();
      var row = DbService.findOne(HRMS.SHEETS.LEAVE_REQUESTS, { leave_request_id: leaveRequestId });
      if (!row) throw notFoundError_('Leave request not found.');
      if (String(row.status).toUpperCase() !== HRMS.LEAVE_STATUS.SUBMITTED) {
        throw conflictError_('Only submitted leave can be rejected.');
      }
      var emp = requireEmployee_(row.employee_id);
      if (!LeaveEngine.canApproveRequest(session, row.employee_id, emp.manager_employee_id)) {
        throw authorizationError_('You cannot reject this leave request.');
      }
      var type = coerceType_(getType_(row.leave_type_id));
      var year = LeaveEngine.getLeaveYear(row.start_date, leaveYearStartMonth_());
      var days = LeaveEngine.toNumber(row.total_days);
      applyPendingDeltaLocked_(row.employee_id, type, year, -days, 0, balanceIndex);
      var updated = DbService.updateRecord(HRMS.SHEETS.LEAVE_REQUESTS, 'leave_request_id', leaveRequestId, {
        status: HRMS.LEAVE_STATUS.REJECTED,
        approver_employee_id: session.employee_id,
        decision_at: now_(),
        decision_comment: comment || ''
      });
      AuditService.log(HRMS.LEAVE_AUDIT.REJECT, 'LeaveRequest', leaveRequestId, 'Rejected', row.employee_id);
      return {
        serialized: serializeRequest_(updated, typeMap_(), empMap_()),
        work_email: emp.work_email,
        employee_id: row.employee_id,
        employee: emp,
        request: updated
      };
    });
    notifyLeave_('LEAVE_REJECTED', outcome.work_email, outcome.employee_id, 'Leave rejected', leaveRequestId);
    fireLeaveInbox_(function () {
      NotificationLeaveAdapter.notifyRejected(outcome.request || outcome.serialized, outcome.employee);
    });
    return outcome.serialized;
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
      if (status === HRMS.LEAVE_STATUS.SUBMITTED) {
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
      var updated = DbService.updateRecord(HRMS.SHEETS.LEAVE_REQUESTS, 'leave_request_id', leaveRequestId, {
        status: HRMS.LEAVE_STATUS.SUBMITTED,
        approver_employee_id: '',
        decision_at: '',
        decision_comment: comment || ''
      });
      AuditService.log(
        HRMS.LEAVE_AUDIT.REVOKE,
        'LeaveRequest',
        leaveRequestId,
        'Revoked rejection — restored to submitted',
        row.employee_id
      );
      return serializeRequest_(updated, typeMap_(), empMap_());
    });
  }

  function getMyLeave(session, employeeId) {
    PermissionService.require(HRMS.ACTIONS.LEAVE_APPLY, {}, session);
    var target = employeeId || session.employee_id;
    var emp = requireEmployee_(target);
    if (!LeaveEngine.canViewEmployeeLeave(session, target, emp.manager_employee_id)) {
      throw authorizationError_('You cannot view leave for this employee.');
    }
    var year = currentLeaveYear_();
    var types = listTypes_(false);
    var balanceIndex = loadBalanceIndex_();
    var balances = types.map(function (t) {
      var row = findBalance_(target, t.leave_type_id, year, balanceIndex);
      if (!row) {
        return {
          leave_type_id: t.leave_type_id,
          code: t.code,
          name: t.name,
          requires_balance: t.requires_balance,
          leave_year: year,
          entitled_days: t.requires_balance ? t.annual_entitlement_days : 0,
          used_days: 0,
          pending_days: 0,
          carried_forward_days: 0,
          available_days: t.requires_balance ? t.annual_entitlement_days : null,
          granted: false
        };
      }
      return {
        leave_type_id: t.leave_type_id,
        code: t.code,
        name: t.name,
        requires_balance: t.requires_balance,
        leave_year: row.leave_year,
        entitled_days: LeaveEngine.toNumber(row.entitled_days),
        used_days: LeaveEngine.toNumber(row.used_days),
        pending_days: LeaveEngine.toNumber(row.pending_days),
        carried_forward_days: LeaveEngine.toNumber(row.carried_forward_days),
        available_days: LeaveEngine.availableDays(row),
        granted: true
      };
    });
    var tmap = typeMap_();
    var emap = empMap_();
    var requests = DbService.findRecords(HRMS.SHEETS.LEAVE_REQUESTS, { employee_id: target })
      .map(function (r) { return serializeRequest_(r, tmap, emap); })
      .sort(function (a, b) { return String(b.created_at) > String(a.created_at) ? 1 : -1; });
    return {
      employee: publicEmployee_(emp),
      leave_year: year,
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
      return String(r.status).toUpperCase() === HRMS.LEAVE_STATUS.SUBMITTED;
    });
    var visible = rows.filter(function (r) {
      var emp = emap[String(r.employee_id)];
      var mgr = emp ? emp.manager_employee_id : '';
      return LeaveEngine.canApproveRequest(session, r.employee_id, mgr);
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
      rows = rows.filter(function (r) { return String(r.status).toUpperCase() === String(filters.status).toUpperCase(); });
    }
    if (filters.leave_type_id) {
      rows = rows.filter(function (r) { return String(r.leave_type_id) === String(filters.leave_type_id); });
    }
    rows.sort(function (a, b) { return String(b.created_at) > String(a.created_at) ? 1 : -1; });
    return {
      requests: rows.map(function (r) { return serializeRequest_(r, tmap, emap); }),
      types: listTypes_(false)
    };
  }

  function getCalendar(session, year, month, employeeId) {
    PermissionService.require(HRMS.ACTIONS.LEAVE_APPLY, {}, session);
    var y = LeaveEngine.toNumber(year, now_().getFullYear());
    var m = LeaveEngine.toNumber(month, now_().getMonth() + 1);
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
   * Called by Employee module on hire, and by HR "start leave year".
   * Safe if Employee is incomplete: uses Employees.employee_id only.
   * @param {string} employeeId
   * @param {string|number=} leaveYear
   * @param {Object=} options { alreadyLocked: true } when caller holds script lock
   */
  function grantBalancesForEmployee(employeeId, leaveYear, options) {
    options = options || {};
    var emp = requireEmployee_(employeeId);
    var year = leaveYear || currentLeaveYear_(emp.joining_date || now_());
    function run_(balanceIndex) {
      var types = listTypes_(true);
      var granted = types.map(function (type) {
        var existing = findBalance_(employeeId, type.leave_type_id, year, balanceIndex);
        if (existing) return existing;
        return ensureBalanceLocked_(employeeId, type, year, true, balanceIndex);
      });
      AuditService.log(HRMS.LEAVE_AUDIT.GRANT, 'LeaveBalance', employeeId, 'Granted balances for ' + year, employeeId);
      return granted.map(function (b) {
        return {
          leave_balance_id: b.leave_balance_id,
          leave_type_id: b.leave_type_id,
          leave_year: b.leave_year,
          available_days: LeaveEngine.availableDays(b)
        };
      });
    }
    if (options.alreadyLocked) {
      return run_(options.balanceIndex || loadBalanceIndex_());
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
      var types = listTypes_(true);
      var balanceIndex = loadBalanceIndex_();
      var prevYear = LeaveEngine.previousLeaveYear(year);
      var toInsert = [];
      employees.forEach(function (emp) {
        types.forEach(function (type) {
          if (findBalanceInIndex_(balanceIndex, emp.employee_id, type.leave_type_id, year)) return;
          var prev = findBalanceInIndex_(balanceIndex, emp.employee_id, type.leave_type_id, prevYear);
          var cf = LeaveEngine.carryForwardDays(prev, type.carry_forward_max_days);
          var record = {
            leave_balance_id: nextLeaveBalanceIdLocked_(),
            employee_id: emp.employee_id,
            leave_type_id: type.leave_type_id,
            leave_year: year,
            entitled_days: LeaveEngine.toNumber(type.annual_entitlement_days),
            used_days: 0,
            pending_days: 0,
            carried_forward_days: cf,
            available_days: 0,
            updated_at: now_()
          };
          record.available_days = LeaveEngine.availableDays(record);
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
    reject: reject,
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