/**
 * Monthly leave allowance (vertical grant, join rules, attendance usage, HR adjustments).
 * Phase 1: no leave types; carry-forward is display-only placeholder.
 */
var MonthlyLeaveService = (function () {
  function trim_(v) {
    return v == null ? '' : String(v).trim();
  }

  function num_(v, fallback) {
    var n = Number(v);
    return isFinite(n) ? n : (fallback != null ? fallback : 0);
  }

  function pad2_(n) {
    n = String(Number(n));
    return n.length < 2 ? '0' + n : n;
  }

  function verticalCode_(empOrCode) {
    if (!empOrCode) return '';
    if (typeof empOrCode === 'string') return trim_(empOrCode).toUpperCase();
    var v = trim_(empOrCode.vertical_name).toUpperCase();
    if (!v && empOrCode.employee_id) {
      v = trim_(String(empOrCode.employee_id).split('-')[0]).toUpperCase();
    }
    return v;
  }

  function monthlyGrantDefault_(verticalCode) {
    var v = verticalCode_(verticalCode);
    var map = HRMS.ATTENDANCE_LEAVE_BALANCE_MAX || {};
    if (map.hasOwnProperty(v)) return num_(map[v], 0);
    return num_(map.OTHERS, 0);
  }

  function monthlyGrantFromVerticalRow_(verticalCode) {
    var v = verticalCode_(verticalCode);
    if (!v) return null;
    try {
      var row = DbService.findOne(HRMS.SHEETS.VERTICALS, { vertical_name: v });
      if (row && row.monthly_leave_days !== '' && row.monthly_leave_days != null) {
        return num_(row.monthly_leave_days, null);
      }
    } catch (ignore) {}
    return null;
  }

  function baseMonthlyGrant_(verticalCode) {
    var fromSheet = monthlyGrantFromVerticalRow_(verticalCode);
    if (fromSheet != null && isFinite(fromSheet)) return fromSheet;
    return monthlyGrantDefault_(verticalCode);
  }

  function joinGrantAfterDay_() {
    var d = num_(ConfigService.getSetting('leave_join_grant_after_day', 20), 20);
    if (d < 1) d = 1;
    if (d > 28) d = 28;
    return d;
  }

  function parseDate_(s) {
    s = trim_(s);
    if (!s) return null;
    var d = new Date(s);
    if (!isFinite(d.getTime())) return null;
    return d;
  }

  function grantForEmployeeMonth_(emp, year, month) {
    var base = baseMonthlyGrant_(verticalCode_(emp));
    if (!emp) return base;
    var join = parseDate_(emp.joining_date);
    if (!join) return base;
    var y = Number(year);
    var m = Number(month);
    var joinY = join.getFullYear();
    var joinM = join.getMonth() + 1;
    if (joinY > y || (joinY === y && joinM > m)) return 0;
    if (joinY === y && joinM === m) {
      var afterDay = joinGrantAfterDay_();
      if (join.getDate() > afterDay) return 0;
    }
    return base;
  }

  function leaveUsedFromCounts_(counts) {
    counts = counts || {};
    var half = num_(counts['1/2P'], 0);
    return num_(counts.L, 0) + num_(counts.ML, 0) + (half * 0.5);
  }

  function adjustmentForEmployeeMonth_(employeeId, year, month) {
    employeeId = trim_(employeeId);
    if (!employeeId) return 0;
    try {
      var rows = DbService.findRecords(HRMS.SHEETS.LEAVE_MONTHLY_ADJUSTMENTS, {
        employee_id: employeeId,
        period_year: Number(year),
        period_month: Number(month)
      });
      var total = 0;
      rows.forEach(function (r) {
        total += num_(r.adjustment_days, 0);
      });
      return total;
    } catch (ignore) {
      return 0;
    }
  }

  function availableAfterCounts_(emp, year, month, counts) {
    var grant = grantForEmployeeMonth_(emp, year, month);
    var used = leaveUsedFromCounts_(counts);
    var adj = emp && emp.employee_id
      ? adjustmentForEmployeeMonth_(emp.employee_id, year, month)
      : 0;
    var opening = readOpeningCarry_(emp && emp.employee_id, year, month);
    return Math.max(0, opening + grant + adj - used);
  }

  function readOpeningCarry_(employeeId, year, month) {
    if (!employeeId) return 0;
    if (typeof LeavePolicyService !== 'undefined' && LeavePolicyService.monthlyOpeningCarryReadOnly) {
      return LeavePolicyService.monthlyOpeningCarryReadOnly(employeeId, year, month);
    }
    return 0;
  }

  function monthlyEntitlementPool_(emp, employeeId, year, month) {
    var grant = grantForEmployeeMonth_(emp, year, month);
    var adj = adjustmentForEmployeeMonth_(employeeId, year, month);
    var opening = readOpeningCarry_(employeeId, year, month);
    return opening + grant + adj;
  }

  /**
   * LOP days from leave (L / ML / half-day) recorded in attendance when usage exceeds the monthly pool.
   * Same rule as attendance register → payroll (lop_from_excess_leave).
   */
  function leavePaidLopSplit_(used, pool) {
    if (typeof AttendanceRegisterService !== 'undefined' && AttendanceRegisterService.leavePaidAndLopSplit_) {
      return AttendanceRegisterService.leavePaidAndLopSplit_(used, pool);
    }
    used = num_(used, 0);
    pool = Math.max(0, num_(pool, 0));
    var paid = Math.min(used, pool);
    return { paid_leave_days: paid, lop_from_excess_leave: Math.max(0, used - paid) };
  }

  function monthLeaveUsedDays_(employeeId, year, month, counts) {
    var registerUsed = leaveUsedFromCounts_(counts);
    var approvedUsed = 0;
    if (typeof LeaveService !== 'undefined' && LeaveService.approvedLeaveDaysInCalendarMonth) {
      try {
        approvedUsed = Number(LeaveService.approvedLeaveDaysInCalendarMonth(employeeId, year, month)) || 0;
      } catch (ignoreAppr) {}
    }
    return Math.max(registerUsed, approvedUsed);
  }

  function fillMonthPoolSummary_(target, employeeId, year, month, emp, counts) {
    target = target || {};
    employeeId = trim_(employeeId);
    year = Number(year);
    month = Number(month);
    if (!emp && employeeId) {
      emp = DbService.findOne(HRMS.SHEETS.EMPLOYEES, { employee_id: employeeId });
    }
    counts = counts || emptyCountsFromPayrollInput_(employeeId, year, month);
    var opening = readOpeningCarry_(employeeId, year, month);
    var grant = grantForEmployeeMonth_(emp || {}, year, month);
    var adj = adjustmentForEmployeeMonth_(employeeId, year, month);
    var used = leaveUsedFromCounts_(counts);
    var pool = opening + grant + adj;
    var split = leavePaidLopSplit_(used, pool);
    target.month_opening_carry = opening;
    target.month_grant = grant;
    target.month_adjustment = adj;
    target.month_pool = pool;
    target.month_used = used;
    target.month_paid = split.paid_leave_days;
    target.month_lop = split.lop_from_excess_leave;
    target.month_available = Math.max(0, pool - used);
    return target;
  }

  function lopFromExcessLeave_(employeeId, year, month, emp, counts) {
    employeeId = trim_(employeeId);
    year = Number(year);
    month = Number(month);
    if (!emp && employeeId) {
      emp = DbService.findOne(HRMS.SHEETS.EMPLOYEES, { employee_id: employeeId });
    }
    counts = counts || emptyCountsFromPayrollInput_(employeeId, year, month);
    var used = leaveUsedFromCounts_(counts);
    var pool = monthlyEntitlementPool_(emp || {}, employeeId, year, month);
    if (typeof AttendanceRegisterService !== 'undefined' && AttendanceRegisterService.leavePaidAndLopSplit_) {
      return AttendanceRegisterService.leavePaidAndLopSplit_(used, pool).lop_from_excess_leave;
    }
    return Math.max(0, used - pool);
  }

  function getSnapshot(employeeId, year, month) {
    employeeId = trim_(employeeId);
    year = Number(year);
    month = Number(month);
    var emp = DbService.findOne(HRMS.SHEETS.EMPLOYEES, { employee_id: employeeId });
    if (!emp) throw notFoundError_('Employee not found.');
    var vertical = verticalCode_(emp);
    var grant = grantForEmployeeMonth_(emp, year, month);
    var adj = adjustmentForEmployeeMonth_(employeeId, year, month);
    var counts = emptyCountsFromPayrollInput_(employeeId, year, month);
    var used = leaveUsedFromCounts_(counts);
    var openingCf = readOpeningCarry_(employeeId, year, month);
    var carryNote = openingCf > 0
      ? 'Includes ' + openingCf + ' day(s) carried forward from the prior month.'
      : '';
    var available = Math.max(0, openingCf + grant + adj - used);
    var entitlementPool = monthlyEntitlementPool_(emp, employeeId, year, month);
    var split = leavePaidLopSplit_(used, entitlementPool);
    var lopDays = split.lop_from_excess_leave;
    var paidLeaveDays = split.paid_leave_days;
    var yearMode = typeof LeavePolicyService !== 'undefined' && LeavePolicyService.leaveYearMode
      ? LeavePolicyService.leaveYearMode()
      : String(ConfigService.getSetting('leave_year_mode', 'CALENDAR') || 'CALENDAR').toUpperCase();
    return {
      employee_id: employeeId,
      period_year: year,
      period_month: month,
      vertical_name: vertical,
      opening_carry_forward_days: openingCf,
      grant_days: grant,
      entitlement_pool_days: entitlementPool,
      used_days: used,
      adjustment_days: adj,
      available_days: available,
      paid_leave_days: paidLeaveDays,
      lop_days: lopDays,
      carry_forward_days: openingCf,
      carry_forward_note: carryNote || (openingCf > 0 ? 'Includes carried-forward balance from prior month.' : ''),
      leave_year_mode: yearMode,
      join_grant_after_day: joinGrantAfterDay_(),
      code_counts: counts,
      source: 'attendance_register'
    };
  }

  function emptyCountsFromPayrollInput_(employeeId, year, month) {
    var counts = { P: 0, 'W/H': 0, A: 0, L: 0, WO: 0, ML: 0, H: 0, '1/2P': 0 };
    var run = DbService.findOne(HRMS.SHEETS.PAYROLL_RUNS, { period_year: year, period_month: month });
    if (!run) return counts;
    var inp = DbService.findOne(HRMS.SHEETS.PAYROLL_INPUTS, {
      payroll_run_id: run.payroll_run_id,
      employee_id: employeeId
    });
    if (!inp || !inp.daily_attendance_json) return counts;
    var reg = AttendanceRegisterService.parseRegister_(inp.daily_attendance_json);
    var dim = AttendanceRegisterService.daysInMonth_(year, month);
    for (var d = 1; d <= dim; d++) {
      var code = AttendanceRegisterService.normalizeCode_(reg[pad2_(d)]);
      if (!code) continue;
      if (code === '1/2P') counts['1/2P']++;
      else if (counts.hasOwnProperty(code)) counts[code]++;
    }
    return counts;
  }

  function saveAdjustment(session, payload) {
    if (!PermissionService.isHrOrAdmin(session)) throw authorizationError_();
    payload = payload || {};
    var employeeId = trim_(payload.employee_id);
    var year = Number(payload.period_year);
    var month = Number(payload.period_month);
    var days = num_(payload.adjustment_days, NaN);
    var reason = trim_(payload.reason);
    if (!employeeId) throw validationError_('Employee is required.');
    if (!isFinite(year) || !isFinite(month) || month < 1 || month > 12) {
      throw validationError_('Valid period year and month are required.');
    }
    if (!isFinite(days) || days === 0) throw validationError_('Adjustment days must be a non-zero number.');
    if (!reason) throw validationError_('Reason is required for manual adjustment.');
    var emp = DbService.findOne(HRMS.SHEETS.EMPLOYEES, { employee_id: employeeId });
    if (!emp) throw notFoundError_('Employee not found.');
    var id = 'LMA' + Utilities.getUuid().replace(/-/g, '').slice(0, 12).toUpperCase();
    var now = new Date().toISOString();
    DbService.appendRecord(HRMS.SHEETS.LEAVE_MONTHLY_ADJUSTMENTS, {
      adjustment_id: id,
      employee_id: employeeId,
      period_year: year,
      period_month: month,
      adjustment_days: days,
      reason: reason,
      created_at: now,
      created_by_email: session.email || ''
    });
    return getSnapshot(employeeId, year, month);
  }

  return {
    grantForEmployeeMonth_: grantForEmployeeMonth_,
    leaveUsedFromCounts_: leaveUsedFromCounts_,
    availableAfterCounts_: availableAfterCounts_,
    baseMonthlyGrant_: baseMonthlyGrant_,
    adjustmentForEmployeeMonth_: adjustmentForEmployeeMonth_,
    monthlyEntitlementPool_: monthlyEntitlementPool_,
    lopFromExcessLeave_: lopFromExcessLeave_,
    fillMonthPoolSummary_: fillMonthPoolSummary_,
    leavePaidLopSplit_: leavePaidLopSplit_,
    readOpeningCarry_: readOpeningCarry_,
    emptyCountsFromPayrollInput_: emptyCountsFromPayrollInput_,
    getSnapshot: getSnapshot,
    saveAdjustment: saveAdjustment
  };
})();
