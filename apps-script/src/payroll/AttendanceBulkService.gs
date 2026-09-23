/**
 * Attendance register bulk upload - daily grid template per payroll month.
 */
var HRMS = HRMS || {};

var AttendanceBulkService = (function () {
  var TEMPLATE_VERSION_ = '4';
  var MAX_ROWS_ = 500;
  var STAGE_TTL_SEC_ = 1800;
  var STAGE_PREFIX_ = 'bulk_attendance_upload_';

  function trim_(v) {
    return v == null ? '' : String(v).trim();
  }

  function empKey_(id) {
    return trim_(id).toUpperCase();
  }

  function requireAttendanceAccess_() {
    var session = AuthService.requireAuth();
    if (PermissionService.can(HRMS.ACTIONS.ATTENDANCE_MANAGE, {}, session)) {
      PermissionService.require(HRMS.ACTIONS.ATTENDANCE_MANAGE, {}, session);
      return session;
    }
    return PermissionService.require(HRMS.ACTIONS.PAYROLL_RUN, {}, session);
  }

  function driveApiHint_() {
    return ' Enable Google Drive API: Apps Script editor → Services (+) → Google Drive API → Add (identifier: Drive), then redeploy.';
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

  function exportSpreadsheetXlsx_(spreadsheetId) {
    SpreadsheetApp.flush();
    Utilities.sleep(300);
    var xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    var auth = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };

    function tryFetchExport(url, label) {
      for (var attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) Utilities.sleep(400 * attempt);
        try {
          var resp = UrlFetchApp.fetch(url, {
            headers: auth,
            muteHttpExceptions: true,
            followRedirects: true
          });
          if (resp.getResponseCode() === 200) {
            var b = resp.getBlob();
            if (b && b.getBytes().length > 100) return b;
          }
          Logger.log(label + ' attempt ' + (attempt + 1) + ' HTTP ' + resp.getResponseCode());
        } catch (e) {
          Logger.log(label + ' attempt ' + (attempt + 1) + ' failed: ' + (e.message || e));
        }
      }
      return null;
    }

    var v3Url = 'https://www.googleapis.com/drive/v3/files/' + spreadsheetId +
      '/export?mimeType=' + encodeURIComponent(xlsxMime);
    var blob = tryFetchExport(v3Url, 'Drive v3 export');
    if (blob) return blob;

    var docsUrl = 'https://docs.google.com/spreadsheets/d/' + spreadsheetId + '/export?format=xlsx';
    blob = tryFetchExport(docsUrl, 'Docs export');
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
        'Could not export attendance Excel template.' + driveApiHint_() + ' Details: ' + (e4.message || e4)
      );
    }
  }

  function applyAttendanceHeaderStyles_(sheet, year, month, dim) {
    var summaryLen = AttendanceRegisterService.SUMMARY_HEADERS.length;
    var totalCols = 3 + dim + summaryLen;
    var dayStartCol = 4;

    sheet.getRange(1, 1, 2, totalCols)
      .setFontWeight('bold')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle')
      .setWrap(true);

    sheet.getRange(1, 1, 2, 3).setBackground('#2d5a3d').setFontColor('#ffffff');

    for (var d = 1; d <= dim; d++) {
      var abbr = AttendanceRegisterService.dayAbbr_(year, month, d);
      var col = dayStartCol + d - 1;
      var weekend = abbr === 'Sun' || abbr === 'Sat';
      sheet.getRange(1, col, 2, 1)
        .setBackground(weekend ? '#93c5fd' : '#dbeafe')
        .setFontColor('#1e3a5f');
    }

    sheet.getRange(1, dayStartCol + dim, 2, summaryLen)
      .setBackground('#ffedd5')
      .setFontColor('#7c2d12');

    sheet.setRowHeight(1, 24);
    sheet.setRowHeight(2, 24);
    sheet.setColumnWidth(1, 108);
    sheet.setColumnWidth(2, 200);
    sheet.setColumnWidth(3, 96);
    for (var c = dayStartCol; c < dayStartCol + dim; c++) {
      sheet.setColumnWidth(c, 34);
    }
  }

  function applySummaryFormulas_(sheet, rowNum, year, month, dim) {
    var formulas = AttendanceRegisterService.summaryFormulasForRow_(rowNum, year, month);
    var summaryStart = 4 + dim;
    var keys = AttendanceRegisterService.SUMMARY_HEADERS;
    for (var c = 0; c < keys.length; c++) {
      try {
        sheet.getRange(rowNum, summaryStart + c).setFormula(formulas[keys[c]]);
      } catch (formulaErr) {
        Logger.log('Attendance formula row ' + rowNum + ' col ' + keys[c] + ': ' + (formulaErr.message || formulaErr));
      }
    }
  }

  function normalizeVertical_(verticalName) {
    return trim_(verticalName).toUpperCase();
  }

  function assertVertical_(verticalName) {
    var code = normalizeVertical_(verticalName);
    if (!code) throw validationError_('Vertical is required.');
    var allowed = {};
    try {
      EmployeeRepository.listVerticals().forEach(function (v) { allowed[v] = true; });
    } catch (ignore) {
      (HRMS.VERTICALS || []).forEach(function (v) { allowed[String(v).toUpperCase()] = true; });
    }
    if (!allowed[code]) throw validationError_('Unknown vertical: ' + code);
    return code;
  }

  function buildTemplateSpreadsheet_(run, verticalName) {
    if (typeof AttendanceRegisterService === 'undefined') {
      throw configurationError_('Attendance register module is not loaded. Redeploy the web app (clasp push).');
    }
    var year = Number(run.period_year);
    var month = Number(run.period_month);
    try {
      PayrollService.syncEligibleEmployees(run.payroll_run_id);
    } catch (syncErr) {
      Logger.log('Attendance template sync (non-fatal): ' + (syncErr.message || syncErr));
    }

    var verticalCode = assertVertical_(verticalName);
    var headers = AttendanceRegisterService.buildTemplateHeaders_(year, month);
    var dim = headers.daysInMonth;
    var employees = AttendanceRegisterService.filterEmployeesByVertical_(
      AttendanceRegisterService.listEmployeesForPayrollPeriod_(year, month),
      verticalCode
    );
    if (employees.length > MAX_ROWS_) {
      throw validationError_('Too many employees for one template (max ' + MAX_ROWS_ + ').');
    }

    var ss = SpreadsheetApp.create('HRMS Attendance Register');
    var fileId = ss.getId();
    var blob;
    try {
      var instructions = ss.getSheets()[0];
      instructions.setName('Instructions');
      instructions.getRange(1, 1).setValue('HRMS Attendance Register');
      var lines = [
        ['Template version: ' + TEMPLATE_VERSION_],
        ['Month: ' + year + '-' + AttendanceRegisterService.pad2_(month)],
        ['Rows 1–2 on the Attendance sheet are headers only. Employee data starts on row 3.'],
        ['Eligible ACTIVE employees for this payroll month are listed (roster is built live from HRMS each download).'],
        ['Vertical: ' + verticalCode + ' (employees filtered to this vertical).'],
        ['Fill one code per day: P, W/H (Work from Home; or WH), A, L, WO, ML (Maternity Leave; legacy S = ML), H.'],
        ['Summary columns (P, W/H, A, L, WO, ML, H, Leave Balance, DAYS) calculate in Excel.'],
        ['New hires are added to open payroll months automatically when saved in Employees.'],
        ['Sheet name for upload: Attendance']
      ];
      instructions.getRange(3, 1, lines.length, 1).setValues(lines);

      var sheet = ss.insertSheet('Attendance');
      sheet.getRange(1, 1, 1, headers.row1.length).setValues([headers.row1]);
      sheet.getRange(2, 1, 1, headers.row2.length).setValues([headers.row2]);
      applyAttendanceHeaderStyles_(sheet, year, month, dim);
      sheet.setFrozenRows(2);

      if (employees.length) {
        var dataStartRow = 3;
        var data = employees.map(function (emp) {
          var row = [
            emp.employee_id,
            AttendanceRegisterService.employeeDisplayName_(emp),
            trim_(emp.vertical_name)
          ];
          for (var d = 1; d <= dim; d++) row.push('');
          return row;
        });
        // SpreadsheetApp.getRange(row, column, numRows, numColumns) — 3rd/4th are counts, not end row/col.
        var numEmpRows = data.length;
        var numIdentityDayCols = 3 + dim;
        sheet.getRange(dataStartRow, 1, numEmpRows, numIdentityDayCols).setValues(data);
        var summaryStart = 4 + dim;
        var summaryLen = AttendanceRegisterService.SUMMARY_HEADERS.length;
        var formulaGrid = [];
        for (var i = 0; i < employees.length; i++) {
          var rowNum = dataStartRow + i;
          var formulas = AttendanceRegisterService.summaryFormulasForRow_(rowNum, year, month);
          var keys = AttendanceRegisterService.SUMMARY_HEADERS;
          var rowFormulas = [];
          for (var c = 0; c < keys.length; c++) {
            rowFormulas.push(formulas[keys[c]] || '');
          }
          formulaGrid.push(rowFormulas);
        }
        if (formulaGrid.length) {
          sheet.getRange(dataStartRow, summaryStart, numEmpRows, summaryLen).setFormulas(formulaGrid);
        }
      }

      SpreadsheetApp.flush();
      Utilities.sleep(200);
      blob = exportSpreadsheetXlsx_(fileId).setName('HRMS_Attendance_Register_' + verticalCode + '_' + year + '_' +
        AttendanceRegisterService.pad2_(month) + '.xlsx');
    } catch (e) {
      if (e.hrmsCode) throw e;
      throw configurationError_('Could not build attendance template: ' + (e.message || e));
    } finally {
      try { DriveApp.getFileById(fileId).setTrashed(true); } catch (ignoreTrash) {}
    }
    if (!blob || !blob.getBytes || blob.getBytes().length < 100) {
      throw configurationError_('Attendance template export returned an empty file.');
    }
    return blob;
  }

  function buildTemplateCsv_(run, verticalName) {
    var year = Number(run.period_year);
    var month = Number(run.period_month);
    var verticalCode = assertVertical_(verticalName);
    var headers = AttendanceRegisterService.buildTemplateHeaders_(year, month);
    var dim = headers.daysInMonth;
    var employees = AttendanceRegisterService.filterEmployeesByVertical_(
      AttendanceRegisterService.listEmployeesForPayrollPeriod_(year, month),
      verticalCode
    );
    var esc = function (v) {
      v = v == null ? '' : String(v);
      if (v.indexOf(',') >= 0 || v.indexOf('"') >= 0 || v.indexOf('\n') >= 0) {
        return '"' + v.replace(/"/g, '""') + '"';
      }
      return v;
    };
    var lines = [headers.row2.map(esc).join(',')];
    employees.forEach(function (emp) {
      var row = [
        emp.employee_id,
        AttendanceRegisterService.employeeDisplayName_(emp),
        trim_(emp.vertical_name)
      ];
      for (var d = 1; d <= dim; d++) row.push('');
      AttendanceRegisterService.SUMMARY_HEADERS.forEach(function () { row.push(''); });
      lines.push(row.map(esc).join(','));
    });
    var name = 'HRMS_Attendance_Register_' + verticalCode + '_' + year + '_' +
      AttendanceRegisterService.pad2_(month) + '.csv';
    return Utilities.newBlob(lines.join('\n'), 'text/csv', name);
  }

  function convertUploadToSheetId_(blob) {
    if (typeof Drive === 'undefined' || !Drive.Files) {
      throw configurationError_('Google Drive advanced service is required for Excel uploads.' + driveApiHint_());
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

  function downloadTemplate(runId, verticalName) {
    requireAttendanceAccess_();
    runId = trim_(runId);
    if (!runId) throw validationError_('runId is required.');
    var verticalCode = assertVertical_(verticalName);
    var run = assertRunEditable_(runId);
    var year = Number(run.period_year);
    var month = Number(run.period_month);
    var fileName = 'HRMS_Attendance_Register_' + verticalCode + '_' + year + '_' +
      AttendanceRegisterService.pad2_(month) + '.xlsx';
    var mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    var blob;
    try {
      blob = buildTemplateSpreadsheet_(run, verticalCode);
    } catch (e) {
      Logger.log('Attendance xlsx template failed, using CSV fallback: ' + (e.message || e));
      if (e.hrmsCode) throw e;
      blob = buildTemplateCsv_(run, verticalCode);
      fileName = fileName.replace(/\.xlsx$/i, '.csv');
      mimeType = 'text/csv';
    }
    if (!blob || !blob.getBytes || blob.getBytes().length < 10) {
      throw configurationError_('Attendance template export produced an empty file.');
    }
    try {
      return {
        fileName: blob.getName() || fileName,
        mimeType: mimeType,
        base64: Utilities.base64Encode(blob.getBytes()),
        templateVersion: TEMPLATE_VERSION_,
        verticalName: verticalCode,
        employeeCount: AttendanceRegisterService.filterEmployeesByVertical_(
          AttendanceRegisterService.listEmployeesForPayrollPeriod_(year, month),
          verticalCode
        ).length
      };
    } catch (e) {
      Logger.log('Attendance template download failed: ' + (e.message || e) + '\n' + (e.stack || ''));
      if (e.hrmsCode) throw e;
      throw configurationError_('Attendance template download failed: ' + (e.message || String(e)));
    }
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
      if (!values || values.length < 2) return { headers: [], rows: [] };
      var headerRowIndex = 1;
      var headerProbe = values[1].map(function (h) { return trim_(h).toLowerCase(); });
      if (headerProbe.indexOf('employee_id') < 0 && values[0]) {
        var row0 = values[0].map(function (h) { return trim_(h).toLowerCase(); });
        if (row0.indexOf('employee_id') >= 0) headerRowIndex = 0;
      }
      var headerRow = values[headerRowIndex].map(function (h) { return trim_(h); });
      var rows = [];
      for (var r = headerRowIndex + 1; r < values.length; r++) {
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

  function validateRows_(parsed, run, verticalName) {
    var verticalCode = assertVertical_(verticalName);
    var year = Number(run.period_year);
    var month = Number(run.period_month);
    try {
      PayrollService.syncEligibleEmployees(run.payroll_run_id);
    } catch (ignoreSync) {}
    var inputMap = {};
    DbService.findRecords(HRMS.SHEETS.PAYROLL_INPUTS, { payroll_run_id: run.payroll_run_id })
      .forEach(function (inp) {
        var key = empKey_(inp.employee_id);
        if (key) inputMap[key] = inp;
      });
    var employees = {};
    AttendanceRegisterService.listEmployeesForPayrollPeriod_(year, month).forEach(function (e) {
      employees[empKey_(e.employee_id)] = e;
    });

    var valid = [];
    var errors = [];
    var seen = {};

    parsed.rows.forEach(function (item) {
      var parsedRow = AttendanceRegisterService.rowFromSheetValues_(item.line, item.headers, year, month);
      var empId = empKey_(parsedRow.employee_id);
      var rowErrors = [];
      if (!empId) rowErrors.push({ field: 'employee_id', message: 'Employee ID is required.' });
      else if (!employees[empId]) rowErrors.push({ field: 'employee_id', message: 'Unknown employee ID.' });
      else if (!inputMap[empId]) {
        rowErrors.push({
          field: 'employee_id',
          message: 'Employee is not in this payroll month. Start/sync payroll or check joining date and status.'
        });
      } else if (normalizeVertical_(employees[empId].vertical_name) !== verticalCode) {
        rowErrors.push({
          field: 'vertical_name',
          message: 'Employee vertical does not match selected vertical (' + verticalCode + ').'
        });
      } else if (seen[empId]) rowErrors.push({ field: 'employee_id', message: 'Duplicate row for employee.' });

      var reg = parsedRow.register;
      if (!Object.keys(reg).length) {
        rowErrors.push({ field: 'attendance', message: 'Enter at least one day code (P, W/H, A, L, WO, ML, H).' });
      }

      if (rowErrors.length) {
        errors.push({ rowNumber: item.rowNumber, employee_id: empId, messages: rowErrors });
      } else {
        seen[empId] = true;
        var empRecord = employees[empId];
        var sum = AttendanceRegisterService.summarize_(reg, year, month, empRecord.vertical_name);
        valid.push({
          employee_id: empRecord.employee_id,
          payroll_input_id: inputMap[empId].payroll_input_id,
          register: reg,
          preview: {
            employee_id: empRecord.employee_id,
            display_name: AttendanceRegisterService.employeeDisplayName_(empRecord),
            vertical_name: trim_(empRecord.vertical_name),
            days_present: sum.present,
            days_leave: sum.leave_days,
            days_total: sum.days_total,
            code_counts: sum.code_counts,
            register: reg
          }
        });
      }
    });

    return {
      templateVersion: TEMPLATE_VERSION_,
      verticalName: verticalCode,
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
      var emp = DbService.findOne(HRMS.SHEETS.EMPLOYEES, { employee_id: p.employee_id });
      var updates = AttendanceRegisterService.saveRegisterForInput_(
        inp, p.register, year, month, emp ? emp.vertical_name : '');
      return { pk: p.payroll_input_id, updates: updates };
    });
    if (items.length) DbService.updateRecords(HRMS.SHEETS.PAYROLL_INPUTS, 'payroll_input_id', items);
    return PayrollService.getRunDetail(run.payroll_run_id, { skipSync: true, alreadyLocked: true });
  }

  function validateUpload(runId, verticalName, meta) {
    var session = requireAttendanceAccess_();
    var verticalCode = assertVertical_(verticalName);
    var run = assertRunEditable_(runId);
    var parsed = parseUpload_(meta);
    if (!parsed.rows.length) throw validationError_('No attendance rows found. Use the Attendance sheet (data from row 3).');
    var result = validateRows_(parsed, run, verticalCode);
    var uploadId = Utilities.getUuid();
    CacheService.getScriptCache().put(STAGE_PREFIX_ + uploadId, JSON.stringify({
      actorEmail: session.email,
      runId: runId,
      verticalName: verticalCode,
      validPayloads: result.validPayloads,
      createdAt: Date.now()
    }), STAGE_TTL_SEC_);
    return {
      uploadId: uploadId,
      runId: runId,
      verticalName: verticalCode,
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
    var session = requireAttendanceAccess_();
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
    requireAttendanceAccess_();
    var run = assertRunEditable_(runId);
    var inp = DbService.findOne(HRMS.SHEETS.PAYROLL_INPUTS, {
      payroll_run_id: runId,
      employee_id: trim_(employeeId)
    });
    if (!inp) {
      throw validationError_('Employee is not in this payroll month. Sync employees on the Payroll screen first.');
    }
    var reg = AttendanceRegisterService.parseRegister_(register);
    var emp = DbService.findOne(HRMS.SHEETS.EMPLOYEES, { employee_id: trim_(employeeId) });
    return withScriptLock_(function () {
      var updates = AttendanceRegisterService.saveRegisterForInput_(
        inp, reg, run.period_year, run.period_month, emp ? emp.vertical_name : '');
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
    exportSpreadsheetXlsx_: exportSpreadsheetXlsx_,
    TEMPLATE_VERSION: TEMPLATE_VERSION_
  };
})();
