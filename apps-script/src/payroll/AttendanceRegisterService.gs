/**
 * Monthly attendance register — daily codes (P, W/H, A, L, H, S) and payroll day derivation.
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
    H: 'H',
    S: 'S'
  };

  var SUMMARY_HEADERS_ = ['P', 'W/H', 'A', 'L', 'H', 'S', 'Leave Balan', 'DAYS'];

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
    if (VALID_CODES_[s]) return VALID_CODES_[s];
    return '';
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

  function summarize_(reg, year, month) {
    reg = reg || {};
    var dim = daysInMonth_(year, month);
    var counts = { P: 0, 'W/H': 0, A: 0, L: 0, H: 0, S: 0 };
    for (var d = 1; d <= dim; d++) {
      var code = reg[pad2_(d)];
      if (code && counts.hasOwnProperty(code)) counts[code]++;
    }
    var leaveDays = counts.L + counts.S;
    return {
      present: counts.P,
      week_off_holiday: counts['W/H'],
      absent: counts.A,
      leave: counts.L,
      holiday: counts.H,
      sick: counts.S,
      leave_days: leaveDays,
      days_in_month: dim
    };
  }

  function derivePayrollDays_(summary) {
    summary = summary || {};
    var present = Number(summary.present) || 0;
    var absent = Number(summary.absent) || 0;
    var leaveDays = Number(summary.leave_days) || 0;
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

  function summaryFormulasForRow_(sheetRow, year, month) {
    var dim = daysInMonth_(year, month);
    var firstCol = 4;
    var lastDayCol = firstCol + dim - 1;
    var start = colToLetter_(firstCol) + sheetRow;
    var end = colToLetter_(lastDayCol) + sheetRow;
    var range = start + ':' + end;
    return {
      P: '=COUNTIF(' + range + ',"P")',
      'W/H': '=COUNTIF(' + range + ',"W"&CHAR(47)&"H")+COUNTIF(' + range + ',"WH")+COUNTIF(' + range + ',"W")',
      A: '=COUNTIF(' + range + ',"A")',
      L: '=COUNTIF(' + range + ',"L")',
      H: '=COUNTIF(' + range + ',"H")',
      S: '=COUNTIF(' + range + ',"S")',
      'Leave Balan': '=""',
      DAYS: '=' + dim
    };
  }

  function rowFromSheetValues_(line, headers, year, month) {
    var reg = {};
    var dim = daysInMonth_(year, month);
    var empId = '';
    var displayName = '';
    var vertical = '';
    headers.forEach(function (h, i) {
      var val = trim_(line[i]);
      var key = trim_(h).toLowerCase().replace(/\s+/g, '_');
      if (key === 'employee_id') empId = val;
      else if (key === 'display_name') displayName = val;
      else if (key === 'vertical_name' || key === 'vertical') vertical = val;
      else if (/^\d{1,2}$/.test(key)) {
        var day = pad2_(key);
        if (Number(day) <= dim) {
          var code = normalizeCode_(val);
          if (code) reg[day] = code;
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

  function listActiveEmployees_() {
    var rows = [];
    try {
      if (typeof EmployeeRepository !== 'undefined' && EmployeeRepository.listAll) {
        rows = EmployeeRepository.listAll() || [];
      }
    } catch (ignoreRepo) {}
    if (!rows.length) {
      rows = DbService.getAllRecords(HRMS.SHEETS.EMPLOYEES) || [];
    }
    return rows.filter(function (e) {
      return String(e.status || 'ACTIVE').toUpperCase() !== 'INACTIVE';
    }).sort(function (a, b) {
      return String(a.employee_id).localeCompare(String(b.employee_id));
    });
  }

  function employeeDisplayName_(emp) {
    if (!emp) return '';
    var name = trim_(emp.display_name);
    if (name) return name;
    return trim_((emp.first_name || '') + ' ' + (emp.last_name || '')) || trim_(emp.employee_id);
  }

  function listSummariesForRun_(runId) {
    PermissionService.require(HRMS.ACTIONS.PAYROLL_RUN);
    var run = DbService.findOne(HRMS.SHEETS.PAYROLL_RUNS, { payroll_run_id: runId });
    if (!run) throw notFoundError_('Payroll run not found.');
    var year = Number(run.period_year);
    var month = Number(run.period_month);
    var inputByEmp = {};
    DbService.findRecords(HRMS.SHEETS.PAYROLL_INPUTS, { payroll_run_id: runId }).forEach(function (inp) {
      inputByEmp[inp.employee_id] = inp;
    });
    return listActiveEmployees_().map(function (emp) {
      var inp = inputByEmp[emp.employee_id] || null;
      var reg = inp ? parseRegister_(inp.daily_attendance_json) : {};
      var sum = summarize_(reg, year, month);
      return {
        employee_id: emp.employee_id,
        display_name: employeeDisplayName_(emp),
        vertical_name: trim_(emp.vertical_name),
        payroll_input_id: inp ? inp.payroll_input_id : '',
        in_payroll_run: !!inp,
        days_present: sum.present,
        days_leave: sum.leave_days,
        register_complete: inp ? isRegisterComplete_(reg, year, month) : false,
        summary: sum
      };
    });
  }

  function saveRegisterForInput_(inp, reg, year, month) {
    var summary = summarize_(reg, year, month);
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
    derivePayrollDays_: derivePayrollDays_,
    isRegisterComplete_: isRegisterComplete_,
    buildTemplateHeaders_: buildTemplateHeaders_,
    colToLetter_: colToLetter_,
    summaryFormulasForRow_: summaryFormulasForRow_,
    rowFromSheetValues_: rowFromSheetValues_,
    employeeDisplayName_: employeeDisplayName_,
    listActiveEmployees_: listActiveEmployees_,
    listSummariesForRun_: listSummariesForRun_,
    saveRegisterForInput_: saveRegisterForInput_
  };
})();
