/**
 * Bank transfer file for a payroll run (employee account details + payment reference id).
 */
var PayrollBankTransferExportService = (function () {
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

  function round2_(n) {
    if (typeof PayrollEngine !== 'undefined' && PayrollEngine.round2) {
      return PayrollEngine.round2(n);
    }
    return Math.round(num_(n) * 100) / 100;
  }

  function isSalaryHold_(inputRow) {
    return String(inputRow && inputRow.salary_hold || '').trim().toUpperCase() === 'YES';
  }

  function daysInMonth_(year, month) {
    return new Date(Number(year), Number(month), 0).getDate();
  }

  /** Last calendar day of payroll month (used in unique payment reference). */
  function payrollCreditDateParts_(run) {
    var y = Number(run.period_year);
    var m = Number(run.period_month);
    var day = daysInMonth_(y, m);
    return { day: day, month: m, year: y };
  }

  /**
   * First 3 letters of employee name (A–Z only) + DDMMYYYY, e.g. Rajesh + 28-Sep-2026 → RAJ28092026.
   */
  function uniquePaymentId_(displayName, dateParts) {
    var letters = String(displayName || '').replace(/[^a-zA-Z]/g, '').toUpperCase();
    var prefix = (letters + 'XXX').substring(0, 3);
    var d = String(dateParts.day);
    if (d.length < 2) d = '0' + d;
    var mo = String(dateParts.month);
    if (mo.length < 2) mo = '0' + mo;
    return prefix + d + mo + String(dateParts.year);
  }

  function loadEmployeeBank_(employeeId, cache) {
    var key = String(employeeId || '');
    if (cache[key]) return cache[key];
    var norm = normEmpId_(key);
    var emp = DbService.findOne(HRMS.SHEETS.EMPLOYEES, { employee_id: key });
    if (!emp && norm) emp = DbService.findOne(HRMS.SHEETS.EMPLOYEES, { employee_id: norm });
    var snap = {
      employee_id: key,
      display_name: emp ? trim_(emp.display_name || ((emp.first_name || '') + ' ' + (emp.last_name || '')).trim()) : key,
      bank_account_number: emp ? trim_(emp.bank_account_number) : '',
      bank_ifsc: emp ? trim_(emp.bank_ifsc) : ''
    };
    if (!snap.display_name) snap.display_name = key;
    cache[key] = snap;
    return snap;
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
    var resp = UrlFetchApp.fetch(v3Url, { headers: auth, muteHttpExceptions: true, followRedirects: true });
    if (resp.getResponseCode() !== 200) {
      throw configurationError_('Could not export bank transfer Excel. Enable Drive API for this script project.');
    }
    return resp.getBlob();
  }

  function buildBankTransferSpreadsheet_(runId) {
    runId = trim_(runId);
    var run = DbService.findOne(HRMS.SHEETS.PAYROLL_RUNS, { payroll_run_id: runId });
    if (!run) throw notFoundError_('Payroll run not found.');
    var st = String(run.status || '').toUpperCase();
    if (st === HRMS.PAYROLL_STATUS.DRAFT) {
      throw validationError_('Calculate payroll before downloading the bank transfer file.');
    }

    var inputsByEmp = {};
    DbService.findRecords(HRMS.SHEETS.PAYROLL_INPUTS, { payroll_run_id: runId }).forEach(function (inp) {
      inputsByEmp[String(inp.employee_id)] = inp;
      inputsByEmp[normEmpId_(inp.employee_id)] = inp;
    });

    var records = DbService.findRecords(HRMS.SHEETS.PAYROLL_RECORDS, { payroll_run_id: runId });
    records.sort(function (a, b) {
      return String(a.employee_id).localeCompare(String(b.employee_id));
    });

    var dateParts = payrollCreditDateParts_(run);
    var empCache = {};
    var headers = [
      'Emp Id',
      'Name',
      'Emp account number',
      'IFSC code',
      'Net pay',
      'Company account number',
      'unique ID'
    ];
    var data = [];
    var netTotal = 0;

    records.forEach(function (rec) {
      var empId = String(rec.employee_id || '');
      var inp = inputsByEmp[empId] || inputsByEmp[normEmpId_(empId)] || {};
      if (isSalaryHold_(inp)) return;
      var emp = loadEmployeeBank_(empId, empCache);
      var netPay = round2_(rec.net_pay);
      netTotal = round2_(netTotal + netPay);
      data.push([
        emp.employee_id,
        emp.display_name,
        emp.bank_account_number,
        emp.bank_ifsc,
        netPay,
        '',
        uniquePaymentId_(emp.display_name, dateParts)
      ]);
    });

    if (!data.length) {
      throw validationError_('No employees available for bank transfer export (check salary holds and calculated rows).');
    }

    var ss = SpreadsheetApp.create('HRMS Bank Transfer');
    var fileId = ss.getId();
    var sheet = ss.getSheets()[0];
    sheet.setName('BankTransfer');
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#e8eef3');
    sheet.setFrozenRows(1);
    var netCol = 5;
    data.push(['TOTAL', '', '', '', netTotal, '', '']);
    sheet.getRange(2, 1, data.length, headers.length).setValues(data);
    sheet.getRange(data.length + 1, netCol).setNumberFormat('#,##0.00');
    sheet.getRange(2, netCol, data.length, 1).setNumberFormat('#,##0.00');
    sheet.getRange(data.length + 1, 1, 1, headers.length).setFontWeight('bold').setBackground('#f1f5f9');
    SpreadsheetApp.flush();

    var name = 'HRMS_Bank_Transfer_' + (run.payroll_run_id || 'run') + '.xlsx';
    var blob;
    try {
      blob = exportSpreadsheetXlsx_(fileId).setName(name);
    } finally {
      try { DriveApp.getFileById(fileId).setTrashed(true); } catch (ignoreTrash) {}
    }
    if (!blob || !blob.getBytes().length) {
      throw configurationError_('Exported bank transfer file was empty.');
    }
    return blob;
  }

  function downloadBankTransferPack(runId) {
    PermissionService.require(HRMS.ACTIONS.PAYROLL_RUN);
    var blob = buildBankTransferSpreadsheet_(runId);
    return {
      fileName: blob.getName(),
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      base64: Utilities.base64Encode(blob.getBytes())
    };
  }

  return {
    downloadBankTransferPack: downloadBankTransferPack,
    uniquePaymentId_: uniquePaymentId_
  };
})();
