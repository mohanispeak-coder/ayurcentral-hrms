/**
 * Payroll bulk upload — .xlsx or .csv. Validate → preview → commit.
 * Attendance columns (days_present, days_absent, leave_days) are segregated;
 * paid_days and lop_days are derived for payroll calculation.
 */
var HRMS = HRMS || {};

var PayrollBulkService = (function () {
  var TEMPLATE_VERSION_ = '3';
  var MAX_ROWS_ = 500;
  var STAGE_TTL_SEC_ = 1800;
  var STAGE_PREFIX_ = 'bulk_payroll_upload_';

  var HEADERS_ = [
    'employee_id', 'display_name', 'work_email', 'working_days', 'days_present', 'days_absent', 'leave_days',
    'bonus', 'incentive', 'other_earnings', 'other_deductions', 'tds_amount', 'remarks'
  ];

  var REQUIRED_HEADERS_ = ['employee_id', 'working_days', 'days_present', 'days_absent', 'leave_days'];

  var SAMPLE_ROW_ = {
    employee_id: 'SAPL-0001',
    display_name: 'Ravi Kumar',
    work_email: 'ravi.kumar@example.com',
    working_days: '26',
    days_present: '24',
    days_absent: '1',
    leave_days: '1',
    bonus: '0',
    incentive: '0',
    other_earnings: '0',
    other_deductions: '0',
    tds_amount: '0',
    remarks: ''
  };

  function trim_(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
  }

  function normalizeHeader_(header) {
    return trim_(header).toLowerCase().replace(/\s+/g, '_');
  }

  function driveApiHint_() {
    return ' Enable Google Drive API: Apps Script editor → Services (+) → Google Drive API → Add (identifier: Drive), then redeploy.';
  }

  function employeeDisplayName_(emp) {
    if (!emp) return '';
    var name = trim_(emp.display_name);
    if (name) return name;
    name = trim_((emp.first_name || '') + ' ' + (emp.last_name || ''));
    return name || trim_(emp.employee_id);
  }

  /** All active employees in HRMS — refreshed on every template download. */
  function listTemplateEmployees_() {
    var rows = typeof EmployeeRepository !== 'undefined' && EmployeeRepository.listAll
      ? EmployeeRepository.listAll()
      : DbService.getAllRecords(HRMS.SHEETS.EMPLOYEES);
    return (rows || []).filter(function (e) {
      return String(e.status || '').toUpperCase() !== 'INACTIVE';
    }).sort(function (a, b) {
      return String(a.employee_id).localeCompare(String(b.employee_id));
    });
  }

  function templateDataRows_(runId) {
    PayrollService.syncEligibleEmployees(runId);
    var inputs = DbService.findRecords(HRMS.SHEETS.PAYROLL_INPUTS, { payroll_run_id: runId });
    var inputMap = {};
    inputs.forEach(function (inp) {
      inputMap[inp.employee_id] = inp;
    });

    var employees = listTemplateEmployees_();
    if (!employees.length) {
      return [HEADERS_.map(function (h) { return SAMPLE_ROW_[h] || ''; })];
    }

    return employees.map(function (emp) {
      var inp = inputMap[emp.employee_id] || {};
      return HEADERS_.map(function (h) {
        if (h === 'employee_id') return emp.employee_id;
        if (h === 'display_name') return employeeDisplayName_(emp);
        if (h === 'work_email') return trim_(emp.work_email);
        if (h === 'remarks') return inp.remarks || '';
        if (inp[h] != null && inp[h] !== '') return String(inp[h]);
        return SAMPLE_ROW_[h] || '';
      });
    });
  }

  function buildTemplateCsv_(runId) {
    var esc = function (v) {
      v = v == null ? '' : String(v);
      if (v.indexOf(',') >= 0 || v.indexOf('"') >= 0 || v.indexOf('\n') >= 0) {
        return '"' + v.replace(/"/g, '""') + '"';
      }
      return v;
    };
    var headerLabels = HEADERS_.map(function (h) {
      return REQUIRED_HEADERS_.indexOf(h) >= 0 ? h + '*' : h;
    });
    var dataRows = runId ? templateDataRows_(runId) : [HEADERS_.map(function (h) { return SAMPLE_ROW_[h] || ''; })];
    var lines = [headerLabels.map(esc).join(',')];
    dataRows.forEach(function (row) {
      lines.push(row.map(esc).join(','));
    });
    return Utilities.newBlob(lines.join('\n'), 'text/csv', 'HRMS_Payroll_Upload_Template.csv');
  }

  function exportSpreadsheetXlsx_(spreadsheetId) {
    SpreadsheetApp.flush();
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
        'Could not export Excel template.' + driveApiHint_() + ' Details: ' + (e4.message || e4)
      );
    }
  }

  function convertUploadToSheetId_(blob) {
    if (typeof Drive === 'undefined' || !Drive.Files) {
      throw configurationError_('Google Drive advanced service is required for Excel uploads.' + driveApiHint_());
    }
    var temp = DriveApp.createFile(blob);
    try {
      var resource = {
        name: 'bulk-payroll-parse-' + Date.now(),
        mimeType: MimeType.GOOGLE_SHEETS
      };
      var converted;
      if (Drive.Files.create) {
        converted = Drive.Files.create(resource, temp.getBlob(), { convert: true });
      } else if (Drive.Files.insert) {
        converted = Drive.Files.insert(resource, temp.getBlob(), { convert: true });
      } else {
        throw configurationError_('Drive file conversion is unavailable.' + driveApiHint_());
      }
      return converted.id;
    } finally {
      temp.setTrashed(true);
    }
  }

  function assertRunExists_(runId) {
    var run = DbService.findOne(HRMS.SHEETS.PAYROLL_RUNS, { payroll_run_id: runId });
    if (!run) throw notFoundError_('Payroll run not found.');
    return run;
  }

  function assertRunEditable_(runId) {
    var run = assertRunExists_(runId);
    var st = String(run.status).toUpperCase();
    if (st === HRMS.PAYROLL_STATUS.LOCKED) {
      throw conflictError_('Payroll is finalized. Create a correction run to import new data.');
    }
    if (st !== HRMS.PAYROLL_STATUS.DRAFT && st !== HRMS.PAYROLL_STATUS.CALCULATED) {
      throw conflictError_('Excel import is only allowed while payroll is being prepared or after calculate.');
    }
    return run;
  }

  function inputMapForRun_(runId) {
    var inputs = DbService.findRecords(HRMS.SHEETS.PAYROLL_INPUTS, { payroll_run_id: runId });
    var map = {};
    inputs.forEach(function (inp) {
      map[inp.employee_id] = inp;
    });
    return map;
  }

  function buildTemplateSpreadsheet_(runId) {
    assertRunExists_(runId);
    var ss;
    var fileId;
    try {
      ss = SpreadsheetApp.create('HRMS Payroll Upload');
      fileId = ss.getId();
      var instructions = ss.getSheets()[0];
      instructions.setName('Instructions');
      instructions.getRange(1, 1).setValue('HRMS Payroll Upload — Instructions');
      var lines = [
        ['Template version: ' + TEMPLATE_VERSION_],
        ['Upload .xlsx or .csv. Do not change header names on the PayrollInputs sheet.'],
        ['Template lists all ACTIVE employees (ID, name, email). Re-download after adding employees.'],
        ['display_name and work_email are for reference only — do not edit employee_id.'],
        ['employee_id must match an active employee eligible for this payroll month.'],
        ['New employees are synced into the payroll run when you download the template or upload.'],
        ['Employees are never created from Excel. Duplicate employee rows are rejected.'],
        ['working_days must be greater than 0. days_present, days_absent, and leave_days default to 0 if empty.'],
        ['paid_days = days_present + leave_days. lop_days = working_days - paid_days (calculated by payroll).'],
        ['Optional amounts (bonus, incentive, etc.) must be valid numbers >= 0.'],
        ['After upload, review validation results before confirming import.'],
        ['Maximum ' + MAX_ROWS_ + ' rows per upload.']
      ];
      instructions.getRange(3, 1, 3 + lines.length - 1, 1).setValues(lines);

      var sheet = ss.insertSheet('PayrollInputs');
      var headerLabels = HEADERS_.map(function (h) {
        return REQUIRED_HEADERS_.indexOf(h) >= 0 ? h + '*' : h;
      });
      sheet.getRange(1, 1, 1, HEADERS_.length).setValues([headerLabels]);
      var dataRows = templateDataRows_(runId);
      sheet.getRange(2, 1, 1 + dataRows.length, HEADERS_.length).setValues(dataRows);
      sheet.setFrozenRows(1);
      SpreadsheetApp.flush();
    } catch (e) {
      if (e.hrmsCode) throw e;
      throw configurationError_('Could not create payroll upload template: ' + (e.message || e));
    }

    var blob;
    try {
      blob = exportSpreadsheetXlsx_(fileId).setName('HRMS_Payroll_Upload_Template.xlsx');
    } finally {
      try { DriveApp.getFileById(fileId).setTrashed(true); } catch (ignoreTrash) {}
    }
    if (!blob || !blob.getBytes || blob.getBytes().length < 100) {
      throw configurationError_('Excel template export returned an empty file.');
    }
    return blob;
  }

  function downloadTemplate(runId) {
    PermissionService.require(HRMS.ACTIONS.PAYROLL_RUN);
    runId = trim_(runId);
    if (!runId) throw validationError_('runId is required.');
    assertRunExists_(runId);
    var blob;
    var fileName = 'HRMS_Payroll_Upload_Template.xlsx';
    var mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    try {
      blob = buildTemplateSpreadsheet_(runId);
    } catch (e) {
      Logger.log('Payroll xlsx template failed, using CSV fallback: ' + (e.message || e));
      blob = buildTemplateCsv_(runId);
      fileName = 'HRMS_Payroll_Upload_Template.csv';
      mimeType = 'text/csv';
    }
    if (!blob) throw configurationError_('Template export produced an empty file.');
    var bytes = blob.getBytes();
    if (!bytes || bytes.length < 10) {
      throw configurationError_('Template export produced an empty file.');
    }
    return {
      fileName: fileName,
      mimeType: mimeType,
      base64: Utilities.base64Encode(bytes),
      templateVersion: TEMPLATE_VERSION_
    };
  }

  function parseSheetValues_(values) {
    if (!values || values.length < 2) return [];
    var headers = values[0].map(function (h) { return normalizeHeader_(h).replace(/\*$/, ''); });
    var out = [];
    for (var r = 1; r < values.length; r++) {
      var line = values[r];
      var allBlank = true;
      for (var c = 0; c < line.length; c++) {
        if (trim_(line[c])) allBlank = false;
      }
      if (allBlank) continue;
      var row = { rowNumber: r + 1 };
      for (var i = 0; i < headers.length; i++) {
        if (!headers[i]) continue;
        row[headers[i]] = trim_(line[i]);
      }
      out.push(row);
    }
    return out;
  }

  function parseCsvRows_(text) {
    var rows = Utilities.parseCsv(text);
    if (!rows || rows.length < 2) return [];
    var headers = rows[0].map(function (h) { return normalizeHeader_(h).replace(/\*$/, ''); });
    var out = [];
    for (var r = 1; r < rows.length; r++) {
      var line = rows[r];
      if (!line || !line.length) continue;
      var allBlank = true;
      for (var c = 0; c < line.length; c++) {
        if (trim_(line[c])) allBlank = false;
      }
      if (allBlank) continue;
      var row = { rowNumber: r + 1 };
      for (var i = 0; i < headers.length; i++) {
        if (!headers[i]) continue;
        row[headers[i]] = trim_(line[i]);
      }
      out.push(row);
    }
    return out;
  }

  function parseUpload_(meta) {
    meta = meta || {};
    var base64 = trim_(meta.base64);
    var fileName = trim_(meta.fileName).toLowerCase();
    var mimeType = trim_(meta.mimeType).toLowerCase();
    if (!base64) throw validationError_('Upload file is required.');

    var bytes = Utilities.base64Decode(base64);
    var blob = Utilities.newBlob(bytes, mimeType || 'application/octet-stream', fileName || 'upload');

    if (fileName.indexOf('.csv') >= 0 || mimeType.indexOf('csv') >= 0 || mimeType.indexOf('text/plain') >= 0) {
      return parseCsvRows_(blob.getDataAsString('UTF-8'));
    }

    if (fileName.indexOf('.xlsx') >= 0 || fileName.indexOf('.xls') >= 0 ||
        mimeType.indexOf('spreadsheet') >= 0 || mimeType.indexOf('excel') >= 0 ||
        mimeType.indexOf('spreadsheetml') >= 0 || mimeType.indexOf('officedocument') >= 0) {
      var sheetId = convertUploadToSheetId_(blob);
      try {
        var ss = SpreadsheetApp.openById(sheetId);
        var sheet = ss.getSheetByName('PayrollInputs') || ss.getSheets()[0];
        return parseSheetValues_(sheet.getDataRange().getValues());
      } finally {
        try { DriveApp.getFileById(sheetId).setTrashed(true); } catch (ignore) {}
      }
    }

    throw validationError_('Upload a .csv or .xlsx file.');
  }

  function rowUsesLegacyDays_(row) {
    return (row.paid_days !== '' && row.paid_days != null) ||
      (row.lop_days !== '' && row.lop_days != null);
  }

  function deriveAttendanceDays_(row, workingDays) {
    if (rowUsesLegacyDays_(row)) {
      var paid = parseNumberField_(row.paid_days, 'paid_days', true, true);
      var lop = parseNumberField_(row.lop_days, 'lop_days', true, true);
      if (paid.error) return { error: paid.error };
      if (lop.error) return { error: lop.error };
      if (paid.value + lop.value !== workingDays) {
        return { error: 'paid_days + lop_days must equal working_days (' + workingDays + ').' };
      }
      return {
        days_present: paid.value,
        days_absent: lop.value,
        leave_days: 0,
        paid_days: paid.value,
        lop_days: lop.value,
        mode: 'legacy'
      };
    }

    var present = parseNumberField_(row.days_present, 'days_present', false, true);
    var absent = parseNumberField_(row.days_absent, 'days_absent', false, true);
    var leave = parseNumberField_(row.leave_days, 'leave_days', false, true);
    if (present.error) return { error: present.error };
    if (absent.error) return { error: absent.error };
    if (leave.error) return { error: leave.error };

    var paidDays = present.value + leave.value;
    var lopDays = workingDays - paidDays;
    if (lopDays < 0) {
      return { error: 'days_present + leave_days cannot exceed working_days (' + workingDays + ').' };
    }
    return {
      days_present: present.value,
      days_absent: absent.value,
      leave_days: leave.value,
      paid_days: paidDays,
      lop_days: lopDays,
      mode: 'attendance'
    };
  }

  function parseNumberField_(value, field, required, allowZero) {
    if (value === '' || value == null) {
      if (required) return { error: field + ' is required.' };
      return { value: 0 };
    }
    var n = Number(value);
    if (!isFinite(n)) return { error: field + ' must be a valid number.' };
    if (n < 0) return { error: field + ' cannot be negative.' };
    if (!allowZero && n <= 0) return { error: field + ' must be greater than 0.' };
    return { value: n };
  }

  function validateRows_(rows, runId) {
    rows = rows || [];
    if (!rows.length) throw validationError_('No data rows found in the file.');
    if (rows.length > MAX_ROWS_) {
      throw validationError_('Maximum ' + MAX_ROWS_ + ' rows per upload.');
    }

    PayrollService.syncEligibleEmployees(runId);
    var run = DbService.findOne(HRMS.SHEETS.PAYROLL_RUNS, { payroll_run_id: runId });
    var inputMap = inputMapForRun_(runId);
    var employees = {};
    EmployeeRepository.listAll().forEach(function (e) {
      employees[e.employee_id] = e;
    });

    var seenIds = {};
    var valid = [];
    var errors = [];
    var problemsByEmployee = {};

    rows.forEach(function (row) {
      var rowLabel = row.rowNumber;
      var empId = trim_(row.employee_id);
      var rowErrors = [];
      if (!empId) {
        rowErrors.push({ field: 'employee_id', message: 'Employee ID is required.' });
      } else if (!employees[empId]) {
        rowErrors.push({ field: 'employee_id', message: 'Employee ID is not in HRMS. Employees cannot be created from Excel.' });
      } else if (!inputMap[empId]) {
        var eligMsg = 'Employee is not eligible for this payroll month (must be ACTIVE and joined on or before month end).';
        if (run && PayrollService.isEmployeeEligibleForPeriod(empId, run.period_year, run.period_month)) {
          eligMsg = 'Employee could not be added to this payroll run. Refresh payroll and try again.';
        }
        rowErrors.push({ field: 'employee_id', message: eligMsg });
      } else if (seenIds[empId]) {
        rowErrors.push({ field: 'employee_id', message: 'Duplicate employee row. Each employee may appear only once.' });
      }

      var working = parseNumberField_(row.working_days, 'working_days', true, false);
      var bonus = parseNumberField_(row.bonus, 'bonus', false, true);
      var incentive = parseNumberField_(row.incentive, 'incentive', false, true);
      var otherEarn = parseNumberField_(row.other_earnings, 'other_earnings', false, true);
      var otherDed = parseNumberField_(row.other_deductions, 'other_deductions', false, true);
      var tds = parseNumberField_(row.tds_amount, 'tds_amount', false, true);

      [working, bonus, incentive, otherEarn, otherDed, tds].forEach(function (parsed) {
        if (parsed.error) rowErrors.push({ field: 'amounts', message: parsed.error });
      });

      var attendance = null;
      if (!rowErrors.length && working.value != null) {
        attendance = deriveAttendanceDays_(row, working.value);
        if (attendance.error) {
          rowErrors.push({ field: 'attendance', message: attendance.error });
        }
      }

      if (rowErrors.length) {
        errors.push({
          rowNumber: rowLabel,
          employee_id: empId,
          display_name: empId && employees[empId] ? (employees[empId].display_name || empId) : '',
          messages: rowErrors
        });
        if (empId) {
          if (!problemsByEmployee[empId]) {
            problemsByEmployee[empId] = {
              employee_id: empId,
              display_name: employees[empId] ? (employees[empId].display_name || empId) : empId,
              messages: []
            };
          }
          rowErrors.forEach(function (m) {
            problemsByEmployee[empId].messages.push(m.message);
          });
        }
      } else {
        seenIds[empId] = rowLabel;
        var inp = inputMap[empId];
        var payload = {
          payroll_input_id: inp.payroll_input_id,
          working_days: working.value,
          paid_days: attendance.paid_days,
          lop_days: attendance.lop_days,
          bonus: bonus.value,
          incentive: incentive.value,
          other_earnings: otherEarn.value,
          other_deductions: otherDed.value,
          tds_amount: tds.value,
          remarks: row.remarks != null ? String(row.remarks) : (inp.remarks || '')
        };
        valid.push({
          rowNumber: rowLabel,
          payload: payload,
          preview: {
            rowNumber: rowLabel,
            employee_id: empId,
            display_name: employees[empId].display_name || empId,
            working_days: working.value,
            days_present: attendance.days_present,
            days_absent: attendance.days_absent,
            leave_days: attendance.leave_days,
            paid_days: attendance.paid_days,
            lop_days: attendance.lop_days
          }
        });
      }
    });

    return {
      templateVersion: TEMPLATE_VERSION_,
      totalRows: rows.length,
      validCount: valid.length,
      errorCount: errors.length,
      valid: valid.map(function (v) { return v.preview; }),
      errors: errors,
      problemsByEmployee: Object.keys(problemsByEmployee).map(function (k) { return problemsByEmployee[k]; }),
      validPayloads: valid.map(function (v) { return v.payload; })
    };
  }

  function stageKey_(uploadId) {
    return STAGE_PREFIX_ + uploadId;
  }

  function validateUpload(runId, meta) {
    PermissionService.require(HRMS.ACTIONS.PAYROLL_RUN);
    var session = AuthService.requireAuth();
    runId = trim_(runId);
    if (!runId) throw validationError_('runId is required.');
    assertRunEditable_(runId);
    var rows = parseUpload_(meta);
    var result = validateRows_(rows, runId);
    var uploadId = Utilities.getUuid();
    CacheService.getScriptCache().put(stageKey_(uploadId), JSON.stringify({
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
      errors: result.errors,
      problemsByEmployee: result.problemsByEmployee
    };
  }

  function commitUpload(runId, uploadId) {
    PermissionService.require(HRMS.ACTIONS.PAYROLL_RUN);
    var session = AuthService.requireAuth();
    runId = trim_(runId);
    uploadId = trim_(uploadId);
    if (!runId) throw validationError_('runId is required.');
    if (!uploadId) throw validationError_('uploadId is required.');

    var cache = CacheService.getScriptCache();
    var raw = cache.get(stageKey_(uploadId));
    if (!raw) throw validationError_('Upload session expired. Validate the file again.');
    var staged = JSON.parse(raw);
    if (staged.actorEmail !== session.email) {
      throw authorizationError_('This upload session belongs to another user.');
    }
    if (staged.runId !== runId) {
      throw validationError_('Upload session does not match this payroll run.');
    }
    var payloads = staged.validPayloads || [];
    if (!payloads.length) throw validationError_('No valid rows to import.');

    return withScriptLock_(function () {
      assertRunEditable_(runId);
      var detail = PayrollService.saveInputs(runId, payloads);
      cache.remove(stageKey_(uploadId));
      return {
        importedCount: payloads.length,
        run: detail
      };
    });
  }

  return {
    downloadTemplate: downloadTemplate,
    validateUpload: validateUpload,
    commitUpload: commitUpload,
    HEADERS: HEADERS_,
    listTemplateEmployees: listTemplateEmployees_,
    deriveAttendanceDays: deriveAttendanceDays_,
    parseCsvRows: parseCsvRows_,
    parseNumberField: parseNumberField_
  };
})();
