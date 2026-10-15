/**
 * Salary statement (SAPL-style grid) - rate of pay, earned pay, deductions, net.
 * Uses CompensationService structures + PayrollEngine; enriches from payroll run when present.
 */
var HRMS = HRMS || {};

var SalaryStatementService = (function () {
  var TEMPLATE_VERSION_ = '2';

  var RATE_EARN_KEYS_ = [
    { label: 'Basic+DA', codes: ['BASIC', 'BP', 'DA', 'BASIC_DA', 'BASIC+DA'] },
    { label: 'HRA', codes: ['HRA'] },
    { label: 'Conveyance Allowance', codes: ['CONV', 'CONVEYANCE', 'CA', 'CONVEYANCE_ALLOWANCE'] },
    { label: 'Medical All', codes: ['MEDICAL', 'MED', 'MA', 'MEDICAL_ALL'] },
    { label: 'Special Allowance', codes: ['SA', 'SPECIAL', 'SPECIAL_ALLOWANCE'] },
    { label: 'Arrears', codes: ['ARREARS', 'ARR'], exclude_from_gross_sum: true }
  ];

  var DED_KEYS_ = [
    { label: 'P.F', codes: ['PF'] },
    { label: 'ESIC', codes: ['ESI', 'ESIC'] },
    { label: 'P.T', codes: ['PT'] },
    { label: 'ADVANCE', codes: ['ADVANCE', 'ADV'] },
    { label: 'TDS', codes: ['TDS'] },
    { label: 'LCD', codes: ['LCD'] },
    { label: 'LWF', codes: ['LWF'] }
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
      return CompensationService.getStructureInForce(emp.employee_id, periodEnd);
    }
    return null;
  }

  function findPayrollRun_(year, month, verticalName, preferredRunId) {
    if (typeof PayrollService !== 'undefined' && PayrollService.resolveRunForPeriod) {
      return PayrollService.resolveRunForPeriod(year, month, verticalName, preferredRunId);
    }
    var vertical = trim_(verticalName).toUpperCase();
    var runs = DbService.getAllRecords(HRMS.SHEETS.PAYROLL_RUNS) || [];
    var y = Number(year);
    var m = Number(month);
    var pool = runs.filter(function (r) {
      return Number(r.period_year) === y && Number(r.period_month) === m;
    });
    if (vertical) {
      pool = pool.filter(function (r) {
        var rv = String(r.vertical_name || '').toUpperCase();
        if (!rv && r.payroll_run_id) {
          var parts = String(r.payroll_run_id).split('-');
          if (parts[0] === 'PR' && parts.length >= 4) rv = String(parts[3]).toUpperCase();
        }
        return rv === vertical;
      });
      if (!pool.length) return null;
    }
    pool.sort(function (a, b) {
      return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });
    return pool.length ? pool[0] : null;
  }

  function payrollEmpKey_(employeeId) {
    return String(employeeId || '').trim().toUpperCase();
  }

  function loadPayrollMaps_(runId) {
    var inputs = {};
    var records = {};
    if (!runId) return { inputs: inputs, records: records };
    DbService.findRecords(HRMS.SHEETS.PAYROLL_INPUTS, { payroll_run_id: runId }).forEach(function (inp) {
      var key = payrollEmpKey_(inp.employee_id);
      inputs[key] = inp;
      inputs[String(inp.employee_id)] = inp;
    });
    DbService.findRecords(HRMS.SHEETS.PAYROLL_RECORDS, { payroll_run_id: runId }).forEach(function (rec) {
      var key = payrollEmpKey_(rec.employee_id);
      records[key] = rec;
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

  function mapEarnBuckets_(lines, field) {
    var earn = {};
    RATE_EARN_KEYS_.forEach(function (col) {
      earn[col.label] = pickFromLines_(lines, col.codes, field);
    });
    return earn;
  }

  function mapDedBuckets_(lines) {
    var ded = {};
    DED_KEYS_.forEach(function (col) {
      ded[col.label] = pickFromLines_(lines, col.codes, 'amount');
    });
    return ded;
  }

  function sumRateGross_(rateMap) {
    var t = 0;
    RATE_EARN_KEYS_.forEach(function (col) {
      if (col.exclude_from_gross_sum) return;
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

  function parseBreakdownObj_(source) {
    if (!source) return null;
    try {
      if (typeof source === 'string') return JSON.parse(source);
      if (source.component_breakdown) {
        return typeof source.component_breakdown === 'string'
          ? JSON.parse(source.component_breakdown)
          : source.component_breakdown;
      }
      if (source.sections || source.lines) return source;
    } catch (ignore) {}
    return null;
  }

  function sectionLines_(breakdown, section) {
    breakdown = breakdown || {};
    section = trim_(section).toLowerCase();
    if (breakdown.sections) {
      if (section === 'rate' && breakdown.sections.rate_of_pay) {
        return breakdown.sections.rate_of_pay.lines || [];
      }
      if (section === 'earned' && breakdown.sections.earned_pay) {
        return breakdown.sections.earned_pay.lines || [];
      }
      if (section === 'deduction') {
        var out = [];
        if (breakdown.sections.deduction_formulas) {
          out = out.concat(breakdown.sections.deduction_formulas.lines || []);
        }
        if (breakdown.sections.manual_deductions) {
          out = out.concat(breakdown.sections.manual_deductions.lines || []);
        }
        return out;
      }
    }
    var lines = breakdown.lines || [];
    return lines.filter(function (ln) {
      var phase = String(ln.phase || '').toUpperCase();
      var sec = String(ln.structure_section || '').toUpperCase();
      if (section === 'rate') return phase === 'RATE' || sec === 'RATE_OF_PAY';
      if (section === 'earned') return phase === 'EARNED' || sec === 'EARNED_PAY';
      if (section === 'deduction') return phase === 'DEDUCTION' || sec === 'DEDUCTION' ||
        sec === 'MANUAL_DEDUCTION';
      return false;
    });
  }

  function linesFromResult_(result, section) {
    if (!result || result.skipped) return [];
    var obj = parseBreakdownObj_(result.component_breakdown ? result : result);
    if (!obj && result.component_breakdown) {
      obj = parseBreakdownObj_(result.component_breakdown);
    }
    if (!obj) return [];
    return sectionLines_(obj, section || 'earned');
  }

  function mergeInputExtras_(target, input) {
    if (!input) return target;
    target = target || {};
    if (typeof AttendancePayrollExtras !== 'undefined' && AttendancePayrollExtras.readFromInput) {
      var extras = AttendancePayrollExtras.readFromInput(input);
      Object.keys(extras).forEach(function (k) { target[k] = extras[k]; });
    }
    return target;
  }

  function pad2_(n) {
    n = String(Number(n));
    return n.length < 2 ? '0' + n : n;
  }

  function applyExtrasToDeductions_(dedMap, inputs) {
    dedMap = dedMap || {};
    inputs = inputs || {};
    if (dedMap['TDS'] == null && num_(inputs.tds_amount) > 0) {
      dedMap['TDS'] = round2_(inputs.tds_amount);
    }
    if (dedMap['ADVANCE'] == null && num_(inputs.deduction_advance) > 0) {
      dedMap['ADVANCE'] = round2_(inputs.deduction_advance);
    }
    if (dedMap['LCD'] == null && num_(inputs.deduction_lcd) > 0) {
      dedMap['LCD'] = round2_(inputs.deduction_lcd);
    }
    if (dedMap['LWF'] == null && num_(inputs.deduction_lwf) > 0) {
      dedMap['LWF'] = round2_(inputs.deduction_lwf);
    }
    if (dedMap['ADVANCE'] == null && num_(inputs.other_deductions) > 0) {
      dedMap['ADVANCE'] = round2_(inputs.other_deductions);
    }
    return dedMap;
  }

  function num_(v) {
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }

  function sumDeductions_(dedMap) {
    var totalDed = 0;
    DED_KEYS_.forEach(function (col) {
      var v = dedMap[col.label];
      if (v != null) totalDed = round2_(totalDed + v);
    });
    return totalDed;
  }

  function buildEmployeeRow_(emp, ctx) {
    var warnings = [];
    var bundle = resolveStructureBundle_(emp, ctx.periodEnd);
    if (!bundle) {
      warnings.push('No salary structure for this month');
    }
    if (!ctx.run) {
      warnings.push('No payroll run for this vertical and month - only rate of pay is shown.');
    }

    var fixedDays = ctx.fixedDays;
    var empKey = payrollEmpKey_(emp.employee_id);
    var input = ctx.payrollInputs[empKey] || ctx.payrollInputs[emp.employee_id] || null;
    var record = ctx.payrollRecords[empKey] || ctx.payrollRecords[emp.employee_id] || null;

    if (input && Number(input.working_days) > 0) {
      fixedDays = Number(input.working_days);
    } else if (ctx.run && Number(ctx.run.working_days_default) > 0) {
      fixedDays = Number(ctx.run.working_days_default);
    }

    var paidDays = 0;
    if (ctx.run) {
      paidDays = fixedDays;
      if (input && input.paid_days !== '' && input.paid_days != null) {
        paidDays = Number(input.paid_days);
      }
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
    var inputsEarned = mergeInputExtras_({
      working_days: fixedDays,
      paid_days: paidDays,
      lop_days: input ? Number(input.lop_days) || 0 : 0,
      bonus: input ? Number(input.bonus) || 0 : 0,
      incentive: input ? Number(input.incentive) || 0 : 0,
      other_earnings: input ? Number(input.other_earnings) || 0 : 0,
      other_deductions: input ? Number(input.other_deductions) || 0 : 0,
      tds_amount: input ? Number(input.tds_amount) || 0 : 0
    }, input);

    var rateResult = null;
    var earnedResult = null;
    var breakdown = null;
    if (record) {
      breakdown = parseBreakdownObj_(record);
    }

    if (bundle && typeof PayrollEngine !== 'undefined') {
      rateResult = PayrollEngine.calculateEmployee({
        structure: bundle.structure,
        components: bundle.components,
        templateComponents: bundle.templateComponents,
        payroll_rules: bundle.payroll_rules,
        inputs: inputsFull,
        settings: settings,
        employee: emp
      });
      if (ctx.run) {
        earnedResult = PayrollEngine.calculateEmployee({
          structure: bundle.structure,
          components: bundle.components,
          templateComponents: bundle.templateComponents,
          payroll_rules: bundle.payroll_rules,
          inputs: inputsEarned,
          settings: settings,
          employee: emp
        });
        if (!breakdown && earnedResult && earnedResult.component_breakdown) {
          breakdown = parseBreakdownObj_(earnedResult);
        }
      }
    }

    var rateLines = breakdown ? sectionLines_(breakdown, 'rate') : linesFromResult_(rateResult, 'rate');
    var earnLines = breakdown ? sectionLines_(breakdown, 'earned') : linesFromResult_(earnedResult, 'earned');
    var dedLines = breakdown ? sectionLines_(breakdown, 'deduction') : linesFromResult_(earnedResult, 'deduction');

    var rateMap = mapEarnBuckets_(rateLines, 'contractual');
    var earnedMap = mapEarnBuckets_(earnLines, 'amount');
    var dedMap = mapDedBuckets_(dedLines);
    dedMap = applyExtrasToDeductions_(dedMap, inputsEarned);

    var arrears = breakdown && breakdown.arrears != null
      ? round2_(breakdown.arrears)
      : (typeof AttendancePayrollExtras !== 'undefined' && AttendancePayrollExtras.arrearsFromInput
        ? AttendancePayrollExtras.arrearsFromInput(inputsEarned)
        : num_(inputsEarned.arrears_amount));
    if (arrears > 0) {
      earnedMap['Arrears'] = arrears;
    }

    var rateGross = breakdown && breakdown.rate_gross != null
      ? round2_(breakdown.rate_gross)
      : sumRateGross_(rateMap);
    if (!rateGross && rateResult && rateResult.component_breakdown) {
      var rateBd = parseBreakdownObj_(rateResult);
      if (rateBd && rateBd.rate_gross != null) rateGross = round2_(rateBd.rate_gross);
      else if (rateBd && rateBd.sections && rateBd.sections.rate_of_pay) {
        rateGross = round2_(rateBd.sections.rate_of_pay.gross);
      }
    }

    var earnGross = 0;
    var totalDed = 0;
    var netPay = 0;
    var employerCtc = rateGross;

    if (ctx.run) {
      earnGross = record && record.gross_earnings != null && record.gross_earnings !== ''
        ? round2_(record.gross_earnings)
        : (earnedResult ? round2_(earnedResult.gross_earnings) : sumEarnGross_(earnedMap));
      totalDed = record && record.total_deductions != null && record.total_deductions !== ''
        ? round2_(record.total_deductions)
        : (earnedResult ? round2_(earnedResult.total_deductions) : sumDeductions_(dedMap));
      if (!totalDed) totalDed = sumDeductions_(dedMap);
      netPay = record && record.net_pay != null && record.net_pay !== ''
        ? round2_(record.net_pay)
        : (earnedResult ? round2_(earnedResult.net_pay) : round2_(earnGross - totalDed + arrears));
      employerCtc = earnedResult
        ? round2_((earnGross || 0) + (earnedResult.employer_contributions || 0))
        : earnGross;
    }

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
      rate: rateMap,
      rate_gross: rateGross,
      earned: earnedMap,
      earned_gross: earnGross,
      deductions: dedMap,
      total_deductions: totalDed,
      net_pay: netPay,
      employer_ctc: employerCtc,
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
    var preferredRunId = trim_(options.payroll_run_id || options.runId);
    var run = vertical
      ? findPayrollRun_(year, month, vertical, preferredRunId)
      : null;
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
      try {
        return buildEmployeeRow_(emp, ctx);
      } catch (rowErr) {
        Logger.log('Salary statement row failed for ' + emp.employee_id + ': ' + (rowErr.message || rowErr));
        return {
          employee_id: emp.employee_id,
          display_name: employeeDisplayName_(emp),
          designation: trim_(emp.designation),
          department: trim_(emp.department),
          gender: trim_(emp.gender),
          joining_date: fmtDoj_(emp.joining_date),
          vertical_name: trim_(emp.vertical_name),
          fixed_days: ctx.fixedDays,
          worked_days: 0,
          rate: {},
          rate_gross: 0,
          earned: {},
          earned_gross: 0,
          deductions: {},
          total_deductions: 0,
          net_pay: 0,
          employer_ctc: 0,
          warnings: [String(rowErr.message || rowErr)]
        };
      }
    });

    var previewMode = !run;
    var statusMessage = '';
    if (!vertical) {
      statusMessage = 'Select a vertical - salary statement uses that vertical\'s org-wide payroll run for the month (same run for all HR/Admin users).';
    } else if (previewMode) {
      statusMessage = 'No payroll run for ' + vertical + ' in ' + monthLabel_(year, month) +
        '. Start payroll and lock the run to populate earned pay, deductions, and net.';
    }

    return {
      template_version: TEMPLATE_VERSION_,
      period_year: year,
      period_month: month,
      period_label: monthLabel_(year, month),
      payroll_run_id: run ? run.payroll_run_id : '',
      payroll_status: run ? String(run.status || '') : '',
      vertical_filter: vertical,
      preview_mode: previewMode,
      status_message: statusMessage,
      rows: rows,
      employee_count: rows.length,
      generated_at: new Date().toISOString()
    };
  }

  function driveApiHint_() {
    return ' Enable Google Drive API: Apps Script editor → Services (+) → Google Drive API (identifier: Drive), then redeploy.';
  }

  function exportSpreadsheetXlsx_(spreadsheetId) {
    SpreadsheetApp.flush();
    Utilities.sleep(300);
    var xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    var auth = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };

    function tryFetchExport(url, label) {
      try {
        var resp = UrlFetchApp.fetch(url, {
          headers: auth,
          muteHttpExceptions: true,
          followRedirects: true
        });
        if (resp.getResponseCode() === 200) {
          var blob = resp.getBlob();
          if (blob && blob.getBytes().length > 100) return blob;
        }
        Logger.log(label + ' export HTTP ' + resp.getResponseCode() + ': ' + resp.getContentText().substring(0, 200));
      } catch (e) {
        Logger.log(label + ' export failed: ' + (e.message || e));
      }
      return null;
    }

    var v3Url = 'https://www.googleapis.com/drive/v3/files/' + spreadsheetId +
      '/export?mimeType=' + encodeURIComponent(xlsxMime);
    var blob = tryFetchExport(v3Url, 'Drive v3');
    if (blob) return blob;

    var docsUrl = 'https://docs.google.com/spreadsheets/d/' + spreadsheetId + '/export?format=xlsx';
    blob = tryFetchExport(docsUrl, 'Sheets docs');
    if (blob) return blob;

    if (typeof Drive !== 'undefined' && Drive.Files && Drive.Files.export) {
      try {
        return Drive.Files.export(spreadsheetId, xlsxMime);
      } catch (e) {
        Logger.log('Drive.Files.export failed: ' + (e.message || e));
      }
    }

    try {
      return DriveApp.getFileById(spreadsheetId).getBlob().getAs(xlsxMime);
    } catch (e4) {
      throw configurationError_(
        'Could not export salary statement Excel.' + driveApiHint_() + ' Details: ' + (e4.message || e4)
      );
    }
  }

  function padRowWidth_(row, width) {
    row = (row || []).slice();
    while (row.length < width) row.push('');
    if (row.length > width) row.length = width;
    return row;
  }

  function applySaplStyles_(sheet, dataRowCount, lastCol) {
    lastCol = Number(lastCol) || 32;
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

    var ncol = row3.length;
    var row2 = padRowWidth_([
      '', '', '', '', '', '', '', '',
      'RATE OF PAY', '', '', '', '', '',
      'Worked',
      'EARNED PAY', '', '', '', '', '',
      'DEDUCTION', '', '', '', '', '', '', '', '', ''
    ], ncol);

    var row1 = padRowWidth_([title], ncol);

    var body = [];
    rows.forEach(function (r, idx) {
      var rate = r.rate || {};
      var earned = r.earned || {};
      var deductions = r.deductions || {};
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
        line.push(dash_(rate[c.label]));
      });
      line.push(dash_(r.rate_gross));
      line.push(r.worked_days != null ? r.worked_days : '-');
      RATE_EARN_KEYS_.forEach(function (c) {
        line.push(dash_(earned[c.label]));
      });
      line.push(dash_(r.earned_gross));
      DED_KEYS_.forEach(function (c) {
        line.push(dash_(deductions[c.label]));
      });
      line.push(dash_(r.total_deductions));
      line.push(dash_(r.net_pay));
      line.push('-');
      body.push(padRowWidth_(line, ncol));
    });

    var all = [row1, row2, padRowWidth_(row3, ncol)].concat(body);
    var ss = SpreadsheetApp.create('Salary Statement');
    var fileId = ss.getId();
    var sheet = ss.getSheets()[0];
    sheet.setName('HO');
    if (!all.length || !ncol) {
      throw validationError_('No data to export.');
    }
    sheet.getRange(1, 1, all.length, ncol).setValues(all);
    applySaplStyles_(sheet, body.length, ncol);
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
    var blob;
    try {
      blob = buildExcel_(data);
    } catch (e) {
      if (e && e.hrmsCode) throw e;
      Logger.log('Salary statement Excel build failed: ' + (e.message || e) + '\n' + (e.stack || ''));
      throw systemError_('Could not build salary statement Excel. ' + (e.message || 'Check Apps Script execution log.'));
    }
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
