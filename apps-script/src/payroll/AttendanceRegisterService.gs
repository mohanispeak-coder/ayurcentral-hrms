/**
 * Monthly attendance register - daily codes (P, W/H, A, L, WO, ML, H, 1/2P) and payroll day derivation.
 * Legacy upload alias: S maps to ML on read only.
 */
var HRMS = HRMS || {};

var AttendanceRegisterService = (function () {
  var VALID_CODES_ = {
    P: 'P',
    'W/H': 'W/H',
    WH: 'W/H',
    W: 'W/H',
    A: 'A',
    L: 'L',
    WO: 'WO',
    ML: 'ML',
    H: 'H',
    S: 'ML',
    '1/2P': '1/2P',
    HALFP: '1/2P',
    HP: '1/2P'
  };

  var SUMMARY_HEADERS_ = ['P', 'W/H', 'A', 'L', 'WO', 'ML', 'H', 'Leave Balance', 'DAYS'];
  var CODE_KEYS_ = ['P', 'W/H', 'A', 'L', 'WO', 'ML', 'H', '1/2P'];

  function trim_(v) {
    return v == null ? '' : String(v).trim();
  }

  function pad2_(n) {
    n = String(Number(n));
    return n.length < 2 ? '0' + n : n;
  }

  function daysInMonth_(year, month) {
    return new Date(Number(year), Number(month), 0).getDate();
  }

  function dayAbbr_(year, month, day) {
    var d = new Date(Number(year), Number(month) - 1, Number(day));
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  }

  function normalizeCode_(raw) {
    var s = trim_(raw).toUpperCase();
    if (!s) return '';
    if (s === 'W/H' || s === 'WH' || s === 'W') return 'W/H';
    if (s === 'S') return 'ML';
    var compact = s.replace(/\s+/g, '');
    if (compact === '1/2P' || compact === 'HALFP' || compact === 'HP' || s === '1/2 P') return '1/2P';
    if (VALID_CODES_[s]) return VALID_CODES_[s];
    return '';
  }

  function emptyCodeCounts_() {
    var counts = {};
    CODE_KEYS_.forEach(function (k) { counts[k] = 0; });
    return counts;
  }

  function parseRegister_(jsonOrObj) {
    if (!jsonOrObj) return {};
    var obj = jsonOrObj;
    if (typeof jsonOrObj === 'string') {
      try {
        obj = JSON.parse(jsonOrObj);
      } catch (ignore) {
        return {};
      }
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    var out = {};
    Object.keys(obj).forEach(function (k) {
      var day = pad2_(k);
      var code = normalizeCode_(obj[k]);
      if (code) out[day] = code;
    });
    return out;
  }

  function stringifyRegister_(reg) {
    return JSON.stringify(reg || {});
  }

  function halfDayCount_(counts) {
    return Number(counts && counts['1/2P']) || 0;
  }

  function halfDayPresent_(counts) {
    return halfDayCount_(counts) * 0.5;
  }

  /**
   * DAYS column = paid days for the month (excludes A = absent / LOP). ½P is already split into P + L.
   */
  function computeDaysTotalFromSummary_(summary) {
    summary = summary || {};
    return (Number(summary.present) || 0) +
      (Number(summary.week_off_holiday) || 0) +
      (Number(summary.leave_days_l_column) || 0) +
      (Number(summary.week_off) || 0) +
      (Number(summary.medical_leave_l_column) || 0) +
      (Number(summary.holiday) || 0);
  }

  function leaveBalanceMaxForVertical_(verticalCode) {
    if (typeof MonthlyLeaveService !== 'undefined' && MonthlyLeaveService.baseMonthlyGrant_) {
      return Number(MonthlyLeaveService.baseMonthlyGrant_(verticalCode)) || 0;
    }
    var v = trim_(verticalCode).toUpperCase();
    var map = HRMS.ATTENDANCE_LEAVE_BALANCE_MAX || {};
    if (map.hasOwnProperty(v)) return Number(map[v]) || 0;
    return Number(map.OTHERS) || 0;
  }

  function computeLeaveBalance_(counts, verticalCode, emp, year, month) {
    counts = counts || {};
    if (typeof MonthlyLeaveService !== 'undefined' && MonthlyLeaveService.availableAfterCounts_) {
      return MonthlyLeaveService.availableAfterCounts_(emp || { vertical_name: verticalCode }, year, month, counts);
    }
    var max = leaveBalanceMaxForVertical_(verticalCode);
    var used = (Number(counts.L) || 0) + (Number(counts.ML) || 0) + halfDayPresent_(counts);
    return Math.max(0, max - used);
  }

  function summarize_(reg, year, month, verticalCode, emp) {
    reg = reg || {};
    var dim = daysInMonth_(year, month);
    var counts = emptyCodeCounts_();
    for (var d = 1; d <= dim; d++) {
      var code = normalizeCode_(reg[pad2_(d)]);
      if (code && counts.hasOwnProperty(code)) counts[code]++;
    }
    var halfPresent = halfDayPresent_(counts);
    var leaveDays = counts.L + counts.ML + halfPresent;
    var vertical = trim_(verticalCode).toUpperCase();
    var monthlyGrant = (typeof MonthlyLeaveService !== 'undefined' && MonthlyLeaveService.grantForEmployeeMonth_)
      ? MonthlyLeaveService.grantForEmployeeMonth_(emp, year, month)
      : leaveBalanceMaxForVertical_(vertical);
    var entitlementPool = monthlyGrant;
    if (emp && emp.employee_id && typeof MonthlyLeaveService !== 'undefined' &&
        MonthlyLeaveService.monthlyEntitlementPool_) {
      entitlementPool = MonthlyLeaveService.monthlyEntitlementPool_(emp, emp.employee_id, year, month);
    }
    var leaveSplit = leavePaidAndLopSplit_(leaveDays, entitlementPool);
    var colSplit = leaveSummaryColumnSplit_(counts, entitlementPool);
    var summaryForDays = {
      present: counts.P + halfPresent,
      week_off_holiday: counts['W/H'],
      leave_days_l_column: colSplit.leave_days_l_column,
      week_off: counts.WO,
      medical_leave_l_column: colSplit.medical_leave_l_column,
      holiday: counts.H
    };
    return {
      present: summaryForDays.present,
      week_off_holiday: summaryForDays.week_off_holiday,
      absent: counts.A,
      leave: counts.L,
      week_off: summaryForDays.week_off,
      medical_leave: counts.ML,
      holiday: summaryForDays.holiday,
      leave_days: leaveDays,
      leave_days_l_column: colSplit.leave_days_l_column,
      absent_a_column: colSplit.absent_a_column,
      medical_leave_l_column: colSplit.medical_leave_l_column,
      days_total: computeDaysTotalFromSummary_(summaryForDays),
      leave_balance: computeLeaveBalance_(counts, vertical, emp, year, month),
      monthly_grant: monthlyGrant,
      monthly_entitlement_pool: entitlementPool,
      paid_leave_days: leaveSplit.paid_leave_days,
      lop_from_excess_leave: leaveSplit.lop_from_excess_leave,
      days_in_month: dim,
      code_counts: counts
    };
  }

  function leavePaidAndLopSplit_(leaveDays, entitlementPool) {
    leaveDays = Number(leaveDays) || 0;
    entitlementPool = Math.max(0, Number(entitlementPool) || 0);
    var paidLeave = Math.min(leaveDays, entitlementPool);
    return {
      paid_leave_days: paidLeave,
      lop_from_excess_leave: Math.max(0, leaveDays - paidLeave)
    };
  }

  /**
   * Summary L / A / ML columns after monthly pool: ½P leave counts toward L while pool has room; excess → A (LOP).
   * ML consumes pool first, then L + half-day leave portions.
   */
  function leaveSummaryColumnSplit_(counts, entitlementPool) {
    counts = counts || {};
    var rawL = (Number(counts.L) || 0) + halfDayPresent_(counts);
    var rawML = Number(counts.ML) || 0;
    var rawA = Number(counts.A) || 0;
    var used = rawL + rawML;
    var pool = Math.max(0, Number(entitlementPool) || 0);
    var paid = Math.min(used, pool);
    var excess = Math.max(0, used - pool);
    var paidML = Math.min(rawML, paid);
    var paidL = Math.min(rawL, Math.max(0, paid - paidML));
    return {
      leave_days_l_column: paidL,
      medical_leave_l_column: paidML,
      absent_a_column: rawA + excess,
      lop_from_excess_leave: excess
    };
  }

  function paidDaysFromSummary_(summary, split) {
    summary = summary || {};
    split = split || {};
    return (Number(summary.present) || 0) +
      (Number(summary.week_off_holiday) || 0) +
      (Number(summary.week_off) || 0) +
      (Number(summary.holiday) || 0) +
      (Number(summary.medical_leave) || 0) +
      (Number(split.paid_leave_days) || 0);
  }

  function derivePayrollDays_(summary) {
    summary = summary || {};
    var present = Number(summary.present) || 0;
    var absent = Number(summary.absent) || 0;
    var leaveDays = Number(summary.leave_days) || 0;
    var pool = Number(summary.monthly_entitlement_pool);
    if (!isFinite(pool)) pool = Number(summary.monthly_grant) || 0;
    var split = leavePaidAndLopSplit_(leaveDays, pool);
    if (summary.paid_leave_days != null && isFinite(Number(summary.paid_leave_days))) {
      split.paid_leave_days = Number(summary.paid_leave_days);
      split.lop_from_excess_leave = Number(summary.lop_from_excess_leave) || 0;
    }
    var lopFromLeave = split.lop_from_excess_leave;
    var paid = paidDaysFromSummary_(summary, split);
    var lop = absent + lopFromLeave;
    var working = paid + lop;
    var dim = Number(summary.days_in_month) || 0;
    if (working <= 0 && dim > 0) {
      var wh = Number(summary.week_off_holiday) || 0;
      var holiday = Number(summary.holiday) || 0;
      working = Math.max(working, dim - wh - holiday);
    }
    return {
      working_days: working,
      paid_days: paid,
      lop_days: lop,
      days_present: present,
      days_absent: absent,
      leave_days: leaveDays,
      paid_leave_days: split.paid_leave_days,
      lop_from_excess_leave: lopFromLeave,
      days_total: Number(summary.days_total) || 0
    };
  }

  function isRegisterComplete_(reg, year, month) {
    reg = reg || {};
    var dim = daysInMonth_(year, month);
    for (var d = 1; d <= dim; d++) {
      if (!reg[pad2_(d)]) return false;
    }
    return true;
  }

  var TEMPLATE_POOL_COL_ = 4;

  function buildTemplateHeaders_(year, month) {
    var dim = daysInMonth_(year, month);
    var row1 = ['', '', '', 'Pool'];
    var row2 = ['employee_id', 'display_name', 'vertical_name', 'leave_pool'];
    for (var d = 1; d <= dim; d++) {
      row1.push(dayAbbr_(year, month, d));
      row2.push(pad2_(d));
    }
    SUMMARY_HEADERS_.forEach(function (h) {
      row1.push('');
      row2.push(h);
    });
    var extraHeaders = (typeof AttendancePayrollExtras !== 'undefined' && AttendancePayrollExtras.templateHeaders)
      ? AttendancePayrollExtras.templateHeaders() : [];
    extraHeaders.forEach(function (h) {
      row1.push('Payroll');
      row2.push(h);
    });
    return {
      row1: row1,
      row2: row2,
      daysInMonth: dim,
      dayStartCol: TEMPLATE_POOL_COL_ + 1,
      poolCol: TEMPLATE_POOL_COL_,
      payrollExtraHeaders: extraHeaders,
      payrollExtraStartCol: row2.length - extraHeaders.length + 1
    };
  }

  function monthlyPoolForTemplateRow_(emp, year, month) {
    year = Number(year);
    month = Number(month);
    if (!emp) return 0;
    if (typeof MonthlyLeaveService !== 'undefined' && MonthlyLeaveService.monthlyEntitlementPool_) {
      return MonthlyLeaveService.monthlyEntitlementPool_(emp, emp.employee_id, year, month);
    }
    return leaveBalanceMaxForVertical_(emp.vertical_name);
  }

  function colToLetter_(col) {
    var s = '';
    while (col > 0) {
      var m = (col - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      col = Math.floor((col - 1) / 26);
    }
    return s;
  }

  /** COUNTIF for half-day codes — CHAR(47) so Excel does not treat 1/2 as a date in formulas. */
  function halfDayCountExpr_(range, weighted) {
    var slash = '"1"&CHAR(47)&"2';
    var count = 'COUNTIF(' + range + ',' + slash + 'P")+COUNTIF(' + range + ',' + slash + ' P")' +
      '+COUNTIF(' + range + ',"HP")+COUNTIF(' + range + ',"HALFP")';
    return weighted ? '(' + count + ')*0.5' : count;
  }

  function leaveBalanceFormula_(range, poolCell) {
    var l = 'COUNTIF(' + range + ',"L")';
    var ml = 'COUNTIF(' + range + ',"ML")+COUNTIF(' + range + ',"S")';
    var halfLeave = halfDayCountExpr_(range, true);
    return '=MAX(0,' + poolCell + '-(' + l + '+' + ml + '+' + halfLeave + '))';
  }

  function poolAwareLeaveExprs_(range, poolCell) {
    var lRaw = 'COUNTIF(' + range + ',"L")';
    var halfLeave = halfDayCountExpr_(range, true);
    var rawL = '(' + lRaw + '+' + halfLeave + ')';
    var rawML = 'COUNTIF(' + range + ',"ML")+COUNTIF(' + range + ',"S")';
    var used = '(' + rawL + '+' + rawML + ')';
    var paid = 'MIN(' + poolCell + ',' + used + ')';
    var excess = 'MAX(0,' + used + '-' + poolCell + ')';
    var paidML = 'MIN(' + rawML + ',' + paid + ')';
    var paidL = 'MIN(' + rawL + ',MAX(0,' + paid + '-' + paidML + '))';
    return { rawL: rawL, rawML: rawML, paidL: paidL, paidML: paidML, excess: excess };
  }

  function summaryFormulasForRow_(sheetRow, year, month) {
    var dim = daysInMonth_(year, month);
    var firstCol = TEMPLATE_POOL_COL_ + 1;
    var lastDayCol = firstCol + dim - 1;
    var start = colToLetter_(firstCol) + sheetRow;
    var end = colToLetter_(lastDayCol) + sheetRow;
    var range = start + ':' + end;
    var poolCell = colToLetter_(TEMPLATE_POOL_COL_) + sheetRow;
    var poolLeave = poolAwareLeaveExprs_(range, poolCell);
    var sumColP = lastDayCol + 1;
    var sumColWH = sumColP + 1;
    var sumColL = sumColP + 3;
    var sumColWO = sumColP + 4;
    var sumColML = sumColP + 5;
    var sumColH = sumColP + 6;
    var paidDaysExpr = colToLetter_(sumColP) + sheetRow + '+' + colToLetter_(sumColWH) + sheetRow + '+' +
      colToLetter_(sumColL) + sheetRow + '+' + colToLetter_(sumColWO) + sheetRow + '+' +
      colToLetter_(sumColML) + sheetRow + '+' + colToLetter_(sumColH) + sheetRow;
    var formulas = {
      P: '=COUNTIF(' + range + ',"P")+' + halfDayCountExpr_(range, true),
      'W/H': '=COUNTIF(' + range + ',"W"&CHAR(47)&"H")+COUNTIF(' + range + ',"WH")+COUNTIF(' + range + ',"W")',
      A: '=COUNTIF(' + range + ',"A")+' + poolLeave.excess,
      L: '=' + poolLeave.paidL,
      WO: '=COUNTIF(' + range + ',"WO")',
      ML: '=' + poolLeave.paidML,
      H: '=COUNTIF(' + range + ',"H")',
      'Leave Balance': leaveBalanceFormula_(range, poolCell),
      'Leave Balan': leaveBalanceFormula_(range, poolCell),
      DAYS: '=' + paidDaysExpr
    };
    return formulas;
  }

  function rowFromSheetValues_(line, headers, year, month) {
    var reg = {};
    var dim = daysInMonth_(year, month);
    var empId = '';
    var displayName = '';
    var vertical = '';
    headers.forEach(function (h, i) {
      var valStr = trim_(line[i]);
      var headerLabel = trim_(h);
      var key = headerLabel.toLowerCase().replace(/\s+/g, '_');
      if (key === 'employee_id') empId = valStr;
      else if (key === 'display_name') displayName = valStr;
      else if (key === 'vertical_name' || key === 'vertical') vertical = valStr;
      else if (key === 'leave_pool') { /* snapshot at download; formulas use live pool in sheet */ }
      else {
        var dayKey = '';
        if (/^\d{1,2}$/.test(key)) dayKey = pad2_(key);
        else if (typeof h === 'number' && isFinite(h) && h >= 1 && h <= 31) dayKey = pad2_(h);
        if (dayKey && Number(dayKey) <= dim) {
          var code = normalizeCode_(valStr);
          if (code) reg[dayKey] = code;
        }
      }
    });
    var payrollExtras = null;
    if (typeof AttendancePayrollExtras !== 'undefined' && AttendancePayrollExtras.parseFromSheetRow) {
      try {
        payrollExtras = AttendancePayrollExtras.parseFromSheetRow(line, headers);
      } catch (parseErr) {
        payrollExtras = { _error: parseErr.message || String(parseErr) };
      }
    }
    return {
      employee_id: empId,
      display_name: displayName,
      vertical_name: vertical,
      register: reg,
      payroll_extras: payrollExtras
    };
  }

  function normalizeVerticalCode_(code) {
    return trim_(code).toUpperCase();
  }

  function employeeVerticalCode_(emp) {
    var v = normalizeVerticalCode_(emp && emp.vertical_name);
    if (!v && emp && emp.employee_id) {
      v = normalizeVerticalCode_(String(emp.employee_id).split('-')[0]);
    }
    return v;
  }

  function filterEmployeesByVertical_(employees, verticalCode) {
    var want = normalizeVerticalCode_(verticalCode);
    if (!want) return employees || [];
    return (employees || []).filter(function (emp) {
      return employeeVerticalCode_(emp) === want;
    });
  }

  function listEmployeesForPayrollPeriod_(year, month) {
    try {
      if (typeof PayrollService !== 'undefined' && PayrollService.listEligibleEmployeesForPeriod) {
        var eligible = PayrollService.listEligibleEmployeesForPeriod(year, month) || [];
        if (eligible.length) {
          return eligible.slice().sort(function (a, b) {
            return String(a.employee_id).localeCompare(String(b.employee_id));
          });
        }
      }
    } catch (ignorePayroll) {}
    return listActiveEmployees_();
  }

  function listActiveEmployees_() {
    var rows = [];
    var fromEmployeeService = false;
    try {
      if (typeof EmployeeService !== 'undefined' && EmployeeService.listActiveEmployees) {
        rows = EmployeeService.listActiveEmployees() || [];
        fromEmployeeService = true;
      } else if (typeof EmployeeRepository !== 'undefined' && EmployeeRepository.listAll) {
        rows = EmployeeRepository.listAll() || [];
      }
    } catch (ignoreRepo) {}
    if (!rows.length) {
      rows = DbService.getAllRecords(HRMS.SHEETS.EMPLOYEES) || [];
    }
    if (!fromEmployeeService) {
      rows = rows.filter(function (e) {
        var st = String(e.status || 'ACTIVE').toUpperCase();
        if (st === 'INACTIVE') return false;
        if (HRMS.EMPLOYEE_STATUS && HRMS.EMPLOYEE_STATUS.ACTIVE) {
          return st === String(HRMS.EMPLOYEE_STATUS.ACTIVE).toUpperCase();
        }
        return true;
      });
    }
    return rows.slice().sort(function (a, b) {
      return String(a.employee_id).localeCompare(String(b.employee_id));
    });
  }

  function employeeDisplayName_(emp) {
    if (!emp) return '';
    var name = trim_(emp.display_name);
    if (name) return name;
    return trim_((emp.first_name || '') + ' ' + (emp.last_name || '')) || trim_(emp.employee_id);
  }

  function requireAttendanceAccess_() {
    PermissionService.requireAttendanceAccess();
  }

  function runVerticalFromRun_(run) {
    var v = normalizeVerticalCode_(run && run.vertical_name);
    if (v) return v;
    var parts = String(run && run.payroll_run_id || '').trim().split('-');
    if (parts[0] !== 'PR' || parts.length < 4) return '';
    var token = trim_(parts[3]);
    if (!token || /^C\d+$/i.test(token)) return '';
    return normalizeVerticalCode_(token);
  }

  function summaryRowForEmployee_(emp, inp, year, month, options) {
    options = options || {};
    var reg = inp ? parseRegister_(inp.daily_attendance_json) : {};
    var sum = summarize_(reg, year, month, emp.vertical_name, emp);
    var row = {
      employee_id: emp.employee_id,
      display_name: employeeDisplayName_(emp),
      vertical_name: trim_(emp.vertical_name),
      payroll_input_id: inp ? inp.payroll_input_id : '',
      in_payroll_run: !!inp,
      days_present: sum.present,
      days_leave: sum.leave_days,
      leave_balance: sum.leave_balance,
      monthly_grant: sum.monthly_grant,
      days_total: sum.days_total,
      register_complete: inp ? isRegisterComplete_(reg, year, month) : false,
      code_counts: sum.code_counts,
      summary: sum,
      payroll_extras: inp && typeof AttendancePayrollExtras !== 'undefined' && AttendancePayrollExtras.readFromInput
        ? AttendancePayrollExtras.readFromInput(inp) : null
    };
    if (options.includeRegister) row.register = reg;
    return row;
  }

  /**
   * @param {string} runId
   * @param {Object=} options { includeRegister: boolean } — omit daily register map on list loads (smaller payload).
   */
  function listSummariesForRun_(runId, options) {
    requireAttendanceAccess_();
    options = options || {};
    var run = DbService.findOne(HRMS.SHEETS.PAYROLL_RUNS, { payroll_run_id: runId });
    if (!run) throw notFoundError_('Payroll run not found.');
    var year = Number(run.period_year);
    var month = Number(run.period_month);
    var inputByEmp = {};
    DbService.findRecords(HRMS.SHEETS.PAYROLL_INPUTS, { payroll_run_id: runId }).forEach(function (inp) {
      var key = trim_(inp.employee_id).toUpperCase();
      if (key) inputByEmp[key] = inp;
    });
    var employees = listEmployeesForPayrollPeriod_(year, month);
    var runVertical = runVerticalFromRun_(run);
    if (runVertical) employees = filterEmployeesByVertical_(employees, runVertical);
    return employees.map(function (emp) {
      var empKey = trim_(emp.employee_id).toUpperCase();
      var inp = inputByEmp[empKey] || inputByEmp[trim_(emp.employee_id)] || null;
      return summaryRowForEmployee_(emp, inp, year, month, options);
    });
  }

  function saveRegisterForInput_(inp, reg, year, month, verticalCode, payrollExtras) {
    var emp = inp && inp.employee_id
      ? DbService.findOne(HRMS.SHEETS.EMPLOYEES, { employee_id: inp.employee_id })
      : null;
    var summary = summarize_(reg, year, month, verticalCode, emp);
    var derived = derivePayrollDays_(summary);
    var updates = {
      daily_attendance_json: stringifyRegister_(reg),
      working_days: derived.working_days,
      paid_days: derived.paid_days,
      lop_days: derived.lop_days
    };
    if (payrollExtras && typeof AttendancePayrollExtras !== 'undefined' && AttendancePayrollExtras.normalizeInputUpdates) {
      if (payrollExtras._error) throw validationError_(payrollExtras._error);
      var extraFields = AttendancePayrollExtras.normalizeInputUpdates(payrollExtras);
      Object.keys(extraFields).forEach(function (k) { updates[k] = extraFields[k]; });
    }
    return updates;
  }

  /** Recompute working / paid / LOP from daily_attendance_json (includes ½P in paid_days). */
  function applyDerivedDaysToInput_(inp, year, month, verticalCode, emp) {
    inp = inp || {};
    if (!trim_(inp.daily_attendance_json)) return inp;
    var reg = parseRegister_(inp.daily_attendance_json);
    if (!reg || !Object.keys(reg).length) return inp;
    if (!emp && inp.employee_id && typeof DbService !== 'undefined') {
      emp = DbService.findOne(HRMS.SHEETS.EMPLOYEES, { employee_id: inp.employee_id });
    }
    var summary = summarize_(reg, year, month, verticalCode || (emp && emp.vertical_name), emp);
    var derived = derivePayrollDays_(summary);
    var out = {};
    Object.keys(inp).forEach(function (k) { out[k] = inp[k]; });
    out.working_days = derived.working_days;
    out.paid_days = derived.paid_days;
    out.lop_days = derived.lop_days;
    return out;
  }

  return {
    pad2_: pad2_,
    VALID_CODES: VALID_CODES_,
    SUMMARY_HEADERS: SUMMARY_HEADERS_,
    daysInMonth_: daysInMonth_,
    dayAbbr_: dayAbbr_,
    normalizeCode_: normalizeCode_,
    parseRegister_: parseRegister_,
    stringifyRegister_: stringifyRegister_,
    summarize_: summarize_,
    computeDaysTotalFromSummary_: computeDaysTotalFromSummary_,
    leaveBalanceMaxForVertical_: leaveBalanceMaxForVertical_,
    computeLeaveBalance_: computeLeaveBalance_,
    leavePaidAndLopSplit_: leavePaidAndLopSplit_,
    leaveSummaryColumnSplit_: leaveSummaryColumnSplit_,
    poolAwareLeaveExprs_: poolAwareLeaveExprs_,
    derivePayrollDays_: derivePayrollDays_,
    halfDayCountExpr_: halfDayCountExpr_,
    isRegisterComplete_: isRegisterComplete_,
    buildTemplateHeaders_: buildTemplateHeaders_,
    monthlyPoolForTemplateRow_: monthlyPoolForTemplateRow_,
    templatePoolCol_: function () { return TEMPLATE_POOL_COL_; },
    colToLetter_: colToLetter_,
    summaryFormulasForRow_: summaryFormulasForRow_,
    rowFromSheetValues_: rowFromSheetValues_,
    filterEmployeesByVertical_: filterEmployeesByVertical_,
    employeeDisplayName_: employeeDisplayName_,
    listActiveEmployees_: listActiveEmployees_,
    listEmployeesForPayrollPeriod_: listEmployeesForPayrollPeriod_,
    listSummariesForRun_: listSummariesForRun_,
    saveRegisterForInput_: saveRegisterForInput_,
    applyDerivedDaysToInput_: applyDerivedDaysToInput_
  };
})();
