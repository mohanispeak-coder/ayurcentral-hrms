/**
 * Calculated payroll Excel export (attendance + full salary component breakup).
 */
var PayrollApprovalExportService = (function () {
  var EARNING_ORDER_ = ['BASIC', 'BP', 'DA', 'BASIC_DA', 'HRA', 'CONV', 'CONVEYANCE', 'MED', 'MEDICAL', 'SA', 'SPECIAL'];
  var DEDUCTION_ORDER_ = ['PF', 'ESI', 'ESIC', 'PT', 'ADVANCE', 'ADV', 'LCD', 'LWF', 'TDS'];

  function trim_(v) {
    return v == null ? '' : String(v).trim();
  }

  function normEmpId_(employeeId) {
    return String(employeeId || '').trim().toUpperCase();
  }

  function num_(v) {
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }

  function parseBreakdown_(rec) {
    if (!rec) return { lines: [], bonus: 0, incentive: 0, other_earnings: 0, other_deductions: 0, tds_amount: 0 };
    try {
      var bd = JSON.parse(rec.component_breakdown || '{}');
      return {
        lines: bd.lines || [],
        bonus: num_(bd.bonus != null ? bd.bonus : rec.bonus),
        incentive: num_(bd.incentive != null ? bd.incentive : rec.incentive),
        other_earnings: num_(bd.other_earnings != null ? bd.other_earnings : rec.other_earnings),
        other_deductions: num_(bd.other_deductions != null ? bd.other_deductions : rec.other_deductions),
        tds_amount: num_(bd.tds_amount != null ? bd.tds_amount : rec.tds_amount)
      };
    } catch (ignore) {
      return { lines: [], bonus: num_(rec.bonus), incentive: num_(rec.incentive), other_earnings: num_(rec.other_earnings),
        other_deductions: num_(rec.other_deductions), tds_amount: num_(rec.tds_amount) };
    }
  }

  function lineMapsFromRecord_(rec) {
    var bd = parseBreakdown_(rec);
    var earnings = {};
    var deductions = {};
    var employers = {};
    (bd.lines || []).forEach(function (line) {
      var code = trim_(line.component_code || line.code).toUpperCase();
      if (!code) return;
      var kind = String(line.component_kind || '').toUpperCase();
      var amt = num_(line.amount);
      if (kind === 'DEDUCTION') deductions[code] = amt;
      else if (kind === 'EMPLOYER') employers[code] = amt;
      else earnings[code] = amt;
    });
    return { earnings: earnings, deductions: deductions, employers: employers, extras: bd };
  }

  function sortCodes_(codes, preferredOrder) {
    var set = {};
    (codes || []).forEach(function (c) { set[String(c).toUpperCase()] = true; });
    var ordered = [];
    (preferredOrder || []).forEach(function (c) {
      c = String(c).toUpperCase();
      if (set[c]) {
        ordered.push(c);
        delete set[c];
      }
    });
    Object.keys(set).sort().forEach(function (c) { ordered.push(c); });
    return ordered;
  }

  function collectComponentColumns_(rows) {
    var earn = {};
    var ded = {};
    var emp = {};
    (rows || []).forEach(function (row) {
      var maps = lineMapsFromRecord_(row.record);
      Object.keys(maps.earnings).forEach(function (c) { earn[c] = true; });
      Object.keys(maps.deductions).forEach(function (c) { ded[c] = true; });
      Object.keys(maps.employers).forEach(function (c) { emp[c] = true; });
    });
    return {
      earnings: sortCodes_(Object.keys(earn), EARNING_ORDER_),
      deductions: sortCodes_(Object.keys(ded), DEDUCTION_ORDER_),
      employers: sortCodes_(Object.keys(emp), ['EMPLOYER_PF', 'PF_EMPLOYER'])
    };
  }

  /** Client getRunDetail strips component_breakdown; load full records for export. */
  function rowsWithFullRecords_(runId, detail) {
    var records = DbService.findRecords(HRMS.SHEETS.PAYROLL_RECORDS, { payroll_run_id: runId });
    var recByEmp = {};
    records.forEach(function (r) {
      recByEmp[String(r.employee_id)] = r;
      if (typeof normalizeEmployeeId_ === 'function') {
        var norm = normalizeEmployeeId_(r.employee_id);
        if (norm) recByEmp[norm] = r;
      }
    });
    return (detail.rows || []).map(function (row) {
      var empId = String((row.employee && row.employee.employee_id) || (row.input && row.input.employee_id) || '');
      var rec = recByEmp[empId];
      if (!rec && typeof normalizeEmployeeId_ === 'function') {
        rec = recByEmp[normalizeEmployeeId_(empId)];
      }
      if (!rec) return null;
      return { input: row.input, employee: row.employee, record: rec };
    }).filter(Boolean);
  }

  function exportSpreadsheetXlsx_(spreadsheetId) {
    if (typeof AttendanceBulkService !== 'undefined' && AttendanceBulkService.exportSpreadsheetXlsx_) {
      return AttendanceBulkService.exportSpreadsheetXlsx_(spreadsheetId);
    }
    SpreadsheetApp.flush();
    var xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    var auth = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
    var v3Url = 'https://www.googleapis.com/drive/v3/files/' + spreadsheetId +
      '/export?mimeType=' + encodeURIComponent(xlsxMime) + '&alt=media';
    for (var attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) Utilities.sleep(400 * attempt);
      try {
        var resp = UrlFetchApp.fetch(v3Url, {
          headers: auth,
          muteHttpExceptions: true,
          followRedirects: true
        });
        if (resp.getResponseCode() === 200) {
          var b = resp.getBlob();
          if (b && b.getBytes().length > 100) return b;
        }
      } catch (ignore) {}
    }
    throw configurationError_('Could not export calculated payroll Excel. Enable Drive API for this script project.');
  }

  function buildApprovalSpreadsheet_(detail, runId) {
    detail = detail || {};
    var run = detail.run || {};
    var rows = rowsWithFullRecords_(runId, detail);
    if (!rows.length) {
      throw validationError_('No calculated payroll rows to export. Run Calculate payroll first.');
    }
    var cols = collectComponentColumns_(rows);
    var ss = SpreadsheetApp.create('HRMS Calculated Payroll');
    var fileId = ss.getId();
    var sheet = ss.getSheets()[0];
    sheet.setName('CalculatedPayroll');

    var fixedHeaders = [
      'employee_id', 'employee_name', 'vertical_name', 'designation', 'department',
      'working_days', 'paid_days', 'lop_days'
    ];
    var earningHeaders = cols.earnings.map(function (c) { return 'earn_' + c; });
    var varEarnHeaders = ['bonus', 'incentive', 'other_earnings', 'gross_earnings'];
    var dedHeaders = cols.deductions.map(function (c) { return 'ded_' + c; });
    var varDedHeaders = ['other_deductions', 'tds_amount', 'total_deductions', 'net_pay'];
    var employerHeaders = cols.employers.map(function (c) { return 'er_' + c; });
    var headers = fixedHeaders.concat(earningHeaders).concat(varEarnHeaders).concat(dedHeaders)
      .concat(varDedHeaders).concat(employerHeaders);

    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#e8eef3');
    sheet.setFrozenRows(1);

    var data = [];
    rows.forEach(function (row) {
      var emp = row.employee || {};
      var inp = row.input || {};
      var rec = row.record || {};
      var maps = lineMapsFromRecord_(rec);
      var line = [
        emp.employee_id || inp.employee_id || '',
        emp.display_name || '',
        trim_(emp.vertical_name),
        trim_(emp.designation),
        trim_(emp.department),
        num_(inp.working_days),
        num_(inp.paid_days),
        num_(inp.lop_days)
      ];
      cols.earnings.forEach(function (code) {
        line.push(maps.earnings[code] || 0);
      });
      line.push(num_(maps.extras.bonus));
      line.push(num_(maps.extras.incentive));
      line.push(num_(maps.extras.other_earnings));
      line.push(num_(rec.gross_earnings));
      cols.deductions.forEach(function (code) {
        line.push(maps.deductions[code] || 0);
      });
      line.push(num_(maps.extras.other_deductions));
      line.push(num_(maps.extras.tds_amount));
      line.push(num_(rec.total_deductions));
      line.push(num_(rec.net_pay));
      cols.employers.forEach(function (code) {
        line.push(maps.employers[code] || 0);
      });
      data.push(line);
    });

    if (data.length) {
      sheet.getRange(2, 1, 1 + data.length, headers.length).setValues(data);
    }
    sheet.getRange(1, 1).setNote(
      'Run: ' + (run.payroll_run_id || '') +
      ' · earn_* = structure earnings (Basic, HRA, etc.), ded_* = deductions (PF, ESIC, PT, etc.).'
    );
    SpreadsheetApp.flush();
    var name = 'HRMS_Calculated_Payroll_' + (run.payroll_run_id || 'run') + '.xlsx';
    var blob;
    try {
      var exported = exportSpreadsheetXlsx_(fileId);
      blob = Utilities.newBlob(exported.getBytes(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', name);
    } finally {
      try {
        DriveApp.getFileById(fileId).setTrashed(true);
      } catch (ignoreTrash) {}
    }
    if (!blob || !blob.getBytes().length) {
      throw configurationError_('Exported payroll file was empty.');
    }
    return blob;
  }

  function downloadApprovalPack(runId) {
    runId = String(runId || '').trim();
    var detail = PayrollService.getRunDetail(runId, { skipSync: true });
    var st = String(detail.run.status || '').toUpperCase();
    if (st === HRMS.PAYROLL_STATUS.DRAFT) {
      throw validationError_('Calculate payroll before downloading the calculated payroll file.');
    }
    var blob = buildApprovalSpreadsheet_(detail, runId);
    return {
      fileName: blob.getName(),
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      base64: Utilities.base64Encode(blob.getBytes())
    };
  }

  return {
    downloadApprovalPack: downloadApprovalPack
  };
})();
