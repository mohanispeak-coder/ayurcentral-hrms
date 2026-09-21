/**
 * Attendance register bulk upload — daily grid template per payroll month.
 */
var HRMS = HRMS || {};

var AttendanceBulkService = (function () {
  var TEMPLATE_VERSION_ = '1';
  var MAX_ROWS_ = 500;
  var STAGE_TTL_SEC_ = 1800;
  var STAGE_PREFIX_ = 'bulk_attendance_upload_';

  function trim_(v) {
    return v == null ? '' : String(v).trim();
  }

  function assertRunEditable_(runId) {
    var run = DbService.findOne(HRMS.SHEETS.PAYROLL_RUNS, { payroll_run_id: runId });
    if (!run) throw notFoundError_('Payroll run not found.');
    var st = String(run.status).toUpperCase();
    if (st === HRMS.PAYROLL_STATUS.LOCKED) {
      throw conflictError_('Payroll is finalized. Create a correction run to change attendance.');
    }
    if (st !== HRMS.PAYROLL_STATUS.DRAFT && st !== HRMS.PAYROLL_STATUS.CALCULATED) {
      throw conflictError_('Attendance upload is only allowed while payroll is in draft or calculated.');
    }
    return run;
  }

  function employeeDisplayName_(emp) {
    if (!emp) return '';
    var name = trim_(emp.display_name);
    if (name) return name;
    return trim_((emp.first_name || '') + ' ' + (emp.last_name || '')) || trim_(emp.employee_id);
  }

  function listTemplateEmployees_() {
    return (EmployeeRepository.listAll() || []).filter(function (e) {
      return String(e.status || '').toUpperCase() !== 'INACTIVE';
    }).sort(function (a, b) {
      return String(a.employee_id).localeCompare(String(b.employee_id));
    });
  }

  function exportSpreadsheetXlsx_(spreadsheetId) {
    SpreadsheetApp.flush();
    var xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    var auth = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
    var url = 'https://www.googleapis.com/drive/v3/files/' + spreadsheetId +
      '/export?mimeType=' + encodeURIComponent(xlsxMime);
    for (var attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) Utilities.sleep(400 * attempt);
      var resp = UrlFetchApp.fetch(url, { headers: auth, muteHttpExceptions: true, followRedirects: true });
      if (resp.getResponseCode() === 200) {
        var b = resp.getBlob();
        if (b && b.getBytes().length > 100) return b;
      }
    }
    throw configurationError_('Could not export attendance Excel template.');
  }

  function convertUploadToSheetId_(blob) {
    if (typeof Drive === 'undefined' || !Drive.Files) {
      throw configurationError_('Google Drive advanced service is required for Excel uploads.');
    }
    var temp = DriveApp.createFile(blob);
    try {
      var resource = { name: 'bulk-att-parse-' + Date.now(), mimeType: MimeType.GOOGLE_SHEETS };
      var converted = Drive.Files.create(resource, temp.getBlob(), { convert: true });
      return converted.id;
    } finally {
      temp.setTrashed(true);
    }
  }

  function buildTemplateSpreadsheet_(run) {
    var year = Number(run.period_year);
    var month = Number(run.period_month);
    PayrollService.syncEligibleEmployees(run.payroll_run_id);
    var headers = AttendanceRegisterService.buildTemplateHeaders_(year, month);
    var ss = SpreadsheetApp.create('HRMS Attendance Register');
    var fileId = ss.getId();
    try {
      var instructions = ss.getSheets()[0];
      instructions.setName('Instructions');
      instructions.getRange(1, 1).setValue('HRMS Attendance Register');
      var lines = [
        ['Template version: ' + TEMPLATE_VERSION_],
        ['Month: ' + year + '-' + AttendanceRegisterService.pad2_(month)],
        ['Fill one code per day: P, W/H, A, L, H, S (week-off/holiday = W/H).'],
        ['Summary columns (P, W/H, A, L, H, S, DAYS) are calculated in Excel — payroll uses server totals on upload.'],
        ['Do not change employee_id. display_name and vertical_name are for reference.'],
        ['Sheet name for upload: Attendance']
      ];
      instructions.getRange(3, 1, 3 + lines.length - 1, 1).setValues(lines);

      var sheet = ss.insertSheet('Attendance');
      sheet.getRange(1, 1, 1, headers.row1.length).setValues([headers.row1]);
      sheet.getRange(2, 1, 2, headers.row2.length).setValues([headers.row2]);
      sheet.setFrozenRows(2);

      var employees = listTemplateEmployees_();
      var dataStartRow = 3;
      employees.forEach(function (emp, idx) {
        var rowNum = dataStartRow + idx;
        var base = [emp.employee_id, employeeDisplayName_(emp), trim_(emp.vertical_name)];
        for (var d = 1; d <= headers.daysInMonth; d++) base.push('');
        sheet.getRange(rowNum, 1, rowNum, base.length).setValues([base]);
        var formulas = AttendanceRegisterService.summaryFormulasForRow_(rowNum, year, month);
        var summaryStart = 4 + headers.daysInMonth;
        var formulaList = [formulas.P, formulas['W/H'], formulas.A, formulas.L, formulas.H, formulas.S,
          formulas['Leave Balan'], formulas.DAYS];
        for (var c = 0; c < formulaList.length; c++) {
          sheet.getRange(rowNum, summaryStart + c).setFormula(formulaList[c]);
        }
      });
      SpreadsheetApp.flush();
      return exportSpreadsheetXlsx_(fileId).setName('HRMS_Attendance_Register_' + year + '_' +
        AttendanceRegisterService.pad2_(month) + '.xlsx');
    } finally {
      try { DriveApp.getFileById(fileId).setTrashed(true); } catch (ignore) {}
    }
  }

  function downloadTemplate(runId) {
    PermissionService.require(HRMS.ACTIONS.PAYROLL_RUN);
    runId = trim_(runId);
    if (!runId) throw validationError_('runId is required.');
    var run = assertRunEditable_(runId);
    var blob = buildTemplateSpreadsheet_(run);
    return {
      fileName: blob.getName() || 'HRMS_Attendance_Register.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      base64: Utilities.base64Encode(blob.getBytes()),
      templateVersion: TEMPLATE_VERSION_
    };
  }

  function parseUpload_(meta) {
    meta = meta || {};
    var base64 = trim_(meta.base64);
    if (!base64) throw validationError_('Upload file is required.');
    var bytes = Utilities.base64Decode(base64);
    var blob = Utilities.newBlob(bytes, meta.mimeType || 'application/octet-stream', meta.fileName || 'upload.xlsx');
    var sheetId = convertUploadToSheetId_(blob);
    try {
      var ss = SpreadsheetApp.openById(sheetId);
      var sheet = ss.getSheetByName('Attendance') || ss.getSheets()[0];
      var values = sheet.getDataRange().getValues();
      if (!values || values.length < 3) return { headers: [], rows: [] };
      var headerRow = values[1].map(function (h) { return trim_(h); });
      var rows = [];
      for (var r = 2; r < values.length; r++) {
        var line = values[r];
        var blank = true;
        for (var c = 0; c < line.length; c++) {
          if (trim_(line[c])) blank = false;
        }
        if (blank) continue;
        rows.push({ rowNumber: r + 1, line: line, headers: headerRow });
      }
      return { headers: headerRow, rows: rows };
    } finally {
      try { DriveApp.getFileById(sheetId).setTrashed(true); } catch (ignore) {}
    }
  }

  function validateRows_(parsed, run) {
    var year = Number(run.period_year);
    var month = Number(run.period_month);
    var inputMap = {};
    DbService.findRecords(HRMS.SHEETS.PAYROLL_INPUTS, { payroll_run_id: run.payroll_run_id })
      .forEach(function (inp) { inputMap[inp.employee_id] = inp; });
    var employees = {};
    EmployeeRepository.listAll().forEach(function (e) { employees[e.employee_id] = e; });

    var valid = [];
    var errors = [];
    var seen = {};

    parsed.rows.forEach(function (item) {
      var parsedRow = AttendanceRegisterService.rowFromSheetValues_(item.line, item.headers, year, month);
      var empId = trim_(parsedRow.employee_id);
      var rowErrors = [];
      if (!empId) rowErrors.push({ field: 'employee_id', message: 'Employee ID is required.' });
      else if (!employees[empId]) rowErrors.push({ field: 'employee_id', message: 'Unknown employee ID.' });
      else if (!inputMap[empId]) rowErrors.push({ field: 'employee_id', message: 'Employee not in this payroll month.' });
      else if (seen[empId]) rowErrors.push({ field: 'employee_id', message: 'Duplicate row for employee.' });

      var reg = parsedRow.register;
      if (!Object.keys(reg).length) {
        rowErrors.push({ field: 'attendance', message: 'Enter at least one day code (P, W/H, A, L, H, S).' });
      }

      if (rowErrors.length) {
        errors.push({
          rowNumber: item.rowNumber,
          employee_id: empId,
          messages: rowErrors
        });
      } else {
        seen[empId] = true;
        var sum = AttendanceRegisterService.summarize_(reg, year, month);
        valid.push({
          employee_id: empId,
          payroll_input_id: inputMap[empId].payroll_input_id,
          register: reg,
          preview: {
            employee_id: empId,
            display_name: employees[empId].display_name || empId,
            vertical_name: employees[empId].vertical_name || '',
            days_present: sum.present,
            days_leave: sum.leave_days
          }
        });
      }
    });

    return {
      templateVersion: TEMPLATE_VERSION_,
      totalRows: parsed.rows.length,
      validCount: valid.length,
      errorCount: errors.length,
      valid: valid.map(function (v) { return v.preview; }),
      errors: errors,
      validPayloads: valid
    };
  }

  function commitPayloads_(run, payloads) {
    var year = Number(run.period_year);
    var month = Number(run.period_month);
    var items = payloads.map(function (p) {
      var inp = DbService.findOne(HRMS.SHEETS.PAYROLL_INPUTS, { payroll_input_id: p.payroll_input_id });
      if (!inp) throw validationError_('Invalid payroll input for ' + p.employee_id);
      var updates = AttendanceRegisterService.saveRegisterForInput_(inp, p.register, year, month);
      return { pk: p.payroll_input_id, updates: updates };
    });
    if (items.length) DbService.updateRecords(HRMS.SHEETS.PAYROLL_INPUTS, 'payroll_input_id', items);
    return PayrollService.getRunDetail(run.payroll_run_id, { skipSync: true, alreadyLocked: true });
  }

  function validateUpload(runId, meta) {
    PermissionService.require(HRMS.ACTIONS.PAYROLL_RUN);
    var session = AuthService.requireAuth();
    var run = assertRunEditable_(runId);
    var parsed = parseUpload_(meta);
    if (!parsed.rows.length) throw validationError_('No attendance rows found. Use the Attendance sheet.');
    var result = validateRows_(parsed, run);
    var uploadId = Utilities.getUuid();
    CacheService.getScriptCache().put(STAGE_PREFIX_ + uploadId, JSON.stringify({
      actorEmail: session.email,
      runId: runId,
      validPayloads: result.validPayloads,
      createdAt: Date.now()
    }), STAGE_TTL_SEC_);
    return {
      uploadId: uploadId,
      runId: runId,
      templateVersion: result.templateVersion,
      totalRows: result.totalRows,
      validCount: result.validCount,
      errorCount: result.errorCount,
      employeesFound: result.totalRows,
      readyCount: result.validCount,
      attentionCount: result.errorCount,
      valid: result.valid,
      errors: result.errors
    };
  }

  function commitUpload(runId, uploadId) {
    PermissionService.require(HRMS.ACTIONS.PAYROLL_RUN);
    var session = AuthService.requireAuth();
    var run = assertRunEditable_(runId);
    var raw = CacheService.getScriptCache().get(STAGE_PREFIX_ + uploadId);
    if (!raw) throw validationError_('Upload session expired. Validate again.');
    var staged = JSON.parse(raw);
    if (staged.actorEmail !== session.email) throw authorizationError_('Upload session belongs to another user.');
    if (staged.runId !== runId) throw validationError_('Upload session does not match this run.');
    var payloads = staged.validPayloads || [];
    if (!payloads.length) throw validationError_('No valid rows to import.');
    return withScriptLock_(function () {
      var detail = commitPayloads_(run, payloads);
      CacheService.getScriptCache().remove(STAGE_PREFIX_ + uploadId);
      return { importedCount: payloads.length, run: detail };
    });
  }

  function saveEmployeeRegister(runId, employeeId, register) {
    PermissionService.require(HRMS.ACTIONS.PAYROLL_RUN);
    var run = assertRunEditable_(runId);
    var inp = DbService.findOne(HRMS.SHEETS.PAYROLL_INPUTS, {
      payroll_run_id: runId,
      employee_id: trim_(employeeId)
    });
    if (!inp) throw notFoundError_('Employee not in this payroll run.');
    var reg = AttendanceRegisterService.parseRegister_(register);
    return withScriptLock_(function () {
      var updates = AttendanceRegisterService.saveRegisterForInput_(
        inp, reg, run.period_year, run.period_month);
      DbService.updateRecord(HRMS.SHEETS.PAYROLL_INPUTS, 'payroll_input_id', inp.payroll_input_id, updates);
      return AttendanceRegisterService.listSummariesForRun_(runId).filter(function (r) {
        return r.employee_id === employeeId;
      })[0];
    });
  }

  return {
    downloadTemplate: downloadTemplate,
    validateUpload: validateUpload,
    commitUpload: commitUpload,
    saveEmployeeRegister: saveEmployeeRegister,
    TEMPLATE_VERSION: TEMPLATE_VERSION_
  };
})();
