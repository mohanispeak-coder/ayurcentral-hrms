/**
 * Management approval Excel for a calculated payroll run (full breakup + hold flag).
 */
var PayrollApprovalExportService = (function () {
  function trim_(v) {
    return v == null ? '' : String(v).trim();
  }

  function num_(v) {
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }

  function isHold_(inp) {
    return String(inp && inp.salary_hold || '').toUpperCase() === 'YES';
  }

  function componentMapFromRecord_(rec) {
    var map = {};
    if (!rec) return map;
    try {
      var bd = JSON.parse(rec.component_breakdown || '{}');
      (bd.lines || []).forEach(function (line) {
        var code = trim_(line.component_code || line.code || 'LINE');
        if (!code) return;
        map[code] = num_(line.amount);
      });
    } catch (ignore) {}
    return map;
  }

  function collectComponentCodes_(rows) {
    var codes = {};
    (rows || []).forEach(function (row) {
      var m = componentMapFromRecord_(row.record);
      Object.keys(m).forEach(function (c) { codes[c] = true; });
    });
    return Object.keys(codes).sort();
  }

  function exportSpreadsheetXlsx_(spreadsheetId) {
    return PayrollService.exportSpreadsheetXlsxForTemplate_(spreadsheetId);
  }

  function buildApprovalSpreadsheet_(detail) {
    detail = detail || {};
    var run = detail.run || {};
    var rows = detail.rows || [];
    var componentCodes = collectComponentCodes_(rows);
    var ss = SpreadsheetApp.create('HRMS Payroll Approval');
    var fileId = ss.getId();
    var sheet = ss.getSheets()[0];
    sheet.setName('PayrollApproval');
    var headers = [
      'employee_id', 'employee_name', 'vertical_name', 'designation', 'department',
      'working_days', 'paid_days', 'lop_days', 'bonus', 'incentive', 'other_earnings',
      'other_deductions', 'tds_amount', 'gross_earnings', 'total_deductions', 'net_pay',
      'salary_hold'
    ].concat(componentCodes);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#e8eef3');
    sheet.setFrozenRows(1);

    var data = [];
    rows.forEach(function (row) {
      var emp = row.employee || {};
      var inp = row.input || {};
      var rec = row.record || {};
      var comps = componentMapFromRecord_(rec);
      var line = [
        emp.employee_id || inp.employee_id || '',
        emp.display_name || '',
        trim_(emp.vertical_name),
        trim_(emp.designation),
        trim_(emp.department),
        num_(inp.working_days),
        num_(inp.paid_days),
        num_(inp.lop_days),
        num_(inp.bonus),
        num_(inp.incentive),
        num_(inp.other_earnings),
        num_(inp.other_deductions),
        num_(inp.tds_amount),
        num_(rec.gross_earnings),
        num_(rec.total_deductions),
        num_(rec.net_pay),
        isHold_(inp) ? 'YES' : 'NO'
      ];
      componentCodes.forEach(function (code) {
        line.push(comps[code] || 0);
      });
      data.push(line);
    });
    if (data.length) {
      sheet.getRange(2, 1, 1 + data.length, headers.length).setValues(data);
    }
    sheet.getRange(1, 1).setNote('Run: ' + (run.payroll_run_id || '') + ' · Re-download after changing salary hold in HRMS.');
    SpreadsheetApp.flush();
    var name = 'HRMS_Payroll_Approval_' + (run.payroll_run_id || 'run') + '.xlsx';
    try {
      var blob = exportSpreadsheetXlsx_(fileId);
      return Utilities.newBlob(blob.getBytes(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', name);
    } finally {
      try {
        DriveApp.getFileById(fileId).setTrashed(true);
      } catch (ignoreTrash) {}
    }
  }

  function downloadApprovalPack(runId) {
    var detail = PayrollService.getRunDetail(runId, { skipSync: true });
    var st = String(detail.run.status || '').toUpperCase();
    if (st === HRMS.PAYROLL_STATUS.DRAFT) {
      throw validationError_('Calculate payroll before downloading the approval file.');
    }
    var blob = buildApprovalSpreadsheet_(detail);
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
