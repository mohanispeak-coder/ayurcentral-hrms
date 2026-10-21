/**
 * Central leave policy: leave year mode, vertical monthly entitlement, carry-forward, pro-rata entitlement.
 *
 * Sheet roles (single source of truth each):
 * - LeaveBalances: leave year entitlement and application totals (entitled / used / pending / CF).
 * - LeaveMonthlyLedger: calendar month pool, used, paid leave, LOP, carry to next month.
 * - LeaveRequests: applications; LeaveMonthlyAdjustments: HR month tweaks.
 */
var LeavePolicyService = (function () {
  var GENERAL_TYPE_CODE_ = 'GENERAL';

  function trim_(v) {
    return v == null ? '' : String(v).trim();
  }

  function num_(v, fallback) {
    var n = Number(v);
    return isFinite(n) ? n : (fallback != null ? fallback : 0);
  }

  function bool_(v, fallback) {
    if (v === true || v === 1) return true;
    if (v === false || v === 0) return false;
    var s = String(v == null ? '' : v).trim().toUpperCase();
    if (s === 'TRUE' || s === 'YES' || s === 'Y' || s === '1') return true;
    if (s === 'FALSE' || s === 'NO' || s === 'N' || s === '0') return false;
    return !!fallback;
  }

  function leaveYearMode_() {
    return String(ConfigService.getSetting('leave_year_mode', 'CALENDAR') || 'CALENDAR').toUpperCase();
  }

  function leaveYearStartMonth() {
    var mode = leaveYearMode_();
    if (mode === 'FINANCIAL' || mode === 'FY') return 4;
    var fromSetting = num_(ConfigService.getSetting('leave_year_start_month', 1), 1);
    if (mode === 'CALENDAR') return 1;
    if (fromSetting >= 1 && fromSetting <= 12) return fromSetting;
    return 1;
  }

  function clampJoinDaySetting_(value, fallback) {
    var d = num_(value, fallback);
    if (d < 1) d = 1;
    if (d > 28) d = 28;
    return Math.floor(d);
  }

  function joinGrantAfterDay_() {
    if (typeof MonthlyLeaveService !== 'undefined' && MonthlyLeaveService.joinGrantAfterDay_) {
      return MonthlyLeaveService.joinGrantAfterDay_();
    }
    return clampJoinDaySetting_(ConfigService.getSetting('leave_join_grant_after_day', 20), 20);
  }

  function joinHalfFromDay_() {
    if (typeof MonthlyLeaveService !== 'undefined' && MonthlyLeaveService.joinHalfFromDay_) {
      return MonthlyLeaveService.joinHalfFromDay_();
    }
    return clampJoinDaySetting_(ConfigService.getSetting('leave_join_half_from_day', 10), 10);
  }

  function joinHalfToDay_() {
    if (typeof MonthlyLeaveService !== 'undefined' && MonthlyLeaveService.joinHalfToDay_) {
      return MonthlyLeaveService.joinHalfToDay_();
    }
    return clampJoinDaySetting_(ConfigService.getSetting('leave_join_half_to_day', 20), 20);
  }

  function assertJoinPolicyDaysConsistent_() {
    var from = joinHalfFromDay_();
    var to = joinHalfToDay_();
    var cut = joinGrantAfterDay_();
    if (from > to) {
      throw validationError_('Half-grant start day cannot be after half-grant through day.');
    }
    if (to > cut) {
      throw validationError_('Half-grant through day cannot be after the no-grant cut-off day.');
    }
  }

  function verticalPoliciesEqual_(a, b) {
    a = coerceVerticalPolicy_(a || {});
    b = coerceVerticalPolicy_(b || {});
    return a.monthly_leave_days === b.monthly_leave_days &&
      a.carry_forward_enabled === b.carry_forward_enabled &&
      a.carry_forward_frequency === b.carry_forward_frequency &&
      a.carry_forward_max_days === b.carry_forward_max_days;
  }

  function saveGlobalPolicy_(session, payload) {
    if (!PermissionService.isHrOrAdmin(session)) throw authorizationError_();
    payload = payload || {};
    var recalcAllEntitlements = false;
    if (payload.leave_year_mode != null) {
      var mode = String(payload.leave_year_mode).toUpperCase();
      if (mode !== 'CALENDAR' && mode !== 'FINANCIAL') {
        throw validationError_('Leave year must be CALENDAR or FINANCIAL.');
      }
      if (mode !== leaveYearMode_()) recalcAllEntitlements = true;
      upsertSetting_('leave_year_mode', mode, session);
      var startMonth = mode === 'FINANCIAL' ? 4 : 1;
      upsertSetting_('leave_year_start_month', String(startMonth), session);
    }
    if (payload.leave_join_grant_after_day != null) {
      var cut = num_(payload.leave_join_grant_after_day, NaN);
      if (!isFinite(cut) || cut < 1 || cut > 28) {
        throw validationError_('Joining-date cut-off must be between 1 and 28.');
      }
      var cutInt = Math.floor(cut);
      if (cutInt !== joinGrantAfterDay_()) recalcAllEntitlements = true;
      upsertSetting_('leave_join_grant_after_day', String(cutInt), session);
    }
    if (payload.leave_join_half_from_day != null) {
      var hfRaw = num_(payload.leave_join_half_from_day, NaN);
      if (!isFinite(hfRaw) || hfRaw < 1 || hfRaw > 28) {
        throw validationError_('Half-grant start day must be between 1 and 28.');
      }
      var hf = clampJoinDaySetting_(hfRaw, 10);
      if (hf !== joinHalfFromDay_()) recalcAllEntitlements = true;
      upsertSetting_('leave_join_half_from_day', String(hf), session);
    }
    if (payload.leave_join_half_to_day != null) {
      var htRaw = num_(payload.leave_join_half_to_day, NaN);
      if (!isFinite(htRaw) || htRaw < 1 || htRaw > 28) {
        throw validationError_('Half-grant end day must be between 1 and 28.');
      }
      var ht = clampJoinDaySetting_(htRaw, 20);
      if (ht !== joinHalfToDay_()) recalcAllEntitlements = true;
      upsertSetting_('leave_join_half_to_day', String(ht), session);
    }
    assertJoinPolicyDaysConsistent_();
    return { recalcAllEntitlements: recalcAllEntitlements };
  }

  function runPolicySaveRecalc_(globalFlags, changedVerticalNames) {
    if (typeof LeaveService === 'undefined' || !LeaveService.recalculateEntitlementsForActiveEmployees) return;
    var opts = { refreshMonthlyLedger: false };
    try {
      if (globalFlags && globalFlags.recalcAllEntitlements) {
        LeaveService.recalculateEntitlementsForActiveEmployees(null, opts);
        return;
      }
      var seen = {};
      (changedVerticalNames || []).forEach(function (name) {
        var n = trim_(name).toUpperCase();
        if (!n || seen[n]) return;
        seen[n] = true;
        LeaveService.recalculateEntitlementsForActiveEmployees(n, opts);
      });
    } catch (ignoreRecalcBatch) {}
  }

  function upsertSetting_(key, value, session) {
    ConfigService.clearSettingsCache();
    var row = DbService.findOne(HRMS.SHEETS.SETTINGS, { setting_key: key });
    var actor = session && session.email ? String(session.email).trim().toLowerCase() : 'system';
    if (!row) {
      if (typeof SchemaService !== 'undefined' && SchemaService.seedMissingDefaultSettings) {
        SchemaService.seedMissingDefaultSettings();
      }
      row = DbService.findOne(HRMS.SHEETS.SETTINGS, { setting_key: key });
    }
    if (!row) {
      throw configurationError_('Unknown setting key: ' + key);
    }
    DbService.updateRecord(HRMS.SHEETS.SETTINGS, 'setting_key', key, {
      setting_value: String(value),
      updated_at: new Date(),
      updated_by_email: actor
    });
    ConfigService.clearSettingsCache();
  }

  function getVerticalRow_(verticalCode) {
    var v = trim_(verticalCode).toUpperCase();
    if (!v) return null;
    return DbService.findOne(HRMS.SHEETS.VERTICALS, { vertical_name: v });
  }

  function coerceVerticalPolicy_(row) {
    row = row || {};
    var monthly = row.monthly_leave_days;
    if (monthly === '' || monthly == null) monthly = null;
    else monthly = num_(monthly, null);
    if (monthly != null && monthly < 0) monthly = 0;
    return {
      vertical_name: trim_(row.vertical_name).toUpperCase(),
      monthly_leave_days: monthly,
      carry_forward_enabled: bool_(row.leave_carry_forward_enabled, false),
      carry_forward_frequency: String(row.leave_carry_forward_frequency || 'YEARLY').toUpperCase(),
      carry_forward_max_days: Math.max(0, num_(row.leave_carry_forward_max_days, 0))
    };
  }

  function listVerticalPolicies() {
    var rows = DbService.getAllRecords(HRMS.SHEETS.VERTICALS) || [];
    return rows.map(function (r) {
      return coerceVerticalPolicy_(r);
    }).filter(function (p) { return p.vertical_name; });
  }

  function saveVerticalPolicy_(session, payload) {
    if (!PermissionService.isHrOrAdmin(session)) throw authorizationError_();
    payload = payload || {};
    var name = trim_(payload.vertical_name).toUpperCase();
    if (!name) throw validationError_('Vertical name is required.');
    var monthly = payload.monthly_leave_days;
    if (monthly === '' || monthly == null) {
      monthly = '';
    } else {
      monthly = num_(monthly, NaN);
      if (!isFinite(monthly) || monthly < 0) {
        throw validationError_('Monthly leave entitlement must be zero or a positive number.');
      }
    }
    var cfEnabled = bool_(payload.carry_forward_enabled, false);
    var freq = String(payload.carry_forward_frequency || 'YEARLY').toUpperCase();
    if (freq !== 'MONTHLY' && freq !== 'YEARLY') {
      throw validationError_('Carry-forward frequency must be MONTHLY or YEARLY.');
    }
    var cfMax = num_(payload.carry_forward_max_days, 0);
    if (cfMax < 0) throw validationError_('Maximum carry-forward cannot be negative.');
    if (!cfEnabled) {
      cfMax = 0;
    } else if (cfMax <= 0) {
      throw validationError_('Set maximum carry-forward days when carry-forward is enabled.');
    }
    var row = getVerticalRow_(name);
    if (!row) throw notFoundError_('Vertical not found: ' + name);
    var before = coerceVerticalPolicy_(row);
    var nextMonthly = monthly === '' ? null : monthly;
    var nextPolicy = {
      vertical_name: name,
      monthly_leave_days: nextMonthly,
      carry_forward_enabled: cfEnabled,
      carry_forward_frequency: freq,
      carry_forward_max_days: cfMax
    };
    var policyChanged = !verticalPoliciesEqual_(before, nextPolicy);
    var monthlyChanged = before.monthly_leave_days !== nextMonthly;
    DbService.updateRecord(HRMS.SHEETS.VERTICALS, 'vertical_name', name, {
      monthly_leave_days: monthly === '' ? '' : monthly,
      leave_carry_forward_enabled: cfEnabled ? 'TRUE' : 'FALSE',
      leave_carry_forward_frequency: freq,
      leave_carry_forward_max_days: cfMax
    });
    return {
      policy: coerceVerticalPolicy_(DbService.findOne(HRMS.SHEETS.VERTICALS, { vertical_name: name })),
      vertical_name: name,
      policy_changed: policyChanged,
      monthly_entitlement_changed: monthlyChanged
    };
  }

  function getGlobalPolicyForClient_() {
    return {
      leave_year_mode: leaveYearMode_(),
      leave_year_start_month: leaveYearStartMonth(),
      leave_join_grant_after_day: joinGrantAfterDay_(),
      leave_join_half_from_day: joinHalfFromDay_(),
      leave_join_half_to_day: joinHalfToDay_(),
      monthly_limit_semantics: 'ENTITLEMENT_ACCRUAL',
      monthly_limit_note: 'Monthly value is entitlement accrued per eligible calendar month (not a separate cap on applications). ' +
        'Join month: days 1–9 full grant; days 10–20 half grant (0 if monthly entitlement is 1); after cut-off day no grant. ' +
        'Attendance register Leave Balance = pool minus L, ML, and ½ day per 1/2P; excess leave (incl. half-days) becomes LOP at payroll.'
    };
  }

  function getPolicyBundle(session) {
    if (!PermissionService.isHrOrAdmin(session)) throw authorizationError_();
    return {
      global: getGlobalPolicyForClient_(),
      verticals: listVerticalPolicies()
    };
  }

  function savePolicyBundle(session, payload) {
    if (!PermissionService.isHrOrAdmin(session)) throw authorizationError_();
    payload = payload || {};
    var globalFlags = saveGlobalPolicy_(session, payload.global || payload);
    var verticals = payload.verticals || [];
    var saved = [];
    var verticalsNeedingEntitlementRecalc = [];
    verticals.forEach(function (v) {
      var result = saveVerticalPolicy_(session, v);
      saved.push(result.policy);
      if (result.monthly_entitlement_changed) verticalsNeedingEntitlementRecalc.push(result.vertical_name);
    });
    if (payload.vertical && !verticals.length) {
      var single = saveVerticalPolicy_(session, payload.vertical);
      saved.push(single.policy);
      if (single.monthly_entitlement_changed) verticalsNeedingEntitlementRecalc.push(single.vertical_name);
    }
    runPolicySaveRecalc_(globalFlags, verticalsNeedingEntitlementRecalc);
    AuditService.log('LEAVE_POLICY_SAVE', 'LeavePolicy', 'org', 'Updated leave policy settings', session.employee_id || '');
    return {
      global: getGlobalPolicyForClient_(),
      verticals: listVerticalPolicies(),
      saved_verticals: saved
    };
  }

  /**
   * Calendar months (year, month) inside a leave year label.
   */
  function monthsInLeaveYear_(leaveYear) {
    var sm = leaveYearStartMonth();
    var y = num_(leaveYear, 0);
    if (!y) return [];
    var out = [];
    for (var i = 0; i < 12; i++) {
      var m = sm + i;
      var calY = y;
      if (m > 12) {
        m -= 12;
        calY = y + 1;
      }
      out.push({ year: calY, month: m });
    }
    return out;
  }

  function computeLeaveYearEntitlement(emp, leaveYear) {
    if (!emp) return 0;
    if (typeof MonthlyLeaveService !== 'undefined' && MonthlyLeaveService.grantForEmployeeMonth_) {
      var total = 0;
      monthsInLeaveYear_(leaveYear).forEach(function (p) {
        total += num_(MonthlyLeaveService.grantForEmployeeMonth_(emp, p.year, p.month), 0);
      });
      return Math.round(total * 100) / 100;
    }
    return 0;
  }

  function yearlyCarryForwardAmount_(employeeId, leaveYear, balanceIndex) {
    var emp = DbService.findOne(HRMS.SHEETS.EMPLOYEES, { employee_id: employeeId });
    if (!emp) return 0;
    var policy = coerceVerticalPolicy_(getVerticalRow_(emp.vertical_name));
    if (!policy.carry_forward_enabled || policy.carry_forward_frequency !== 'YEARLY') return 0;
    var prevYear = LeaveEngine.previousLeaveYear(leaveYear);
    var type = ensureGeneralLeaveType_();
    if (!type) return 0;
    var prevBal = balanceIndex
      ? findBalanceInIndex_(balanceIndex, employeeId, type.leave_type_id, prevYear)
      : DbService.findRecords(HRMS.SHEETS.LEAVE_BALANCES, { employee_id: employeeId, leave_year: prevYear })
          .filter(function (b) { return String(b.leave_type_id) === String(type.leave_type_id); })[0];
    if (!prevBal) return 0;
    var unused = LeaveEngine.availableDays(prevBal);
    if (unused < 0) unused = 0;
    var max = policy.carry_forward_max_days;
    return unused < max ? unused : max;
  }

  function findBalanceInIndex_(index, employeeId, typeId, year) {
    if (!index) return null;
    var key = LeaveEngine.normalizeEmployeeId(employeeId) + '|' + String(typeId) + '|' + String(year);
    return index[key] || null;
  }

  function ensureGeneralLeaveType_() {
    var rows = DbService.getAllRecords(HRMS.SHEETS.LEAVE_TYPES) || [];
    var hit = null;
    rows.forEach(function (r) {
      if (hit) return;
      var code = trim_(r.code).toUpperCase();
      if (code === GENERAL_TYPE_CODE_ || code === 'GL') hit = r;
    });
    if (hit) return hit;
    var id = 'LTGEN';
    var record = {
      leave_type_id: id,
      code: GENERAL_TYPE_CODE_,
      name: 'General Leave',
      is_paid: 'TRUE',
      requires_balance: 'TRUE',
      allow_half_day: 'TRUE',
      counts_as_lop: 'FALSE',
      annual_entitlement_days: 0,
      carry_forward_max_days: 0,
      max_consecutive_days: '',
      min_service_days: 0,
      is_active: 'TRUE',
      sort_order: 1
    };
    try {
      DbService.insertRecord(HRMS.SHEETS.LEAVE_TYPES, record);
    } catch (ignore) {
      return DbService.findOne(HRMS.SHEETS.LEAVE_TYPES, { code: GENERAL_TYPE_CODE_ }) || record;
    }
    return record;
  }

  function resolveApplicationLeaveType_(payloadLeaveTypeId) {
    var general = ensureGeneralLeaveType_();
    if (!payloadLeaveTypeId) return general;
    var row = DbService.findOne(HRMS.SHEETS.LEAVE_TYPES, { leave_type_id: payloadLeaveTypeId });
    if (row && LeaveEngine.isTruthy(row.is_active)) return row;
    return general;
  }

  function effectiveEntitledDays_(balanceRow, emp, leaveYear) {
    return computeLeaveYearEntitlement(emp, leaveYear);
  }

  function syncCurrentYearBalanceFromPolicy_(employeeId, leaveYear, balanceIndex, emp) {
    var type = ensureGeneralLeaveType_();
    if (!type) return null;
    emp = emp || DbService.findOne(HRMS.SHEETS.EMPLOYEES, { employee_id: employeeId });
    var bal = balanceIndex
      ? findBalanceInIndex_(balanceIndex, employeeId, type.leave_type_id, leaveYear)
      : null;
    if (!bal) {
      bal = DbService.findRecords(HRMS.SHEETS.LEAVE_BALANCES, {
        employee_id: employeeId,
        leave_year: String(leaveYear)
      }).filter(function (b) { return String(b.leave_type_id) === String(type.leave_type_id); })[0];
    }
    if (!bal) return null;
    var entitled = effectiveEntitledDays_(bal, emp, leaveYear);
    var used = LeaveEngine.toNumber(bal.used_days);
    var pending = LeaveEngine.toNumber(bal.pending_days);
    var cf = LeaveEngine.toNumber(bal.carried_forward_days);
    var minEntitled = used + pending - cf;
    if (minEntitled < 0) minEntitled = 0;
    if (entitled < minEntitled) entitled = minEntitled;
    if (LeaveEngine.toNumber(bal.entitled_days) === entitled) return bal;
    bal.entitled_days = entitled;
    bal.available_days = LeaveEngine.availableDays(bal);
    bal.updated_at = new Date().toISOString();
    DbService.updateRecord(HRMS.SHEETS.LEAVE_BALANCES, 'leave_balance_id', bal.leave_balance_id, bal);
    if (balanceIndex) {
      balanceIndex[LeaveEngine.normalizeEmployeeId(employeeId) + '|' + String(type.leave_type_id) + '|' + String(leaveYear)] = bal;
    }
    return bal;
  }

  function ledgerKey_(employeeId, year, month) {
    return String(employeeId) + '|' + Number(year) + '|' + Number(month);
  }

  function findLedgerRow_(employeeId, year, month) {
    var rows = DbService.findRecords(HRMS.SHEETS.LEAVE_MONTHLY_LEDGER, {
      employee_id: trim_(employeeId),
      period_year: Number(year),
      period_month: Number(month)
    });
    return rows && rows.length ? rows[0] : null;
  }

  function computeMonthlyLedgerFields_(employeeId, year, month) {
    employeeId = trim_(employeeId);
    year = Number(year);
    month = Number(month);
    if (!employeeId || !isFinite(year) || !isFinite(month)) return null;
    var emp = DbService.findOne(HRMS.SHEETS.EMPLOYEES, { employee_id: employeeId });
    if (!emp) return null;
    var policy = coerceVerticalPolicy_(getVerticalRow_(emp.vertical_name));
    var summary = {};
    if (typeof MonthlyLeaveService !== 'undefined' && MonthlyLeaveService.fillMonthPoolSummary_) {
      MonthlyLeaveService.fillMonthPoolSummary_(summary, employeeId, year, month, emp);
    } else {
      summary.month_opening_carry = 0;
      summary.month_grant = 0;
      summary.month_adjustment = 0;
      summary.month_pool = 0;
      summary.month_used = 0;
      summary.month_paid = 0;
      summary.month_lop = 0;
      summary.month_available = 0;
    }
    var opening = num_(summary.month_opening_carry, 0);
    var grant = num_(summary.month_grant, 0);
    var adj = num_(summary.month_adjustment, 0);
    var pool = num_(summary.month_pool, 0);
    var used = num_(summary.month_used, 0);
    var paid = num_(summary.month_paid, 0);
    var lop = num_(summary.month_lop, 0);
    var available = num_(summary.month_available, Math.max(0, pool - used));
    var closing = available;
    var carry = 0;
    if (policy.carry_forward_enabled && policy.carry_forward_frequency === 'MONTHLY') {
      carry = closing < policy.carry_forward_max_days ? closing : policy.carry_forward_max_days;
    }
    return {
      opening_cf_days: opening,
      grant_days: grant,
      used_days: used,
      adjustment_days: adj,
      pool_days: pool,
      paid_leave_days: paid,
      available_days: available,
      lop_days: lop,
      closing_balance: closing,
      carry_to_next_days: carry
    };
  }

  function refreshMonthlyLedger_(employeeId, year, month) {
    employeeId = trim_(employeeId);
    year = Number(year);
    month = Number(month);
    if (typeof SchemaService !== 'undefined' && SchemaService.ensureSheetHeaders) {
      try {
        SchemaService.ensureSheetHeaders(HRMS.SHEETS.LEAVE_MONTHLY_LEDGER);
      } catch (ignoreHdr) {}
    }
    var fields = computeMonthlyLedgerFields_(employeeId, year, month);
    if (!fields) return null;
    var processedAt = new Date().toISOString();
    var existing = findLedgerRow_(employeeId, year, month);
    var merged = {
      ledger_id: existing ? existing.ledger_id : ('LML' + Utilities.getUuid().replace(/-/g, '').slice(0, 12).toUpperCase()),
      employee_id: employeeId,
      period_year: year,
      period_month: month,
      opening_cf_days: fields.opening_cf_days,
      grant_days: fields.grant_days,
      used_days: fields.used_days,
      adjustment_days: fields.adjustment_days,
      pool_days: fields.pool_days,
      paid_leave_days: fields.paid_leave_days,
      available_days: fields.available_days,
      lop_days: fields.lop_days,
      closing_balance: fields.closing_balance,
      carry_to_next_days: fields.carry_to_next_days,
      processed_at: processedAt
    };
    if (existing) {
      DbService.updateRecord(HRMS.SHEETS.LEAVE_MONTHLY_LEDGER, 'ledger_id', existing.ledger_id, merged);
    } else {
      DbService.appendRecord(HRMS.SHEETS.LEAVE_MONTHLY_LEDGER, merged);
    }
    return merged;
  }

  function getMonthlyLedgerRow_(employeeId, year, month) {
    return findLedgerRow_(employeeId, year, month);
  }

  function processMonthlyPeriod_(employeeId, year, month) {
    return refreshMonthlyLedger_(employeeId, year, month);
  }

  /**
   * After attendance register save: refresh monthly ledger so carry → next month and paid vs LOP stay correct.
   */
  function syncMonthlyLedgerAfterAttendance_(employeeId, year, month) {
    employeeId = trim_(employeeId);
    year = Number(year);
    month = Number(month);
    if (!employeeId || !isFinite(year) || !isFinite(month)) return null;
    var emp = DbService.findOne(HRMS.SHEETS.EMPLOYEES, { employee_id: employeeId });
    if (!emp) return null;
    var policy = coerceVerticalPolicy_(getVerticalRow_(emp.vertical_name));
    if (!policy.carry_forward_enabled) {
      refreshMonthlyLedger_(employeeId, year, month);
      return findLedgerRow_(employeeId, year, month);
    }
    if (policy.carry_forward_enabled && policy.carry_forward_frequency === 'MONTHLY') {
      var prevMonth = month === 1 ? { year: year - 1, month: 12 } : { year: year, month: month - 1 };
      if (findLedgerRow_(employeeId, prevMonth.year, prevMonth.month)) {
        refreshMonthlyLedger_(employeeId, prevMonth.year, prevMonth.month);
      }
    }
    refreshMonthlyLedger_(employeeId, year, month);
    if (policy.carry_forward_enabled && policy.carry_forward_frequency === 'MONTHLY') {
      var nextMonth = month === 12 ? { year: year + 1, month: 1 } : { year: year, month: month + 1 };
      if (findLedgerRow_(employeeId, nextMonth.year, nextMonth.month)) {
        refreshMonthlyLedger_(employeeId, nextMonth.year, nextMonth.month);
      }
    }
    return findLedgerRow_(employeeId, year, month);
  }

  function monthlyOpeningCarry_(employeeId, year, month) {
    var row = refreshMonthlyLedger_(employeeId, year, month);
    return row ? num_(row.opening_cf_days, 0) : 0;
  }

  /**
   * Read-only opening carry for UI / attendance (no ledger writes or month backfill).
   */
  function monthlyOpeningCarryReadOnly_(employeeId, year, month) {
    employeeId = trim_(employeeId);
    year = Number(year);
    month = Number(month);
    if (!employeeId || !isFinite(year) || !isFinite(month)) return 0;
    var current = findLedgerRow_(employeeId, year, month);
    if (current) return num_(current.opening_cf_days, 0);
    var emp = DbService.findOne(HRMS.SHEETS.EMPLOYEES, { employee_id: employeeId });
    if (!emp) return 0;
    var policy = coerceVerticalPolicy_(getVerticalRow_(emp.vertical_name));
    if (!policy.carry_forward_enabled || policy.carry_forward_frequency !== 'MONTHLY') return 0;
    var prevMonth = month === 1 ? { year: year - 1, month: 12 } : { year: year, month: month - 1 };
    var prev = findLedgerRow_(employeeId, prevMonth.year, prevMonth.month);
    return prev ? num_(prev.carry_to_next_days, 0) : 0;
  }

  return {
    GENERAL_TYPE_CODE: GENERAL_TYPE_CODE_,
    leaveYearStartMonth: leaveYearStartMonth,
    leaveYearMode: leaveYearMode_,
    joinGrantAfterDay: joinGrantAfterDay_,
    joinHalfFromDay: joinHalfFromDay_,
    joinHalfToDay: joinHalfToDay_,
    getPolicyBundle: getPolicyBundle,
    savePolicyBundle: savePolicyBundle,
    listVerticalPolicies: listVerticalPolicies,
    computeLeaveYearEntitlement: computeLeaveYearEntitlement,
    yearlyCarryForwardAmount: yearlyCarryForwardAmount_,
    ensureGeneralLeaveType: ensureGeneralLeaveType_,
    resolveApplicationLeaveType: resolveApplicationLeaveType_,
    effectiveEntitledDays: effectiveEntitledDays_,
    syncCurrentYearBalanceFromPolicy: syncCurrentYearBalanceFromPolicy_,
    processMonthlyPeriod: processMonthlyPeriod_,
    refreshMonthlyLedger: refreshMonthlyLedger_,
    getMonthlyLedgerRow: getMonthlyLedgerRow_,
    syncMonthlyLedgerAfterAttendance: syncMonthlyLedgerAfterAttendance_,
    monthlyOpeningCarry: monthlyOpeningCarry_,
    monthlyOpeningCarryReadOnly: monthlyOpeningCarryReadOnly_,
    monthsInLeaveYear: monthsInLeaveYear_
  };
})();
