/**
 * Statutory Form T export per vertical and payroll month.
 */
var HRMS = HRMS || {};

var FormTService = (function () {
  var SHEET_NAME_ = 'Sheet1';
  var HEADER_ROW_ = 8;
  var DATE_SERIAL_ROW_ = 9;
  var DATA_START_ROW_ = 10;
  var FIRST_DAY_COL_ = 12;
  var DAY_COL_COUNT_ = 31;
  var ROW_MONTH_ = 5;
  var ROW_YEAR_ = 6;
  var ROW_MONTH_SERIALS_ = 7;
  var COL_PERIOD_VALUE_ = 2;
  var ROW_EST_NAME_ = 4;
  var ROW_EST_ADDR1_ = 5;
  var ROW_EST_ADDR2_ = 6;
  var COL_EST_BLOCK_ = 40;
  var COL_EMP_START_ = 1;
  var COL_EMP_COUNT_ = 11;
  var SUMMARY_COLS_ = { P: 43, WH: 44, A: 45, L: 46, H: 47, S: 48, LEAVE_BAL: 49, DAYS: 50 };
  var MONTH_NAMES_ = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var PAYMENT_DATE_LABEL_ = '7th E/M';

  function trim_(v) {
    return v == null ? '' : String(v).trim();
  }

  function normalizeVertical_(verticalName) {
    var code = trim_(verticalName).toUpperCase();
    if (!code) throw validationError_('Vertical is required.');
    return code;
  }

  function verticalCatalogEntry_(verticalCode) {
    var catalog = EmployeeRepository.listVerticalCatalog();
    for (var i = 0; i < catalog.length; i++) {
      if (catalog[i].vertical_name === verticalCode) return catalog[i];
    }
    var map = HRMS.VERTICAL_LEGAL_NAMES_DEFAULT || {};
    var addr = HRMS.VERTICAL_FORM_T_ADDRESS_DEFAULT || {};
    return {
      vertical_name: verticalCode,
      legal_name: String(map[verticalCode] || map.OTHERS || verticalCode).trim(),
      address_line1: (addr[verticalCode] || addr.OTHERS || {}).address_line1 || '',
      address_line2: (addr[verticalCode] || addr.OTHERS || {}).address_line2 || ''
    };
  }

  function legalNameForVertical_(verticalCode) {
    return verticalCatalogEntry_(verticalCode).legal_name;
  }

  function excelSerialFromYmd_(year, month, day) {
    var utcMs = Date.UTC(Number(year), Number(month) - 1, Number(day));
    var baseMs = Date.UTC(1899, 11, 30);
    return Math.floor((utcMs - baseMs) / 86400000);
  }

  function excelSerialFromDateValue_(value) {
    if (value === '' || value == null) return '';
    if (typeof value === 'number' && isFinite(value)) return value;
    if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
      return excelSerialFromYmd_(value.getFullYear(), value.getMonth() + 1, value.getDate());
    }
    var s = trim_(value);
    var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return excelSerialFromYmd_(iso[1], iso[2], iso[3]);
    var d = new Date(s);
    if (!isNaN(d.getTime())) {
      return excelSerialFromYmd_(d.getFullYear(), d.getMonth() + 1, d.getDate());
    }
    return s;
  }

  function applyFormTHeader_(sheet, year, month, catalogEntry) {
    catalogEntry = catalogEntry || {};
    var legalName = trim_(catalogEntry.legal_name);
    sheet.getRange(3, 1).setValue(legalName);
    sheet.getRange(ROW_EST_NAME_, COL_EST_BLOCK_).setValue(legalName);
    if (trim_(catalogEntry.address_line1)) {
      sheet.getRange(ROW_EST_ADDR1_, COL_EST_BLOCK_).setValue(trim_(catalogEntry.address_line1));
    }
    if (trim_(catalogEntry.address_line2)) {
      sheet.getRange(ROW_EST_ADDR2_, COL_EST_BLOCK_).setValue(trim_(catalogEntry.address_line2));
    }
    sheet.getRange(ROW_MONTH_, COL_PERIOD_VALUE_).setValue(MONTH_NAMES_[Number(month) - 1] || month);
    sheet.getRange(ROW_YEAR_, COL_PERIOD_VALUE_).setValue(Number(year));

    var dim = AttendanceRegisterService.daysInMonth_(year, month);
    sheet.getRange(ROW_MONTH_SERIALS_, 1).setValue(excelSerialFromYmd_(year, month, 1));
    sheet.getRange(ROW_MONTH_SERIALS_, 2).setValue(excelSerialFromYmd_(year, month, dim));
    var abbrRow = [];
    var serialRow = [];
    for (var d = 1; d <= DAY_COL_COUNT_; d++) {
      if (d <= dim) {
        abbrRow.push(AttendanceRegisterService.dayAbbr_(year, month, d));
        serialRow.push(excelSerialFromYmd_(year, month, d));
      } else {
        abbrRow.push('');
        serialRow.push('');
      }
    }
    sheet.getRange(HEADER_ROW_, FIRST_DAY_COL_, 1, DAY_COL_COUNT_).setValues([abbrRow]);
    sheet.getRange(DATE_SERIAL_ROW_, FIRST_DAY_COL_, 1, DAY_COL_COUNT_).setValues([serialRow]);
  }

  function employeesForVerticalRun_(runId, verticalCode) {
    var run = DbService.findOne(HRMS.SHEETS.PAYROLL_RUNS, { payroll_run_id: runId });
    if (!run) throw notFoundError_('Payroll run not found.');
    var year = Number(run.period_year);
    var month = Number(run.period_month);
    var inputByEmp = {};
    DbService.findRecords(HRMS.SHEETS.PAYROLL_INPUTS, { payroll_run_id: runId }).forEach(function (inp) {
      inputByEmp[inp.employee_id] = inp;
    });
    var employees = AttendanceRegisterService.filterEmployeesByVertical_(
      AttendanceRegisterService.listEmployeesForPayrollPeriod_(year, month),
      verticalCode
    );
    return employees.map(function (emp) {
      var inp = inputByEmp[emp.employee_id] || null;
      var reg = inp ? AttendanceRegisterService.parseRegister_(inp.daily_attendance_json) : {};
      var complete = inp && AttendanceRegisterService.isRegisterComplete_(reg, year, month);
      var sum = AttendanceRegisterService.summarize_(reg, year, month, emp.vertical_name);
      return {
        employee: emp,
        input: inp,
        register: reg,
        summary: sum,
        register_complete: !!complete
      };
    });
  }

  function canGenerateFormT_(runId, verticalName) {
    var verticalCode = normalizeVertical_(verticalName);
    var rows = employeesForVerticalRun_(runId, verticalCode);
    if (!rows.length) {
      return { ok: false, reason: 'NO_EMPLOYEES', message: 'No employees in this vertical for the payroll month.' };
    }
    var incomplete = rows.filter(function (r) { return !r.register_complete; });
    if (incomplete.length) {
      return {
        ok: false,
        reason: 'INCOMPLETE_ATTENDANCE',
        message: incomplete.length + ' of ' + rows.length + ' employees have incomplete attendance.',
        employeeCount: rows.length,
        incompleteCount: incomplete.length
      };
    }
    return { ok: true, employeeCount: rows.length, legalName: legalNameForVertical_(verticalCode) };
  }

  function getStatus(runId, verticalName) {
    PermissionService.require(HRMS.ACTIONS.PAYROLL_RUN);
    var verticalCode = normalizeVertical_(verticalName);
    var check = canGenerateFormT_(runId, verticalCode);
    var rows = employeesForVerticalRun_(runId, verticalCode);
    return {
      runId: runId,
      verticalName: verticalCode,
      legalName: legalNameForVertical_(verticalCode),
      canGenerate: !!check.ok,
      reason: check.reason || '',
      message: check.message || '',
      employeeCount: rows.length,
      completeCount: rows.filter(function (r) { return r.register_complete; }).length
    };
  }

  function findFormTFileInFolder_(folder) {
    if (!folder) return '';
    var names = ['FormT.xlsx', 'Form T.xlsx', 'FormT'];
    for (var n = 0; n < names.length; n++) {
      var files = folder.getFilesByName(names[n]);
      if (files.hasNext()) return files.next().getId();
    }
    return '';
  }

  function resolveTemplateFileId_() {
    var fromSettings = trim_(ConfigService.getSetting(HRMS.SETTINGS_KEYS.FORM_T_TEMPLATE_DRIVE_ID, ''));
    if (fromSettings) return fromSettings;

    var folders = [];
    try {
      var rootId = ConfigService.getDriveRootFolderId();
      if (rootId) folders.push(DriveApp.getFolderById(rootId));
    } catch (ignoreRoot) {}
    try {
      var ssFile = DriveApp.getFileById(ConfigService.getSpreadsheetId());
      var parents = ssFile.getParents();
      while (parents.hasNext()) folders.push(parents.next());
    } catch (ignoreSs) {}

    var seen = {};
    for (var i = 0; i < folders.length; i++) {
      var fid = folders[i].getId();
      if (seen[fid]) continue;
      seen[fid] = true;
      var found = findFormTFileInFolder_(folders[i]);
      if (found) return found;
    }

    try {
      var search = DriveApp.searchFiles(
        "title = 'FormT.xlsx' and mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' and trashed = false"
      );
      if (search.hasNext()) return search.next().getId();
    } catch (ignoreSearch) {}

    throw configurationError_(
      'Form T template not found. Upload FormT.xlsx to the same Google Drive folder as your HRMS spreadsheet ' +
      '(or HRMS Drive root), or set Settings key form_t_template_drive_id to the file ID.'
    );
  }

  function employeeRowValues_(emp) {
    var ctc = emp.ctc_monthly;
    if (ctc === '' || ctc == null) ctc = '';
    else ctc = Number(ctc);
    if (ctc !== '' && !isFinite(ctc)) ctc = '';
    return [
      trim_(emp.employee_id),
      AttendanceRegisterService.employeeDisplayName_(emp),
      trim_(emp.father_husband_name),
      trim_(emp.gender),
      trim_(emp.designation),
      trim_(emp.department),
      excelSerialFromDateValue_(emp.joining_date),
      trim_(emp.uan_no),
      trim_(emp.esi_no),
      ctc,
      PAYMENT_DATE_LABEL_
    ];
  }

  function fillEmployeeRow_(sheet, rowNum, year, month, item) {
    var emp = item.employee;
    var reg = item.register || {};
    var sum = item.summary || {};
    var counts = sum.code_counts || {};
    sheet.getRange(rowNum, COL_EMP_START_, 1, COL_EMP_COUNT_).setValues([employeeRowValues_(emp)]);
    var dim = AttendanceRegisterService.daysInMonth_(year, month);
    var dayValues = [];
    for (var d = 1; d <= DAY_COL_COUNT_; d++) {
      if (d <= dim) {
        dayValues.push(reg[AttendanceRegisterService.pad2_(d)] || '');
      } else {
        dayValues.push('');
      }
    }
    sheet.getRange(rowNum, FIRST_DAY_COL_, 1, DAY_COL_COUNT_).setValues([dayValues]);
    var whCount = (Number(counts['W/H']) || 0) + (Number(counts.WO) || 0);
    sheet.getRange(rowNum, SUMMARY_COLS_.P).setValue(counts.P || 0);
    sheet.getRange(rowNum, SUMMARY_COLS_.WH).setValue(whCount);
    sheet.getRange(rowNum, SUMMARY_COLS_.A).setValue(counts.A || 0);
    sheet.getRange(rowNum, SUMMARY_COLS_.L).setValue(counts.L || 0);
    sheet.getRange(rowNum, SUMMARY_COLS_.H).setValue(counts.H || 0);
    sheet.getRange(rowNum, SUMMARY_COLS_.S).setValue(counts.ML || 0);
    sheet.getRange(rowNum, SUMMARY_COLS_.LEAVE_BAL).setValue(sum.leave_balance != null ? sum.leave_balance : 0);
    sheet.getRange(rowNum, SUMMARY_COLS_.DAYS).setValue(sum.days_total || 0);
  }

  function buildFormT(runId, verticalName) {
    PermissionService.require(HRMS.ACTIONS.PAYROLL_RUN);
    var verticalCode = normalizeVertical_(verticalName);
    var check = canGenerateFormT_(runId, verticalCode);
    if (!check.ok) {
      throw validationError_(check.message || 'Cannot generate Form T for this vertical.');
    }
    var run = DbService.findOne(HRMS.SHEETS.PAYROLL_RUNS, { payroll_run_id: runId });
    var year = Number(run.period_year);
    var month = Number(run.period_month);
    var catalogEntry = verticalCatalogEntry_(verticalCode);
    var rows = employeesForVerticalRun_(runId, verticalCode);
    var templateId = resolveTemplateFileId_();
    var workingName = 'FormT_' + verticalCode + '_' + year + '_' + AttendanceRegisterService.pad2_(month) + '_' + Date.now();
    var copyFile = DriveApp.getFileById(templateId).makeCopy(workingName);
    var fileId = copyFile.getId();
    var blob;
    try {
      var ss = SpreadsheetApp.openById(fileId);
      var sheet = ss.getSheetByName(SHEET_NAME_) || ss.getSheets()[0];
      applyFormTHeader_(sheet, year, month, catalogEntry);
      var startRow = DATA_START_ROW_;
      var lastRowToClear = Math.max(sheet.getLastRow(), startRow + rows.length + 5);
      var numClearRows = lastRowToClear - startRow + 1;
      if (numClearRows > 0) {
        sheet.getRange(startRow, 1, numClearRows, SUMMARY_COLS_.DAYS).clearContent();
      }
      for (var i = 0; i < rows.length; i++) {
        fillEmployeeRow_(sheet, startRow + i, year, month, rows[i]);
      }
      SpreadsheetApp.flush();
      Utilities.sleep(200);
      if (typeof AttendanceBulkService !== 'undefined' && AttendanceBulkService.exportSpreadsheetXlsx_) {
        blob = AttendanceBulkService.exportSpreadsheetXlsx_(fileId);
      } else {
        blob = DriveApp.getFileById(fileId).getBlob();
      }
      blob = blob.setName('FormT_' + verticalCode + '_' + year + '_' + AttendanceRegisterService.pad2_(month) + '.xlsx');
    } finally {
      try { DriveApp.getFileById(fileId).setTrashed(true); } catch (ignoreTrash) {}
    }
    return blob;
  }

  function download(runId, verticalName) {
    var verticalCode = normalizeVertical_(verticalName);
    var run = DbService.findOne(HRMS.SHEETS.PAYROLL_RUNS, { payroll_run_id: runId });
    if (!run) throw notFoundError_('Payroll run not found.');
    var blob = buildFormT(runId, verticalCode);
    var bytes = blob.getBytes();
    return {
      fileName: blob.getName(),
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      base64: Utilities.base64Encode(bytes),
      verticalName: verticalCode,
      legalName: legalNameForVertical_(verticalCode)
    };
  }

  return {
    canGenerateFormT_: canGenerateFormT_,
    getStatus: getStatus,
    buildFormT: buildFormT,
    download: download
  };
})();
