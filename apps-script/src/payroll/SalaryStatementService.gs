/**
 * Salary statement (SAPL-style grid) - rate of pay, earned pay, deductions, net.
 * Uses CompensationService structures + PayrollEngine; enriches from payroll run when present.
 */
var HRMS = HRMS || {};

var SalaryStatementService = (function () {
  var TEMPLATE_VERSION_ = '2';

  var RATE_EARN_KEYS_ = [
    { label: 'Basic+Da', codes: ['BASIC', 'BP', 'BASIC_DA', 'BASIC+DA'] },
    { label: 'HRA', codes: ['HRA'] },
    { label: 'Conveyance Allowance', codes: ['CONV', 'CONVEYANCE', 'CA', 'CONVEYANCE_ALLOWANCE'] },
    { label: 'Medical All', codes: ['MEDICAL', 'MED', 'MA', 'MEDICAL_ALL'] },
    { label: 'Special Allowance', codes: ['SA', 'SPECIAL', 'SPECIAL_ALLOWANCE'] }
  ];

  var DED_KEYS_ = [
    { label: 'P.F', codes: ['PF'] },
    { label: 'ESIC', codes: ['ESI', 'ESIC'] },
    { label: 'P.T', codes: ['PT'] },
    { label: 'ADVANCE', codes: ['ADVANCE', 'ADV'] },
    { label: 'TDS', codes: ['TDS'] },
    { label: 'LCD', codes: ['LCD'] },
    { label: 'LWF', codes: ['LWF'] },
    { label: 'Arrers', codes: ['ARREARS', 'ARR'] }
  ];

  function trim_(v) {
    return v == null ? '' : String(v).trim();
  }

  function round2_(n) {
    if (typeof PayrollEngine !== 'undefined' && PayrollEngine.round2) {
      return PayrollEngine.round2(n);
    }
    var x = Number(n);
    if (!isFinite(x)) x = 0;
    return Math.round(x * 100) / 100;
  }

  function dash_(n) {
    if (n === '' || n == null) return '-';
    var x = Number(n);
    if (!isFinite(x) || x === 0) return '-';
    return x;
  }

  function daysInMonth_(year, month) {
    return new Date(Number(year), Number(month), 0).getDate();
  }

  function periodEnd_(year, month) {
    var dim = daysInMonth_(year, month);
    return new Date(Number(year), Number(month) - 1, dim);
  }

  function monthLabel_(year, month) {
    var names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return (names[Number(month) - 1] || month) + '- ' + year;
  }

  function fmtDoj_(value) {
    var d = typeof LeaveEngine !== 'undefined' ? LeaveEngine.toDateOnly(value) : null;
    if (!d) return trim_(value);
    var names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var yy = String(d.getFullYear());
    return d.getDate() + '-' + names[d.getMonth()] + '-' + yy.slice(-2);
  }

  function isTypeRow_(row) {
    return !!row && trim_(row.structure_name) !== '' && trim_(row.employee_id) === '';
  }

  function listActiveEmployees_(filter) {
    filter = filter || {};
    var vertical = trim_(filter.vertical_name || filter.vertical).toUpperCase();
    var rows = [];
    try {
      if (typeof EmployeeService !== 'undefined' && EmployeeService.listActiveEmployees) {
        rows = EmployeeService.listActiveEmployees() || [];
      }
    } catch (ignore) {}
    if (!rows.length) {
      rows = (DbService.getAllRecords(HRMS.SHEETS.EMPLOYEES) || []).filter(function (e) {
        return String(e.status || '').toUpperCase() === 'ACTIVE';
      });
    }
    if (vertical) {
      rows = rows.filter(function (e) {
        return String(e.vertical_name || '').toUpperCase() === vertical;
      });
    }
    rows.sort(function (a, b) {
      return String(a.employee_id).localeCompare(String(b.employee_id));
    });
    return rows;
  }

  function findStructureType_(ref) {
    ref = trim_(ref);
    if (!ref) return null;
    var row = DbService.findOne(HRMS.SHEETS.SALARY_STRUCTURES, { salary_structure_id: ref });
    if (row && isTypeRow_(row)) return row;
    var norm = ref.toUpperCase();
    var types = (DbService.getAllRecords(HRMS.SHEETS.SALARY_STRUCTURES) || []).filter(isTypeRow_);
    for (var i = 0; i < types.length; i++) {
      var t = types[i];
      if (String(t.salary_structure_id || '').toUpperCase() === norm) return t;
      if (String(t.structure_name || '').toUpperCase() === norm) return t;
    }
    return null;
  }

  function loadComponents_(structureId) {
    var rows = DbService.findRecords(HRMS.SHEETS.SALARY_COMPONENTS, { salary_structure_id: structureId }) || [];
    rows.sort(function (a, b) {
      return Number(a.sort_order || 0) - Number(b.sort_order || 0);
    });
    return rows;
  }

  function componentMonthlyFromCtc_(component, ctcMonthly) {
    var method = String(component.calc_method || '').toUpperCase();
    var ctc = Number(ctcMonthly) || 0;
    if (method === HRMS.CALC_METHOD.PERCENT_OF_CTC) {
      return round2_(ctc * (Number(component.percent) || 0) / 100);
    }
    return round2_(Number(component.amount) || 0);
  }

  function resolveStructureBundle_(emp, periodEnd) {
    if (typeof CompensationService !== 'undefined' && CompensationService.getStructureInForce) {
      var bundle = CompensationService.getStructureInForce(emp.employee_id, periodEnd);
      if (bundle && bundle.components && bundle.components.length) return bundle;
    }
    var typeRow = findStructureType_(emp.salary_structure_id);
    var ctc = Number(emp.ctc_monthly) || 0;
    if (!typeRow || ctc <= 0) return null;
    var raw = loadComponents_(typeRow.salary_structure_id);
    if (!raw.length) return null;
    var converted = raw.map(function (c) {
      var method = String(c.calc_method || '').toUpperCase();
      var out = {
        component_code: c.component_code,
        component_name: c.component_name,
        component_kind: c.component_kind,
        calc_method: c.calc_method,
        amount: c.amount,
        percent: c.percent,
        sort_order: c.sort_order
      };
      if (method === HRMS.CALC_METHOD.PERCENT_OF_CTC) {
        out.calc_method = HRMS.CALC_METHOD.FIXED;
        out.amount = componentMonthlyFromCtc_(c, ctc);
        out.percent = '';
      }
      return out;
    });
    return { structure: typeRow, components: converted, from_type_template: true };
  }

  function findPayrollRun_(year, month) {
    var runs = DbService.getAllRecords(HRMS.SHEETS.PAYROLL_RUNS) || [];
    var match = runs.filter(function (r) {
      return Number(r.period_year) === Number(year) && Number(r.period_month) === Number(month);
    });
    match.sort(function (a, b) {
      return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });
    return match.length ? match[0] : null;
  }

  function loadPayrollMaps_(runId) {
    var inputs = {};
    var records = {};
    if (!runId) return { inputs: inputs, records: records };
    DbService.findRecords(HRMS.SHEETS.PAYROLL_INPUTS, { payroll_run_id: runId }).forEach(function (inp) {
      inputs[String(inp.employee_id)] = inp;
    });
    DbService.findRecords(HRMS.SHEETS.PAYROLL_RECORDS, { payroll_run_id: runId }).forEach(function (rec) {
      records[String(rec.employee_id)] = rec;
    });
    return { inputs: inputs, records: records };
  }

  function pickFromLines_(lines, codes, field) {
    var set = {};
    codes.forEach(function (c) { set[String(c).toUpperCase()] = true; });
    var total = 0;
    var hit = false;
    (lines || []).forEach(function (ln) {
      var code = String(ln.component_code || '').toUpperCase();
      if (!set[code]) return;
      hit = true;
      total = round2_(total + (Number(ln[field]) || 0));
    });
    return hit ? total : null;
  }

  function mapBuckets_(lines, field) {
    var rate = {};
    var earned = {};
    RATE_EARN_KEYS_.forEach(function (col) {
      rate[col.label] = pickFromLines_(lines, col.codes, field);
    });
    var ded = {};
    DED_KEYS_.forEach(function (col) {
      ded[col.label] = pickFromLines_(lines, col.codes, field);
    });
    return { rate: rate, ded: ded };
  }

  function sumRateGross_(rateMap) {
    var t = 0;
    RATE_EARN_KEYS_.forEach(function (col) {
      var v = rateMap[col.label];
      if (v != null) t = round2_(t + v);
    });
    return t;
  }

  function sumEarnGross_(earnMap) {
    return sumRateGross_(earnMap);
  }

  function employeeDisplayName_(emp) {
    if (!emp) return '';
    var name = trim_(emp.display_name);
    if (name) return name;
    return trim_((emp.first_name || '') + ' ' + (emp.last_name || '')) || trim_(emp.employee_id);
  }

  function linesFromResult_(result) {
    if (!result || result.skipped || !result.component_breakdown) return [];
    try {
      var obj = JSON.parse(result.component_breakdown);
      return obj.lines || [];
    } catch (ignore) {
      return [];
    }
  }

  function parseBreakdown_(record) {
    if (!record || !record.component_breakdown) return null;
    try {
      var obj = typeof record.component_breakdown === 'string'
        ? JSON.parse(record.component_breakdown)
        : record.component_breakdown;
      return obj && obj.lines ? obj.lines : null;
    } catch (ignore) {
      return null;
    }
  }

  function pad2_(n) {
    n = String(Number(n));
    return n.length < 2 ? '0' + n : n;
  }

  function buildEmployeeRow_(emp, ctx) {
    var warnings = [];
    var bundle = resolveStructureBundle_(emp, ctx.periodEnd);
    if (!bundle) {
      warnings.push('No salary structure for this month');
    }

    var fixedDays = ctx.fixedDays;
    var input = ctx.payrollInputs[emp.employee_id] || null;
    var record = ctx.payrollRecords[emp.employee_id] || null;

    if (input && Number(input.working_days) > 0) {
      fixedDays = Number(input.working_days);
    } else if (ctx.run && Number(ctx.run.working_days_default) > 0) {
      fixedDays = Number(ctx.run.working_days_default);
    }

    var paidDays = fixedDays;
    if (input && input.paid_days !== '' && input.paid_days != null) {
      paidDays = Number(input.paid_days);
    }

    var settings = { payroll_round: ConfigService.getSetting('payroll_round', '') };
    var inputsFull = {
      working_days: fixedDays,
      paid_days: fixedDays,
      lop_days: 0,
      bonus: 0,
      incentive: 0,
      other_earnings: 0,
      other_deductions: 0,
      tds_amount: 0
    };
    var inputsEarned = {
      working_days: fixedDays,
      paid_days: paidDays,
      lop_days: input ? Number(input.lop_days) || 0 : 0,
      bonus: input ? Number(input.bonus) || 0 : 0,
      incentive: input ? Number(input.incentive) || 0 : 0,
      other_earnings: input ? Number(input.other_earnings) || 0 : 0,
      other_deductions: input ? Number(input.other_deductions) || 0 : 0,
      tds_amount: input ? Number(input.tds_amount) || 0 : 0
    };

    var rateResult = null;
    var earnedResult = null;
    if (bundle && typeof PayrollEngine !== 'undefined') {
      rateResult = PayrollEngine.calculateEmployee({
        structure: bundle.structure,
        components: bundle.components,
        inputs: inputsFull,
        settings: settings,
        employee: emp
      });
      earnedResult = PayrollEngine.calculateEmployee({
        structure: bundle.structure,
        components: bundle.components,
        inputs: inputsEarned,
        settings: settings,
        employee: emp
      });
    }

    var rateLines = linesFromResult_(rateResult);
    var earnLines = linesFromResult_(earnedResult);

    if (record) {
      var snap = parseBreakdown_(record);
      if (snap && snap.length) earnLines = snap;
    }

    var rateBuckets = mapBuckets_(rateLines, 'contractual');
    var earnedBuckets = mapBuckets_(earnLines, 'amount');

    var rateGross = sumRateGross_(rateBuckets.rate);
    var earnGross = earnedResult ? round2_(earnedResult.gross_earnings) : sumEarnGross_(earnedBuckets.rate);

    var tds = inputsEarned.tds_amount;
    if (earnedBuckets.ded['TDS'] == null && tds > 0) {
      earnedBuckets.ded['TDS'] = tds;
    }
    if (inputsEarned.other_deductions > 0 && earnedBuckets.ded['ADVANCE'] == null) {
      earnedBuckets.ded['ADVANCE'] = round2_(inputsEarned.other_deductions);
    }

    var totalDed = earnedResult ? round2_(earnedResult.total_deductions) : 0;
    if (!totalDed) {
      DED_KEYS_.forEach(function (col) {
        var v = earnedBuckets.ded[col.label];
        if (v != null) totalDed = round2_(totalDed + v);
      });
    }
    var netPay = earnedResult ? round2_(earnedResult.net_pay) : round2_(earnGross - totalDed);

    return {
      employee_id: emp.employee_id,
      display_name: employeeDisplayName_(emp),
      designation: trim_(emp.designation),
      department: trim_(emp.department),
      gender: trim_(emp.gender),
      joining_date: fmtDoj_(emp.joining_date),
      vertical_name: trim_(emp.vertical_name),
      fixed_days: fixedDays,
      worked_days: paidDays,
      rate: rateBuckets.rate,
      rate_gross: rateGross,
      earned: earnedBuckets.rate,
      earned_gross: earnGross,
      deductions: earnedBuckets.ded,
      total_deductions: totalDed,
      net_pay: netPay,
      employer_ctc: earnedResult ? round2_((earnedResult.gross_earnings || 0) +
        (earnedResult.employer_contributions || 0)) : rateGross,
      warnings: warnings
    };
  }

  function listStatement(options) {
    PermissionService.require(HRMS.ACTIONS.PAYROLL_RUN);
    options = options || {};
    var now = new Date();
    var year = Number(options.period_year || options.year) || now.getFullYear();
    var month = Number(options.period_month || options.month) || (now.getMonth() + 1);
    var vertical = trim_(options.vertical_name || options.vertical);
    var run = findPayrollRun_(year, month);
    var maps = loadPayrollMaps_(run ? run.payroll_run_id : '');
    var fixedDays = daysInMonth_(year, month);
    if (run && Number(run.working_days_default) > 0) fixedDays = Number(run.working_days_default);

    var ctx = {
      year: year,
      month: month,
      periodEnd: periodEnd_(year, month),
      fixedDays: fixedDays,
      run: run,
      payrollInputs: maps.inputs,
      payrollRecords: maps.records,
      verticalLabel: vertical || 'HRMS'
    };

    var employees = listActiveEmployees_(options);
    var rows = employees.map(function (emp) {
      return buildEmployeeRow_(emp, ctx);
    });

    return {
      template_version: TEMPLATE_VERSION_,
      period_year: year,
      period_month: month,
      period_label: monthLabel_(year, month),
      payroll_run_id: run ? run.payroll_run_id : '',
      payroll_status: run ? String(run.status || '') : '',
      vertical_filter: vertical,
      rows: rows,
      employee_count: rows.length,
      generated_at: new Date().toISOString()
    };
  }

  function exportSpreadsheetXlsx_(spreadsheetId) {
    SpreadsheetApp.flush();
    Utilities.sleep(300);
    var xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    var auth = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
    var v3Url = 'https://www.googleapis.com/drive/v3/files/' + spreadsheetId +
      '/export?mimeType=' + encodeURIComponent(xlsxMime);
    var resp = UrlFetchApp.fetch(v3Url, {
      headers: auth,
      muteHttpExceptions: true,
      followRedirects: true
    });
    if (resp.getResponseCode() === 200) {
      var blob = resp.getBlob();
      if (blob && blob.getBytes().length > 100) return blob;
    }
    throw configurationError_('Could not export salary statement Excel. Enable Google Drive API for the script project.');
  }

  function applySaplStyles_(sheet, dataRowCount) {
    var lastCol = 32;
    sheet.getRange(1, 1, 1, lastCol).merge()
      .setBackground('#2d5a3d')
      .setFontColor('#ffffff')
      .setFontWeight('bold')
      .setHorizontalAlignment('center');
    sheet.getRange(2, 9, 1, 6).merge().setBackground('#ffedd5').setFontWeight('bold').setHorizontalAlignment('center');
    sheet.getRange(2, 15, 1, 1).setBackground('#bbf7d0').setFontWeight('bold').setHorizontalAlignment('center');
    sheet.getRange(2, 16, 1, 6).merge().setBackground('#ffedd5').setFontWeight('bold').setHorizontalAlignment('center');
    sheet.getRange(2, 22, 1, 10).merge().setBackground('#ffedd5').setFontWeight('bold').setHorizontalAlignment('center');
    sheet.getRange(3, 1, 1, 8).setBackground('#ffedd5').setFontWeight('bold');
    sheet.getRange(3, 9, 1, lastCol - 8).setBackground('#ffedd5').setFontWeight('bold');
    sheet.setFrozenRows(3);
    if (dataRowCount > 0) {
      sheet.getRange(4, 9, dataRowCount, lastCol - 8).setNumberFormat('#,##0.00');
    }
  }

  function buildExcel_(meta) {
    meta = meta || {};
    var rows = meta.rows || [];
    var vertical = trim_(meta.vertical_filter) || 'SAPL';
    var title = vertical + ' Salary statement for the month of ' + (meta.period_label || '');

    var row3 = ['Sl.No', 'EMP ID', 'Name of the Employee', 'Designation', 'Department', 'Gender', 'DOJ', 'Fixed Days'];
    RATE_EARN_KEYS_.forEach(function (c) { row3.push(c.label); });
    row3.push('Gross');
    row3.push('Days');
    RATE_EARN_KEYS_.forEach(function (c) { row3.push(c.label); });
    row3.push('Gross');
    DED_KEYS_.forEach(function (c) { row3.push(c.label); });
    row3.push('Total DED', 'Net Pay', 'TRF');

    var row2 = ['', '', '', '', '', '', '', '',
      'RATE OF PAY', '', '', '', '', '',
      'Worked',
      'EARNED PAY', '', '', '', '', '',
      'DEDUCTION', '', '', '', '', '', '', '', '', ''];

    var row1 = [title];
    while (row1.length < row3.length) row1.push('');

    var body = [];
    rows.forEach(function (r, idx) {
      var line = [
        idx + 1,
        r.employee_id,
        r.display_name,
        r.designation,
        r.department,
        r.gender,
        r.joining_date,
        r.fixed_days
      ];
      RATE_EARN_KEYS_.forEach(function (c) {
        line.push(dash_(r.rate[c.label]));
      });
      line.push(dash_(r.rate_gross));
      line.push(r.worked_days != null ? r.worked_days : '-');
      RATE_EARN_KEYS_.forEach(function (c) {
        line.push(dash_(r.earned[c.label]));
      });
      line.push(dash_(r.earned_gross));
      DED_KEYS_.forEach(function (c) {
        line.push(dash_(r.deductions[c.label]));
      });
      line.push(dash_(r.total_deductions));
      line.push(dash_(r.net_pay));
      line.push('-');
      body.push(line);
    });

    var all = [row1, row2, row3].concat(body);
    var ss = SpreadsheetApp.create('Salary Statement');
    var fileId = ss.getId();
    var sheet = ss.getSheets()[0];
    sheet.setName('HO');
    sheet.getRange(1, 1, all.length, row3.length).setValues(all);
    applySaplStyles_(sheet, body.length);
    SpreadsheetApp.flush();
    Utilities.sleep(200);
    var fname = vertical + '_Salary_Statement_' + meta.period_year + '_' +
      pad2_(meta.period_month) + '.xlsx';
    var blob = exportSpreadsheetXlsx_(fileId).setName(fname);
    try { DriveApp.getFileById(fileId).setTrashed(true); } catch (ignoreTrash) {}
    return blob;
  }

  function downloadExcel(options) {
    PermissionService.require(HRMS.ACTIONS.PAYROLL_RUN);
    var data = listStatement(options);
    var blob = buildExcel_(data);
    return {
      fileName: blob.getName(),
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      base64: Utilities.base64Encode(blob.getBytes()),
      employeeCount: data.employee_count,
      templateVersion: data.template_version,
      periodLabel: data.period_label
    };
  }

  return {
    listStatement: listStatement,
    downloadExcel: downloadExcel
  };
})();
