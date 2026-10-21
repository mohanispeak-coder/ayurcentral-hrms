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

  function indexInputs_(runId) {
    var map = {};
    DbService.findRecords(HRMS.SHEETS.PAYROLL_INPUTS, { payroll_run_id: runId }).forEach(function (inp) {
      map[String(inp.employee_id)] = inp;
      map[normEmpId_(inp.employee_id)] = inp;
    });
    return map;
  }

  function employeeSnapshot_(employeeId, detailRows, cache) {
    var key = String(employeeId || '');
    if (cache[key]) return cache[key];
    var norm = normEmpId_(key);
    var fromDetail = null;
    (detailRows || []).some(function (row) {
      var emp = row.employee || {};
      if (String(emp.employee_id) === key || normEmpId_(emp.employee_id) === norm) {
        fromDetail = emp;
        return true;
      }
      return false;
    });
    if (fromDetail) {
      cache[key] = fromDetail;
      return fromDetail;
    }
    var empRow = DbService.findOne(HRMS.SHEETS.EMPLOYEES, { employee_id: key });
    if (!empRow && norm) {
      empRow = DbService.findOne(HRMS.SHEETS.EMPLOYEES, { employee_id: norm });
    }
    var snap = {
      employee_id: key,
      display_name: empRow ? trim_(empRow.display_name || ((empRow.first_name || '') + ' ' + (empRow.last_name || '')).trim()) : key,
      vertical_name: empRow ? empRow.vertical_name : '',
      designation: empRow ? empRow.designation : '',
      department: empRow ? empRow.department : ''
    };
    if (!trim_(snap.display_name)) snap.display_name = key;
    cache[key] = snap;
    return snap;
  }

  /** Build export rows from payroll records (client API strips component_breakdown). */
  function rowsWithFullRecords_(runId, detail) {
    detail = detail || {};
    var inputsByEmp = indexInputs_(runId);
    var empCache = {};
    var records = DbService.findRecords(HRMS.SHEETS.PAYROLL_RECORDS, { payroll_run_id: runId });
    records = records.filter(function (r) {
      return trim_(r.component_breakdown) || num_(r.net_pay) !== 0 || num_(r.gross_earnings) !== 0;
    });
    records.sort(function (a, b) {
      return String(a.employee_id).localeCompare(String(b.employee_id));
    });
    return records.map(function (rec) {
      var empId = String(rec.employee_id || '');
      var inp = inputsByEmp[empId] || inputsByEmp[normEmpId_(empId)] || {};
      return {
        input: inp,
        employee: employeeSnapshot_(empId, detail.rows, empCache),
        record: rec
      };
    });
  }

  function setSheetValues_(sheet, startRow, startCol, values) {
    if (!values || !values.length) return;
    var numRows = values.length;
    var numCols = values[0].length;
    sheet.getRange(startRow, startCol, numRows, numCols).setValues(values);
  }

  function exportSpreadsheetXlsx_(spreadsheetId) {
    SpreadsheetApp.flush();
    Utilities.sleep(300);
    if (typeof AttendanceBulkService !== 'undefined' && AttendanceBulkService.exportSpreadsheetXlsx_) {
      return AttendanceBulkService.exportSpreadsheetXlsx_(spreadsheetId);
    }
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

    try {
      setSheetValues_(sheet, 1, 1, [headers]);
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
        if (line.length !== headers.length) {
          throw new Error('Column mismatch for ' + emp.employee_id + ': ' + line.length + ' vs ' + headers.length);
        }
        data.push(line);
      });

      setSheetValues_(sheet, 2, 1, data);
      sheet.getRange(1, 1).setNote(
        'Run: ' + (run.payroll_run_id || '') +
        ' · earn_* = earnings (Basic, HRA, etc.), ded_* = deductions (PF, ESIC, PT, etc.).'
      );
      SpreadsheetApp.flush();
    } catch (sheetErr) {
      try {
        DriveApp.getFileById(fileId).setTrashed(true);
      } catch (ignoreTrash) {}
      if (sheetErr.hrmsCode) throw sheetErr;
      throw validationError_('Could not build payroll Excel: ' + (sheetErr.message || sheetErr));
    }

    var name = 'HRMS_Calculated_Payroll_' + (run.payroll_run_id || 'run') + '.xlsx';
    var blob;
    try {
      var exported = exportSpreadsheetXlsx_(fileId);
      var bytes = exported.getBytes();
      blob = Utilities.newBlob(bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', name);
    } catch (exportErr) {
      if (exportErr.hrmsCode) throw exportErr;
      throw configurationError_('Could not export payroll file: ' + (exportErr.message || exportErr));
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

  function collectComponentColumnsFromRecords_(records) {
    var rows = (records || []).map(function (rec) {
      return { record: rec };
    });
    return collectComponentColumns_(rows);
  }

  return {
    downloadApprovalPack: downloadApprovalPack,
    lineMapsFromRecord: lineMapsFromRecord_,
    collectComponentColumnsFromRecords: collectComponentColumnsFromRecords_
  };
})();
