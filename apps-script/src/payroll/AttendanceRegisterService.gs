/**
 * Monthly attendance register - daily codes (P, W/H, A, L, WO, ML, H) and payroll day derivation.
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
    S: 'ML'
  };

  var SUMMARY_HEADERS_ = ['P', 'W/H', 'A', 'L', 'WO', 'ML', 'H', 'Leave Balance', 'DAYS'];
  var CODE_KEYS_ = ['P', 'W/H', 'A', 'L', 'WO', 'ML', 'H'];

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

  function computeDaysTotal_(counts) {
    counts = counts || {};
    return (Number(counts.P) || 0) + (Number(counts['W/H']) || 0) + (Number(counts.L) || 0) +
      (Number(counts.WO) || 0) + (Number(counts.ML) || 0) + (Number(counts.H) || 0);
  }

  function leaveBalanceMaxForVertical_(verticalCode) {
    var v = trim_(verticalCode).toUpperCase();
    var map = HRMS.ATTENDANCE_LEAVE_BALANCE_MAX || {};
    if (map.hasOwnProperty(v)) return Number(map[v]) || 0;
    return Number(map.OTHERS) || 0;
  }

  function computeLeaveBalance_(counts, verticalCode) {
    counts = counts || {};
    var max = leaveBalanceMaxForVertical_(verticalCode);
    var used = (Number(counts.L) || 0) + (Number(counts.ML) || 0);
    return Math.max(0, max - used);
  }

  function summarize_(reg, year, month, verticalCode) {
    reg = reg || {};
    var dim = daysInMonth_(year, month);
    var counts = emptyCodeCounts_();
    for (var d = 1; d <= dim; d++) {
      var code = normalizeCode_(reg[pad2_(d)]);
      if (code && counts.hasOwnProperty(code)) counts[code]++;
    }
    var leaveDays = counts.L + counts.ML;
    var daysTotal = computeDaysTotal_(counts);
    var vertical = trim_(verticalCode).toUpperCase();
    return {
      present: counts.P,
      week_off_holiday: counts['W/H'],
      absent: counts.A,
      leave: counts.L,
      week_off: counts.WO,
      medical_leave: counts.ML,
      holiday: counts.H,
      leave_days: leaveDays,
      days_total: daysTotal,
      leave_balance: computeLeaveBalance_(counts, vertical),
      days_in_month: dim,
      code_counts: counts
    };
  }

  function derivePayrollDays_(summary) {
    summary = summary || {};
    var present = Number(summary.present) || 0;
    var absent = Number(summary.absent) || 0;
    var leaveDays = Number(summary.leave_days) || 0;
    var daysTotal = Number(summary.days_total);
    if (isFinite(daysTotal) && daysTotal >= 0) {
      return {
        working_days: daysTotal + absent,
        paid_days: daysTotal,
        lop_days: absent,
        days_present: present,
        days_absent: absent,
        leave_days: leaveDays
      };
    }
    var dim = Number(summary.days_in_month) || 0;
    var wh = Number(summary.week_off_holiday) || 0;
    var holiday = Number(summary.holiday) || 0;
    var working = present + absent + leaveDays;
    if (working <= 0 && dim > 0) {
      working = dim - wh - holiday;
    }
    if (working <= 0) working = dim || 0;
    var paid = present + leaveDays;
    var lop = absent;
    if (paid + lop > working) {
      working = paid + lop;
    }
    return {
      working_days: working,
      paid_days: paid,
      lop_days: lop,
      days_present: present,
      days_absent: absent,
      leave_days: leaveDays
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

  function buildTemplateHeaders_(year, month) {
    var dim = daysInMonth_(year, month);
    var row1 = ['', '', ''];
    var row2 = ['employee_id', 'display_name', 'vertical_name'];
    for (var d = 1; d <= dim; d++) {
      row1.push(dayAbbr_(year, month, d));
      row2.push(pad2_(d));
    }
    SUMMARY_HEADERS_.forEach(function (h) {
      row1.push('');
      row2.push(h);
    });
    return { row1: row1, row2: row2, daysInMonth: dim, dayStartCol: 4 };
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

  function leaveBalanceFormula_(range, verticalCell) {
    var l = 'COUNTIF(' + range + ',"L")';
    var ml = 'COUNTIF(' + range + ',"ML")+COUNTIF(' + range + ',"S")';
    var maxExpr = 'IF(' + verticalCell + '="SAPL",2,IF(' + verticalCell + '="AOPL",2,IF(' + verticalCell + '="AOMS",1,2)))';
    return '=MAX(0,' + maxExpr + '-(' + l + '+' + ml + '))';
  }

  function summaryFormulasForRow_(sheetRow, year, month) {
    var dim = daysInMonth_(year, month);
    var firstCol = 4;
    var lastDayCol = firstCol + dim - 1;
    var start = colToLetter_(firstCol) + sheetRow;
    var end = colToLetter_(lastDayCol) + sheetRow;
    var range = start + ':' + end;
    var verticalCell = 'C' + sheetRow;
    var dayParts = [];
    ['P', 'W/H', 'L', 'WO', 'ML', 'H'].forEach(function (code) {
      if (code === 'W/H') {
        dayParts.push('COUNTIF(' + range + ',"W"&CHAR(47)&"H")+COUNTIF(' + range + ',"WH")+COUNTIF(' + range + ',"W")');
      } else if (code === 'ML') {
        dayParts.push('COUNTIF(' + range + ',"ML")+COUNTIF(' + range + ',"S")');
      } else {
        dayParts.push('COUNTIF(' + range + ',"' + code + '")');
      }
    });
    var formulas = {
      P: '=COUNTIF(' + range + ',"P")',
      'W/H': '=COUNTIF(' + range + ',"W"&CHAR(47)&"H")+COUNTIF(' + range + ',"WH")+COUNTIF(' + range + ',"W")',
      A: '=COUNTIF(' + range + ',"A")',
      L: '=COUNTIF(' + range + ',"L")',
      WO: '=COUNTIF(' + range + ',"WO")',
      ML: '=COUNTIF(' + range + ',"ML")+COUNTIF(' + range + ',"S")',
      H: '=COUNTIF(' + range + ',"H")',
      'Leave Balance': leaveBalanceFormula_(range, verticalCell),
      'Leave Balan': leaveBalanceFormula_(range, verticalCell),
      DAYS: '=' + dayParts.join('+')
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
    return {
      employee_id: empId,
      display_name: displayName,
      vertical_name: vertical,
      register: reg
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

  function listSummariesForRun_(runId) {
    requireAttendanceAccess_();
    var run = DbService.findOne(HRMS.SHEETS.PAYROLL_RUNS, { payroll_run_id: runId });
    if (!run) throw notFoundError_('Payroll run not found.');
    var year = Number(run.period_year);
    var month = Number(run.period_month);
    var inputByEmp = {};
    DbService.findRecords(HRMS.SHEETS.PAYROLL_INPUTS, { payroll_run_id: runId }).forEach(function (inp) {
      var key = trim_(inp.employee_id).toUpperCase();
      if (key) inputByEmp[key] = inp;
    });
    return listEmployeesForPayrollPeriod_(year, month).map(function (emp) {
      var empKey = trim_(emp.employee_id).toUpperCase();
      var inp = inputByEmp[empKey] || inputByEmp[trim_(emp.employee_id)] || null;
      var inp = inputByEmp[emp.employee_id] || null;
      var reg = inp ? parseRegister_(inp.daily_attendance_json) : {};
      var sum = summarize_(reg, year, month, emp.vertical_name);
      return {
        employee_id: emp.employee_id,
        display_name: employeeDisplayName_(emp),
        vertical_name: trim_(emp.vertical_name),
        payroll_input_id: inp ? inp.payroll_input_id : '',
        in_payroll_run: !!inp,
        days_present: sum.present,
        days_leave: sum.leave_days,
        days_total: sum.days_total,
        register_complete: inp ? isRegisterComplete_(reg, year, month) : false,
        register: reg,
        code_counts: sum.code_counts,
        summary: sum
      };
    });
  }

  function saveRegisterForInput_(inp, reg, year, month, verticalCode) {
    var summary = summarize_(reg, year, month, verticalCode);
    var derived = derivePayrollDays_(summary);
    return {
      daily_attendance_json: stringifyRegister_(reg),
      working_days: derived.working_days,
      paid_days: derived.paid_days,
      lop_days: derived.lop_days
    };
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
    computeDaysTotal_: computeDaysTotal_,
    leaveBalanceMaxForVertical_: leaveBalanceMaxForVertical_,
    computeLeaveBalance_: computeLeaveBalance_,
    derivePayrollDays_: derivePayrollDays_,
    isRegisterComplete_: isRegisterComplete_,
    buildTemplateHeaders_: buildTemplateHeaders_,
    colToLetter_: colToLetter_,
    summaryFormulasForRow_: summaryFormulasForRow_,
    rowFromSheetValues_: rowFromSheetValues_,
    filterEmployeesByVertical_: filterEmployeesByVertical_,
    employeeDisplayName_: employeeDisplayName_,
    listActiveEmployees_: listActiveEmployees_,
    listEmployeesForPayrollPeriod_: listEmployeesForPayrollPeriod_,
    listSummariesForRun_: listSummariesForRun_,
    saveRegisterForInput_: saveRegisterForInput_
  };
})();
