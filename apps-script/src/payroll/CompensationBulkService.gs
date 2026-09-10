/**
 * Bulk salary structure upload — template, validate, preview, commit.
 * All default component columns are required; empty numeric cells are treated as 0.
 */
var HRMS = HRMS || {};

var CompensationBulkService = (function () {
  var TEMPLATE_VERSION_ = '1';
  var MAX_ROWS_ = 200;
  var STAGE_TTL_SEC_ = 1800;
  var STAGE_PREFIX_ = 'bulk_comp_upload_';

  var HEADERS_ = [
    'employee_id', 'effective_from', 'ctc_monthly',
    'basic', 'hra_percent', 'sa', 'pf_percent', 'esi', 'pt', 'employer_pf_percent'
  ];

  var REQUIRED_HEADERS_ = HEADERS_.slice();

  var SAMPLE_ROW_ = {
    employee_id: 'SAPL-0001',
    effective_from: '2026-01-01',
    ctc_monthly: '25000',
    basic: '12000',
    hra_percent: '40',
    sa: '5000',
    pf_percent: '12',
    esi: '0',
    pt: '200',
    employer_pf_percent: '12'
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

  function exportSpreadsheetXlsx_(spreadsheetId) {
    if (typeof Drive === 'undefined' || !Drive.Files) {
      throw configurationError_('Google Drive advanced service is not available.' + driveApiHint_());
    }
    var xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (Drive.Files.export) {
      return Drive.Files.export(spreadsheetId, xlsxMime);
    }
    throw configurationError_('Drive export is unavailable.' + driveApiHint_());
  }

  function convertUploadToSheetId_(blob) {
    if (typeof Drive === 'undefined' || !Drive.Files) {
      throw configurationError_('Google Drive advanced service is required for Excel uploads.' + driveApiHint_());
    }
    var temp = DriveApp.createFile(blob);
    try {
      var resource = {
        name: 'bulk-comp-parse-' + Date.now(),
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

  function templateDataRows_() {
    var emps = CompensationService.listEmployeeOptions().filter(function (e) {
      return String(e.status || '').toUpperCase() !== 'INACTIVE';
    });
    emps.sort(function (a, b) {
      return String(a.employee_id).localeCompare(String(b.employee_id));
    });
    if (!emps.length) {
      return [HEADERS_.map(function (h) { return SAMPLE_ROW_[h] || ''; })];
    }
    return emps.map(function (e) {
      return HEADERS_.map(function (h) {
        if (h === 'employee_id') return e.employee_id;
        return SAMPLE_ROW_[h] || '0';
      });
    });
  }

  function buildTemplateCsv_() {
    var esc = function (v) {
      v = v == null ? '' : String(v);
      if (v.indexOf(',') >= 0 || v.indexOf('"') >= 0 || v.indexOf('\n') >= 0) {
        return '"' + v.replace(/"/g, '""') + '"';
      }
      return v;
    };
    var headerLabels = HEADERS_.map(function (h) { return h + '*'; });
    var lines = [headerLabels.map(esc).join(',')];
    templateDataRows_().forEach(function (row) {
      lines.push(row.map(esc).join(','));
    });
    return Utilities.newBlob(lines.join('\n'), 'text/csv', 'HRMS_Salary_Structure_Upload_Template.csv');
  }

  function buildTemplateSpreadsheet_() {
    var ss = SpreadsheetApp.create('HRMS Salary Structure Upload');
    var fileId = ss.getId();
    try {
      var instructions = ss.getSheets()[0];
      instructions.setName('Instructions');
      instructions.getRange(1, 1).setValue('HRMS Salary Structure Upload — Instructions');
      var lines = [
        ['Template version: ' + TEMPLATE_VERSION_],
        ['Upload .xlsx or .csv. Do not change header names on the SalaryStructures sheet.'],
        ['All columns are required. Leave numeric cells empty to use 0.'],
        ['employee_id must match an active employee in HRMS.'],
        ['effective_from must be YYYY-MM-DD.'],
        ['Duplicate employee rows in one file are rejected.'],
        ['Employees with structures locked in finalized payroll cannot be overwritten — create a revision manually.'],
        ['Maximum ' + MAX_ROWS_ + ' rows per upload.']
      ];
      instructions.getRange(3, 1, 3 + lines.length - 1, 1).setValues(lines);

      var sheet = ss.insertSheet('SalaryStructures');
      var headerLabels = HEADERS_.map(function (h) { return h + '*'; });
      sheet.getRange(1, 1, 1, HEADERS_.length).setValues([headerLabels]);
      var dataRows = templateDataRows_();
      sheet.getRange(2, 1, 1 + dataRows.length, HEADERS_.length).setValues(dataRows);
      sheet.setFrozenRows(1);
      SpreadsheetApp.flush();
    } catch (e) {
      if (e.hrmsCode) throw e;
      throw configurationError_('Could not create salary structure template: ' + (e.message || e));
    }

    var blob;
    try {
      blob = exportSpreadsheetXlsx_(fileId).setName('HRMS_Salary_Structure_Upload_Template.xlsx');
    } finally {
      try { DriveApp.getFileById(fileId).setTrashed(true); } catch (ignoreTrash) {}
    }
    return blob;
  }

  function downloadTemplate() {
    PermissionService.require(HRMS.ACTIONS.PAYROLL_RUN);
    var blob;
    var fileName = 'HRMS_Salary_Structure_Upload_Template.xlsx';
    var mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    try {
      blob = buildTemplateSpreadsheet_();
    } catch (e) {
      Logger.log('Compensation xlsx template failed, using CSV fallback: ' + (e.message || e));
      blob = buildTemplateCsv_();
      fileName = 'HRMS_Salary_Structure_Upload_Template.csv';
      mimeType = 'text/csv';
    }
    return {
      fileName: fileName,
      mimeType: mimeType,
      base64: Utilities.base64Encode(blob.getBytes()),
      templateVersion: TEMPLATE_VERSION_
    };
  }

  function downloadCsvTemplate() {
    PermissionService.require(HRMS.ACTIONS.PAYROLL_RUN);
    var blob = buildTemplateCsv_();
    return {
      fileName: 'HRMS_Salary_Structure_Upload_Template.csv',
      mimeType: 'text/csv',
      base64: Utilities.base64Encode(blob.getBytes()),
      templateVersion: TEMPLATE_VERSION_
    };
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
        mimeType.indexOf('officedocument') >= 0) {
      var sheetId = convertUploadToSheetId_(blob);
      try {
        var ss = SpreadsheetApp.openById(sheetId);
        var sheet = ss.getSheetByName('SalaryStructures') || ss.getSheets()[0];
        return parseSheetValues_(sheet.getDataRange().getValues());
      } finally {
        try { DriveApp.getFileById(sheetId).setTrashed(true); } catch (ignore) {}
      }
    }

    throw validationError_('Upload a .csv or .xlsx file.');
  }

  function isValidDate_(value) {
    if (!value) return false;
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value).substring(0, 10));
  }

  function validateRows_(rows) {
    rows = rows || [];
    if (!rows.length) throw validationError_('No data rows found in the file.');
    if (rows.length > MAX_ROWS_) {
      throw validationError_('Maximum ' + MAX_ROWS_ + ' rows per upload.');
    }

    var employees = {};
    CompensationService.listEmployeeOptions().forEach(function (e) {
      employees[e.employee_id] = e;
    });

    var lockedRuns = {};
    DbService.findRecords(HRMS.SHEETS.PAYROLL_RUNS, { status: HRMS.PAYROLL_STATUS.LOCKED }).forEach(function (r) {
      lockedRuns[r.payroll_run_id] = true;
    });
    var lockedStructures = {};
    DbService.getAllRecords(HRMS.SHEETS.PAYROLL_RECORDS).forEach(function (rec) {
      if (lockedRuns[rec.payroll_run_id] && rec.salary_structure_id) {
        lockedStructures[rec.salary_structure_id] = true;
      }
    });
    var lockedByEmp = {};
    DbService.getAllRecords(HRMS.SHEETS.SALARY_STRUCTURES).forEach(function (s) {
      if (String(s.status || '').toUpperCase() !== HRMS.STRUCTURE_STATUS.CURRENT) return;
      if (lockedStructures[s.salary_structure_id]) lockedByEmp[s.employee_id] = true;
    });

    var seenIds = {};
    var valid = [];
    var errors = [];

    rows.forEach(function (row) {
      var rowLabel = row.rowNumber;
      var empId = trim_(row.employee_id);
      var rowErrors = [];

      if (!empId) {
        rowErrors.push({ field: 'employee_id', message: 'Employee ID is required.' });
      } else if (!employees[empId]) {
        rowErrors.push({ field: 'employee_id', message: 'Employee ID is not in HRMS.' });
      } else if (seenIds[empId]) {
        rowErrors.push({ field: 'employee_id', message: 'Duplicate employee row. Each employee may appear only once.' });
      }

      if (!isValidDate_(row.effective_from)) {
        rowErrors.push({ field: 'effective_from', message: 'effective_from is required (YYYY-MM-DD).' });
      }

      if (row.ctc_monthly === '' || row.ctc_monthly == null) {
        rowErrors.push({ field: 'ctc_monthly', message: 'ctc_monthly is required (use 0 if not applicable).' });
      } else {
        var ctc = Number(row.ctc_monthly);
        if (!isFinite(ctc) || ctc < 0) {
          rowErrors.push({ field: 'ctc_monthly', message: 'ctc_monthly must be a number >= 0.' });
        }
      }

      if (empId && lockedByEmp[empId]) {
        rowErrors.push({ field: 'employee_id', message: 'Structure is locked in finalized payroll. Create a revision manually.' });
      }

      var components;
      try {
        components = CompensationService.buildComponentsFromBulkRow(row);
      } catch (e) {
        rowErrors.push({ field: 'components', message: e.message || 'Invalid component values.' });
      }

      if (rowErrors.length) {
        errors.push({
          rowNumber: rowLabel,
          employee_id: empId,
          display_name: empId && employees[empId] ? (employees[empId].display_name || empId) : '',
          messages: rowErrors
        });
      } else {
        seenIds[empId] = rowLabel;
        valid.push({
          rowNumber: rowLabel,
          payload: {
            employee_id: empId,
            effective_from: String(row.effective_from).substring(0, 10),
            ctc_monthly: Number(row.ctc_monthly),
            components: components
          },
          preview: {
            rowNumber: rowLabel,
            employee_id: empId,
            display_name: employees[empId].display_name || empId,
            effective_from: String(row.effective_from).substring(0, 10),
            ctc_monthly: Number(row.ctc_monthly)
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
      validPayloads: valid.map(function (v) { return v.payload; })
    };
  }

  function stageKey_(uploadId) {
    return STAGE_PREFIX_ + uploadId;
  }

  function validateUpload(meta) {
    PermissionService.require(HRMS.ACTIONS.PAYROLL_RUN);
    var session = AuthService.requireAuth();
    var rows = parseUpload_(meta);
    var result = validateRows_(rows);
    var uploadId = Utilities.getUuid();
    CacheService.getScriptCache().put(stageKey_(uploadId), JSON.stringify({
      actorEmail: session.email,
      validPayloads: result.validPayloads,
      createdAt: Date.now()
    }), STAGE_TTL_SEC_);
    return {
      uploadId: uploadId,
      templateVersion: result.templateVersion,
      totalRows: result.totalRows,
      validCount: result.validCount,
      errorCount: result.errorCount,
      valid: result.valid,
      errors: result.errors
    };
  }

  function commitUpload(uploadId) {
    PermissionService.require(HRMS.ACTIONS.PAYROLL_RUN);
    var session = AuthService.requireAuth();
    uploadId = trim_(uploadId);
    if (!uploadId) throw validationError_('uploadId is required.');

    var cache = CacheService.getScriptCache();
    var raw = cache.get(stageKey_(uploadId));
    if (!raw) throw validationError_('Upload session expired. Validate the file again.');
    var staged = JSON.parse(raw);
    if (staged.actorEmail !== session.email) {
      throw authorizationError_('This upload session belongs to another user.');
    }
    var payloads = staged.validPayloads || [];
    if (!payloads.length) throw validationError_('No valid rows to import.');

    var saved = [];
    var failed = [];

    return withScriptLock_(function () {
      payloads.forEach(function (payload, index) {
        try {
          var bundle = CompensationService.saveStructure(payload);
          saved.push({
            rowNumber: index + 1,
            employee_id: payload.employee_id,
            salary_structure_id: bundle.structure.salary_structure_id
          });
        } catch (e) {
          failed.push({
            employee_id: payload.employee_id || '',
            message: e.message || 'Save failed.'
          });
        }
      });
      cache.remove(stageKey_(uploadId));
      AuditService.log('COMP_BULK_UPLOAD', 'SalaryStructures', uploadId,
        'Bulk structure upload: saved ' + saved.length + ', failed ' + failed.length, '');
      return {
        savedCount: saved.length,
        failedCount: failed.length,
        saved: saved,
        failed: failed
      };
    });
  }

  return {
    downloadTemplate: downloadTemplate,
    downloadCsvTemplate: downloadCsvTemplate,
    validateUpload: validateUpload,
    commitUpload: commitUpload,
    HEADERS: HEADERS_,
    MAX_ROWS: MAX_ROWS_,
    parseCsvRows: parseCsvRows_,
    validateRows: validateRows_
  };
})();
