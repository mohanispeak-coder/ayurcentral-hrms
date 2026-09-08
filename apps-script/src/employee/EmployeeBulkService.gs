/**
 * Bulk employee upload — template download, validate, preview, commit.
 * HR/Admin only. Employee codes are provided manually (SAPL-0001, AOPL-0001, AOMS-0001).
 */
var HRMS = HRMS || {};

var EmployeeBulkService = (function () {
  var TEMPLATE_VERSION_ = '1';
  var MAX_ROWS_ = 100;
  var STAGE_TTL_SEC_ = 1800;
  var STAGE_PREFIX_ = 'bulk_emp_upload_';

  var HEADERS_ = [
    'employee_id', 'first_name', 'last_name', 'display_name', 'work_email',
    'department', 'designation', 'location', 'employment_type', 'joining_date',
    'manager_employee_id', 'phone', 'address', 'date_of_birth', 'gender',
    'pan', 'bank_account_name', 'bank_account_number', 'bank_ifsc', 'bank_name',
    'notes', 'create_login', 'google_login_email'
  ];

  var REQUIRED_HEADERS_ = [
    'employee_id', 'first_name', 'last_name', 'work_email',
    'department', 'designation', 'location', 'employment_type', 'joining_date', 'create_login'
  ];

  var SAMPLE_ROW_ = {
    employee_id: 'SAPL-0001',
    first_name: 'Ravi',
    last_name: 'Kumar',
    display_name: 'Ravi Kumar',
    work_email: 'ravi.kumar@example.com',
    department: 'Operations',
    designation: 'Executive',
    location: 'Bangalore',
    employment_type: 'PERMANENT',
    joining_date: '2026-01-15',
    manager_employee_id: '',
    phone: '9876543210',
    address: 'Sample address',
    date_of_birth: '',
    gender: '',
    pan: '',
    bank_account_name: '',
    bank_account_number: '',
    bank_ifsc: '',
    bank_name: '',
    notes: '',
    create_login: 'YES',
    google_login_email: 'ravi.kumar@example.com'
  };

  function trim_(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
  }

  function normalizeHeader_(header) {
    return trim_(header).toLowerCase().replace(/\s+/g, '_');
  }

  function uniqueSorted_(values) {
    var map = {};
    (values || []).forEach(function (v) {
      v = trim_(v);
      if (v) map[v] = true;
    });
    return Object.keys(map).sort();
  }

  function listReferenceValues_(session) {
    var directory = EmployeeService.listDirectory(session, { page: 1, pageSize: 5000 });
    return {
      departments: uniqueSorted_(directory.departments || []),
      designations: uniqueSorted_(EmployeeRepository.listAll().map(function (e) { return e.designation; })),
      locations: uniqueSorted_(directory.locations || []),
      employment_types: ['PERMANENT', 'CONTRACT', 'INTERN', 'CONSULTANT'],
      verticals: ['SAPL', 'AOPL', 'AOMS']
    };
  }

  function buildTemplateSpreadsheet_(refs) {
    var ss = SpreadsheetApp.create('HRMS Bulk Employee Upload');
    var file = DriveApp.getFileById(ss.getId());
    var instructions = ss.getSheets()[0];
    instructions.setName('Instructions');
    instructions.getRange(1, 1, 1, 1).setValue('HRMS Bulk Employee Upload — Instructions');
    instructions.getRange(3, 1, 18, 1).setValues([
      ['Template version: ' + TEMPLATE_VERSION_],
      ['Required columns are marked with * in the Employees sheet header row.'],
      ['Employee code format: SAPL-0001, AOPL-0001, AOMS-0001 (provided by HR, not auto-generated).'],
      ['Dates must be YYYY-MM-DD.'],
      ['create_login: YES or NO. If YES, google_login_email is required.'],
      ['System role is always EMPLOYEE on create. Admin assigns HR/Manager/Admin separately.'],
      ['manager_employee_id must already exist in HRMS (e.g. SAPL-0005).'],
      ['Maximum ' + MAX_ROWS_ + ' employees per upload.'],
      ['Do not change header names on the Employees sheet.'],
      ['Departments / designations / locations on Lists sheet are suggestions for Excel dropdowns.'],
      [''],
      ['Verticals:'],
      ['SAPL — SAPL-0001, SAPL-0002, ...'],
      ['AOPL — AOPL-0001, AOPL-0002, ...'],
      ['AOMS — AOMS-0001, AOMS-0002, ...'],
      [''],
      ['After upload, review validation results before confirming import.']
    ]);

    var lists = ss.insertSheet('Lists');
    lists.getRange(1, 1).setValue('departments');
    lists.getRange(1, 2).setValue('designations');
    lists.getRange(1, 3).setValue('locations');
    lists.getRange(1, 4).setValue('employment_types');
    lists.getRange(1, 5).setValue('create_login');
    lists.getRange(1, 6).setValue('verticals');
    var maxList = Math.max(
      refs.departments.length, refs.designations.length, refs.locations.length,
      refs.employment_types.length, 2, refs.verticals.length
    );
    for (var i = 0; i < maxList; i++) {
      lists.getRange(i + 2, 1).setValue(refs.departments[i] || '');
      lists.getRange(i + 2, 2).setValue(refs.designations[i] || '');
      lists.getRange(i + 2, 3).setValue(refs.locations[i] || '');
      lists.getRange(i + 2, 4).setValue(refs.employment_types[i] || '');
      lists.getRange(i + 2, 5).setValue(i === 0 ? 'YES' : (i === 1 ? 'NO' : ''));
      lists.getRange(i + 2, 6).setValue(refs.verticals[i] || '');
    }

    var employees = ss.insertSheet('Employees');
    var headerLabels = HEADERS_.map(function (h) {
      return REQUIRED_HEADERS_.indexOf(h) >= 0 ? h + '*' : h;
    });
    employees.getRange(1, 1, 1, HEADERS_.length).setValues([headerLabels]);
    var sample = HEADERS_.map(function (h) { return SAMPLE_ROW_[h] || ''; });
    employees.getRange(2, 1, 2, HEADERS_.length).setValues([sample]);
    employees.setFrozenRows(1);

    var blob = file.getBlob().setName('HRMS_Bulk_Employee_Upload_Template.xlsx');
    file.setTrashed(true);
    return blob;
  }

  function downloadTemplate(session) {
    PermissionService.require(HRMS.ACTIONS.EMPLOYEE_CREATE);
    var refs = listReferenceValues_(session);
    var blob = buildTemplateSpreadsheet_(refs);
    return {
      fileName: 'HRMS_Bulk_Employee_Upload_Template.xlsx',
      mimeType: blob.getContentType(),
      base64: Utilities.base64Encode(blob.getBytes()),
      templateVersion: TEMPLATE_VERSION_
    };
  }

  function parseCsvRows_(text) {
    var rows = Utilities.parseCsv(text);
    if (!rows || rows.length < 2) return [];
    var headers = rows[0].map(normalizeHeader_);
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
        var key = headers[i].replace(/\*$/, '');
        row[key] = trim_(line[i]);
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
        mimeType.indexOf('spreadsheet') >= 0 || mimeType.indexOf('excel') >= 0) {
      var temp = DriveApp.createFile(blob);
      try {
        var converted = Drive.Files.insert(
          { title: 'bulk-emp-parse', mimeType: MimeType.GOOGLE_SHEETS },
          temp.getBlob(),
          { convert: true }
        );
        var ss = SpreadsheetApp.openById(converted.id);
        var sheet = ss.getSheetByName('Employees') || ss.getSheets()[0];
        var values = sheet.getDataRange().getValues();
        DriveApp.getFileById(converted.id).setTrashed(true);
        return parseSheetValues_(values);
      } finally {
        temp.setTrashed(true);
      }
    }

    throw validationError_('Upload a .csv or .xlsx file.');
  }

  function rowToPayload_(row) {
    var payload = {};
    HEADERS_.forEach(function (key) {
      if (row.hasOwnProperty(key)) payload[key] = row[key];
    });
    payload.employee_id = EmployeeService.normalizeEmployeeId(row.employee_id);
    payload.create_user = EmployeeService.parseCreateUserFlag(row.create_login);
    return payload;
  }

  function validateRows_(rows, session) {
    if (!rows.length) {
      throw validationError_('No employee rows found. Use the Employees sheet in the template.');
    }
    if (rows.length > MAX_ROWS_) {
      throw validationError_('Too many rows. Maximum ' + MAX_ROWS_ + ' employees per upload.');
    }

    var fileEmployeeIds = {};
    rows.forEach(function (row) {
      var id = EmployeeService.normalizeEmployeeId(row.employee_id);
      if (id && EmployeeService.isValidEmployeeIdFormat(id)) fileEmployeeIds[id] = true;
    });

    var batchIds = {};
    var batchEmails = {};
    var batchLoginEmails = {};
    var valid = [];
    var errors = [];

    rows.forEach(function (row) {
      var rowErrors = [];
      var payload = rowToPayload_(row);
      var rowLabel = row.rowNumber || '?';
      var workEmail = trim_(payload.work_email).toLowerCase();

      if (!payload.employee_id) {
        rowErrors.push({ field: 'employee_id', message: 'Employee code is required.' });
      } else if (!EmployeeService.isValidEmployeeIdFormat(payload.employee_id)) {
        rowErrors.push({ field: 'employee_id', message: 'Use format SAPL-0001, AOPL-0001, or AOMS-0001.' });
      } else if (batchIds[payload.employee_id]) {
        rowErrors.push({ field: 'employee_id', message: 'Duplicate employee code in this file (row ' + batchIds[payload.employee_id] + ').' });
      } else if (EmployeeRepository.findById(payload.employee_id)) {
        rowErrors.push({ field: 'employee_id', message: 'Employee code already exists in HRMS.' });
      }

      if (!workEmail) {
        rowErrors.push({ field: 'work_email', message: 'Work email is required.' });
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(workEmail)) {
        rowErrors.push({ field: 'work_email', message: 'Enter a valid work email.' });
      } else if (batchEmails[workEmail]) {
        rowErrors.push({ field: 'work_email', message: 'Duplicate work email in this file (row ' + batchEmails[workEmail] + ').' });
      } else if (EmployeeRepository.findByWorkEmail(workEmail)) {
        rowErrors.push({ field: 'work_email', message: 'Work email already exists in HRMS.' });
      }

      if (!trim_(payload.first_name)) rowErrors.push({ field: 'first_name', message: 'First name is required.' });
      if (!trim_(payload.last_name)) rowErrors.push({ field: 'last_name', message: 'Last name is required.' });
      if (!trim_(payload.department)) rowErrors.push({ field: 'department', message: 'Department is required.' });
      if (!trim_(payload.designation)) rowErrors.push({ field: 'designation', message: 'Designation is required.' });
      if (!trim_(payload.joining_date)) rowErrors.push({ field: 'joining_date', message: 'Joining date is required.' });
      var empType = trim_(payload.employment_type).toUpperCase();
      if (!empType) rowErrors.push({ field: 'employment_type', message: 'Employment type is required.' });
      else if (['PERMANENT', 'CONTRACT', 'INTERN', 'CONSULTANT'].indexOf(empType) < 0) {
        rowErrors.push({ field: 'employment_type', message: 'Invalid employment type.' });
      }
      if (!trim_(payload.location)) rowErrors.push({ field: 'location', message: 'Location is required.' });
      if (!trim_(row.create_login)) rowErrors.push({ field: 'create_login', message: 'create_login is required (YES or NO).' });

      var managerId = EmployeeService.normalizeEmployeeId(payload.manager_employee_id);
      if (managerId) {
        if (!EmployeeRepository.findById(managerId) && !fileEmployeeIds[managerId]) {
          rowErrors.push({ field: 'manager_employee_id', message: 'Manager employee code was not found.' });
        }
      }

      var bankNo = trim_(payload.bank_account_number);
      var ifsc = trim_(payload.bank_ifsc);
      if (bankNo && !ifsc) rowErrors.push({ field: 'bank_ifsc', message: 'IFSC is required when a bank account number is provided.' });
      if (ifsc && !bankNo) rowErrors.push({ field: 'bank_account_number', message: 'Bank account number is required when IFSC is provided.' });

      if (payload.create_user) {
        var loginEmail = trim_(payload.google_login_email).toLowerCase() || workEmail;
        if (!loginEmail) {
          rowErrors.push({ field: 'google_login_email', message: 'Google login email is required when create_login is YES.' });
        } else if (batchLoginEmails[loginEmail]) {
          rowErrors.push({ field: 'google_login_email', message: 'Duplicate login email in this file (row ' + batchLoginEmails[loginEmail] + ').' });
        } else if (EmployeeRepository.findUserByEmail(loginEmail)) {
          rowErrors.push({ field: 'google_login_email', message: 'Login email already exists in HRMS.' });
        }
      }

      if (rowErrors.length) {
        errors.push({
          rowNumber: rowLabel,
          employee_id: payload.employee_id || '',
          work_email: workEmail || '',
          messages: rowErrors
        });
      } else {
        payload.employment_type = empType;
        payload.work_email = workEmail;
        valid.push({
          rowNumber: rowLabel,
          payload: payload,
          preview: {
            rowNumber: rowLabel,
            employee_id: payload.employee_id,
            display_name: trim_(payload.display_name) || (trim_(payload.first_name) + ' ' + trim_(payload.last_name)),
            work_email: workEmail,
            department: trim_(payload.department),
            designation: trim_(payload.designation),
            create_login: payload.create_user ? 'YES' : 'NO'
          }
        });
        batchIds[payload.employee_id] = rowLabel;
        batchEmails[workEmail] = rowLabel;
        if (payload.create_user) {
          var loginEmail = trim_(payload.google_login_email).toLowerCase() || workEmail;
          batchLoginEmails[loginEmail] = rowLabel;
        }
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

  function validateUpload(session, meta) {
    PermissionService.require(HRMS.ACTIONS.EMPLOYEE_CREATE);
    var rows = parseUpload_(meta);
    var result = validateRows_(rows, session);
    var uploadId = Utilities.getUuid();
    var cache = CacheService.getScriptCache();
    cache.put(stageKey_(uploadId), JSON.stringify({
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

  function buildErrorCsv_(errors) {
    var lines = ['row_number,employee_id,work_email,field,message'];
    (errors || []).forEach(function (err) {
      (err.messages || []).forEach(function (m) {
        lines.push([
          err.rowNumber,
          err.employee_id || '',
          err.work_email || '',
          m.field || '',
          '"' + String(m.message || '').replace(/"/g, '""') + '"'
        ].join(','));
      });
    });
    return lines.join('\n');
  }

  function commitUpload(session, uploadId) {
    PermissionService.require(HRMS.ACTIONS.EMPLOYEE_CREATE);
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

    var created = [];
    var failed = [];

    payloads.forEach(function (payload, index) {
      try {
        var result = EmployeeService.createEmployee(session, payload, { source: 'bulk_upload' });
        created.push({
          rowNumber: index + 1,
          employee_id: result.employee.employee_id,
          display_name: result.employee.display_name || result.employee.employee_id
        });
      } catch (e) {
        failed.push({
          employee_id: payload.employee_id || '',
          work_email: payload.work_email || '',
          message: e.message || 'Create failed.'
        });
      }
    });

    cache.remove(stageKey_(uploadId));
    AuditService.log(
      'EMPLOYEE_BULK_UPLOAD',
      'Employees',
      uploadId,
      'Bulk upload: created ' + created.length + ', failed ' + failed.length,
      ''
    );

    var errorCsv = null;
    if (failed.length) {
      var errRows = failed.map(function (f, i) {
        return {
          rowNumber: i + 1,
          employee_id: f.employee_id,
          work_email: f.work_email,
          messages: [{ field: '_row', message: f.message }]
        };
      });
      errorCsv = {
        fileName: 'HRMS_Bulk_Upload_Errors.csv',
        mimeType: 'text/csv',
        base64: Utilities.base64Encode(buildErrorCsv_(errRows))
      };
    }

    return {
      createdCount: created.length,
      failedCount: failed.length,
      created: created,
      failed: failed,
      errorCsv: errorCsv
    };
  }

  return {
    downloadTemplate: downloadTemplate,
    validateUpload: validateUpload,
    commitUpload: commitUpload,
    HEADERS: HEADERS_,
    MAX_ROWS: MAX_ROWS_,
    parseCsvRows: parseCsvRows_,
    validateRows: validateRows_
  };
})();
