/**
 * Public holiday master calendar — HR configure, attendance register pre-fills H.
 */
var HolidayCalendarService = (function () {
  var SCOPE_ALL_ = 'ALL';

  function trim_(v) {
    return v == null ? '' : String(v).trim();
  }

  function bool_(v) {
    if (v === true || v === 1) return true;
    var s = String(v == null ? '' : v).trim().toUpperCase();
    return s === 'TRUE' || s === 'YES' || s === 'Y' || s === '1';
  }

  function requireManage_() {
    PermissionService.requireAttendanceAccess();
  }

  function parseIsoDate_(s) {
    s = trim_(s);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    var p = s.split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    if (isNaN(d.getTime())) return null;
    if (d.getFullYear() !== Number(p[0]) || d.getMonth() !== Number(p[1]) - 1 || d.getDate() !== Number(p[2])) {
      return null;
    }
    return s;
  }

  function pad2_(n) {
    n = String(Number(n));
    return n.length < 2 ? '0' + n : n;
  }

  function normalizeScope_(scope, scopeValue) {
    scope = trim_(scope).toUpperCase();
    if (!scope || scope === SCOPE_ALL_) return { scope: SCOPE_ALL_, scope_value: '' };
    scopeValue = trim_(scopeValue).toUpperCase();
    if (!scopeValue) throw validationError_('scope_value is required when scope is not ALL.');
    return { scope: scope, scope_value: scopeValue };
  }

  function rowApplies_(row, verticalCode) {
    var sc = trim_(row.scope).toUpperCase() || SCOPE_ALL_;
    if (sc === SCOPE_ALL_) return true;
    var v = trim_(verticalCode).toUpperCase();
    return sc === v || trim_(row.scope_value).toUpperCase() === v;
  }

  function serializeRow_(row) {
    return {
      holiday_id: row.holiday_id,
      calendar_year: Number(row.calendar_year),
      holiday_date: parseIsoDate_(row.holiday_date) || trim_(row.holiday_date),
      name: trim_(row.name),
      scope: trim_(row.scope).toUpperCase() || SCOPE_ALL_,
      scope_value: trim_(row.scope_value),
      optional: bool_(row.optional),
      register_code: trim_(row.register_code) || 'H',
      source: trim_(row.source) || 'MANUAL',
      created_at: row.created_at,
      created_by_email: row.created_by_email
    };
  }

  function listRows_(calendarYear) {
    var y = Number(calendarYear);
    var all = DbService.getAllRecords(HRMS.SHEETS.HOLIDAY_CALENDAR) || [];
    if (!y) return all.map(serializeRow_);
    return all.filter(function (r) { return Number(r.calendar_year) === y; }).map(serializeRow_);
  }

  function listForClient(session, query) {
    requireManage_();
    query = query || {};
    var year = Number(query.calendar_year) || new Date().getFullYear();
    var scopeFilter = trim_(query.scope).toUpperCase();
    var rows = listRows_(year);
    if (scopeFilter && scopeFilter !== 'ALL') {
      rows = rows.filter(function (r) {
        return r.scope === SCOPE_ALL_ || r.scope === scopeFilter ||
          r.scope_value === scopeFilter;
      });
    }
    rows.sort(function (a, b) {
      return String(a.holiday_date).localeCompare(String(b.holiday_date));
    });
    var verticals = (DbService.getAllRecords(HRMS.SHEETS.VERTICALS) || []).map(function (v) {
      return trim_(v.vertical_name).toUpperCase();
    }).filter(Boolean);
    return {
      calendar_year: year,
      holidays: rows,
      verticals: verticals,
      presets: listPresets_()
    };
  }

  function duplicateKey_(date, scope, scopeValue) {
    return String(date) + '|' + String(scope).toUpperCase() + '|' + String(scopeValue).toUpperCase();
  }

  function nextHolidayId_() {
    return 'HOL' + Utilities.getUuid().replace(/-/g, '').slice(0, 10).toUpperCase();
  }

  function saveHoliday(session, payload) {
    requireManage_();
    payload = payload || {};
    var date = parseIsoDate_(payload.holiday_date);
    if (!date) throw validationError_('holiday_date must be YYYY-MM-DD.');
    var name = trim_(payload.name);
    if (!name) throw validationError_('Holiday name is required.');
    var year = Number(payload.calendar_year);
    if (!year) year = Number(date.substring(0, 4));
    if (Number(date.substring(0, 4)) !== year) {
      throw validationError_('holiday_date must fall in calendar_year ' + year + '.');
    }
    var sc = normalizeScope_(payload.scope, payload.scope_value);
    var id = trim_(payload.holiday_id);
    var now = new Date().toISOString();
    var actor = session && session.email ? session.email : '';
    if (id) {
      var existing = DbService.findOne(HRMS.SHEETS.HOLIDAY_CALENDAR, { holiday_id: id });
      if (!existing) throw notFoundError_('Holiday not found.');
      var dup = findDuplicate_(date, sc.scope, sc.scope_value, id);
      if (dup) throw validationError_('A holiday already exists for this date and scope.');
      var updated = DbService.updateRecord(HRMS.SHEETS.HOLIDAY_CALENDAR, 'holiday_id', id, {
        calendar_year: year,
        holiday_date: date,
        name: name,
        scope: sc.scope,
        scope_value: sc.scope_value,
        optional: bool_(payload.optional) ? 'TRUE' : 'FALSE',
        register_code: 'H',
        source: trim_(payload.source) || existing.source || 'MANUAL'
      });
      return serializeRow_(updated);
    }
    if (findDuplicate_(date, sc.scope, sc.scope_value, null)) {
      throw validationError_('A holiday already exists for this date and scope.');
    }
    id = nextHolidayId_();
    var record = {
      holiday_id: id,
      calendar_year: year,
      holiday_date: date,
      name: name,
      scope: sc.scope,
      scope_value: sc.scope_value,
      optional: bool_(payload.optional) ? 'TRUE' : 'FALSE',
      register_code: 'H',
      source: trim_(payload.source) || 'MANUAL',
      created_at: now,
      created_by_email: actor
    };
    DbService.insertRecord(HRMS.SHEETS.HOLIDAY_CALENDAR, record);
    AuditService.log('HOLIDAY_SAVE', 'Holiday', id, name + ' ' + date, session.employee_id || '');
    return serializeRow_(record);
  }

  function findDuplicate_(date, scope, scopeValue, excludeId) {
    var rows = DbService.getAllRecords(HRMS.SHEETS.HOLIDAY_CALENDAR) || [];
    var key = duplicateKey_(date, scope, scopeValue);
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (excludeId && String(r.holiday_id) === String(excludeId)) continue;
      var k = duplicateKey_(parseIsoDate_(r.holiday_date) || r.holiday_date, r.scope, r.scope_value);
      if (k === key) return r;
    }
    return null;
  }

  function deleteHoliday(session, holidayId) {
    requireManage_();
    holidayId = trim_(holidayId);
    if (!holidayId) throw validationError_('holiday_id is required.');
    var row = DbService.findOne(HRMS.SHEETS.HOLIDAY_CALENDAR, { holiday_id: holidayId });
    if (!row) throw notFoundError_('Holiday not found.');
    DbService.deleteRecords(HRMS.SHEETS.HOLIDAY_CALENDAR, { holiday_id: holidayId });
    AuditService.log('HOLIDAY_DELETE', 'Holiday', holidayId, trim_(row.name), session.employee_id || '');
    return { deleted: true, holiday_id: holidayId };
  }

  function parseCsvText_(text) {
    var lines = String(text || '').split(/\r?\n/);
    var rows = [];
    var header = null;
    lines.forEach(function (line, idx) {
      line = trim_(line);
      if (!line) return;
      var cols = line.split(',').map(function (c) { return trim_(c.replace(/^"|"$/g, '')); });
      if (!header) {
        var lower = cols.map(function (c) { return c.toLowerCase(); });
        if (lower.indexOf('holiday_date') >= 0 || lower.indexOf('date') >= 0) {
          header = cols;
          return;
        }
      }
      if (!header) {
        if (cols.length >= 2) {
          rows.push({
            holiday_date: cols[0],
            name: cols[1],
            scope: cols[2] || SCOPE_ALL_,
            scope_value: cols[3] || '',
            optional: cols[4] || ''
          });
        }
        return;
      }
      var obj = {};
      header.forEach(function (h, i) {
        obj[String(h).toLowerCase()] = cols[i] != null ? cols[i] : '';
      });
      rows.push({
        holiday_date: obj.holiday_date || obj.date,
        name: obj.name,
        scope: obj.scope || SCOPE_ALL_,
        scope_value: obj.scope_value || '',
        optional: obj.optional || ''
      });
    });
    return rows;
  }

  function validateImportRows_(rows, defaultYear) {
    var valid = [];
    var errors = [];
    var seen = {};
    (rows || []).forEach(function (r, i) {
      var line = i + 1;
      var date = parseIsoDate_(r.holiday_date);
      if (!date) {
        errors.push({ line: line, message: 'Invalid date: ' + trim_(r.holiday_date) });
        return;
      }
      var name = trim_(r.name);
      if (!name) {
        errors.push({ line: line, message: 'Name is required.' });
        return;
      }
      var year = r.calendar_year ? Number(r.calendar_year) : (defaultYear || Number(date.substring(0, 4)));
      try {
        var sc = normalizeScope_(r.scope, r.scope_value);
        var key = duplicateKey_(date, sc.scope, sc.scope_value);
        if (seen[key]) {
          errors.push({ line: line, message: 'Duplicate in file for ' + date + ' / ' + sc.scope });
          return;
        }
        seen[key] = true;
        valid.push({
          calendar_year: year,
          holiday_date: date,
          name: name,
          scope: sc.scope,
          scope_value: sc.scope_value,
          optional: bool_(r.optional),
          register_code: 'H',
          source: 'IMPORT'
        });
      } catch (e) {
        errors.push({ line: line, message: e.message || String(e) });
      }
    });
    return { valid: valid, errors: errors };
  }

  function isExcelMeta_(meta) {
    meta = meta || {};
    var name = String(meta.fileName || '').toLowerCase();
    var mime = String(meta.mimeType || '').toLowerCase();
    return name.indexOf('.xlsx') >= 0 || name.indexOf('.xls') >= 0 ||
      mime.indexOf('spreadsheet') >= 0 || mime.indexOf('excel') >= 0;
  }

  function convertUploadToSheetId_(blob) {
    if (typeof Drive === 'undefined' || !Drive.Files) {
      throw configurationError_('Google Drive advanced service is required for Excel uploads.');
    }
    var temp = DriveApp.createFile(blob);
    try {
      var resource = { name: 'holiday-parse-' + Date.now(), mimeType: MimeType.GOOGLE_SHEETS };
      var converted = Drive.Files.create(resource, temp.getBlob(), { convert: true });
      return converted.id;
    } finally {
      temp.setTrashed(true);
    }
  }

  function parseImportSheet_(sheet) {
    var values = sheet.getDataRange().getValues();
    if (!values || values.length < 2) return [];
    var headerRowIndex = 0;
    for (var hi = 0; hi < Math.min(3, values.length); hi++) {
      var probe = values[hi].map(function (h) { return trim_(h).toLowerCase(); });
      if (probe.indexOf('holiday_date') >= 0 || probe.indexOf('date') >= 0) {
        headerRowIndex = hi;
        break;
      }
    }
    var header = values[headerRowIndex].map(function (h) { return trim_(h).toLowerCase(); });
    var rows = [];
    for (var r = headerRowIndex + 1; r < values.length; r++) {
      var line = values[r];
      var blank = true;
      for (var c = 0; c < line.length; c++) {
        if (trim_(line[c])) blank = false;
      }
      if (blank) continue;
      var obj = {};
      header.forEach(function (h, i) {
        if (!h) return;
        obj[h] = line[i];
      });
      rows.push({
        calendar_year: obj.calendar_year,
        holiday_date: obj.holiday_date || obj.date,
        name: obj.name,
        scope: obj.scope || SCOPE_ALL_,
        scope_value: obj.scope_value || '',
        optional: obj.optional || ''
      });
    }
    return rows;
  }

  function parseImportFromExcel_(meta) {
    var base64 = trim_(meta.base64);
    if (!base64) throw validationError_('Upload file is required.');
    var bytes = Utilities.base64Decode(base64);
    var blob = Utilities.newBlob(bytes, meta.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      meta.fileName || 'holidays.xlsx');
    var sheetId = convertUploadToSheetId_(blob);
    try {
      var ss = SpreadsheetApp.openById(sheetId);
      var sheet = ss.getSheetByName('Holidays') || ss.getSheets()[0];
      return parseImportSheet_(sheet);
    } finally {
      try { DriveApp.getFileById(sheetId).setTrashed(true); } catch (ignore) {}
    }
  }

  function validateImport(session, meta) {
    requireManage_();
    meta = meta || {};
    var defaultYear = Number(meta.calendar_year) || 0;
    var parsed = [];
    if (meta.base64 && isExcelMeta_(meta)) {
      parsed = parseImportFromExcel_(meta);
    } else {
      var text = trim_(meta.csv_text);
      if (!text && meta.base64) {
        text = Utilities.newBlob(Utilities.base64Decode(meta.base64)).getDataAsString('UTF-8');
      }
      if (!text) throw validationError_('Upload a CSV or Excel holiday template.');
      parsed = parseCsvText_(text);
    }
    return validateImportRows_(parsed, defaultYear || null);
  }

  function commitImport(session, payload) {
    requireManage_();
    payload = payload || {};
    var rows = payload.rows || [];
    if (!rows.length) throw validationError_('No rows to import.');
    var replace = bool_(payload.replace_scope_year || payload.replace);
    var filterYear = Number(payload.calendar_year);
    var filterScope = trim_(payload.scope).toUpperCase();
    var filterScopeValue = trim_(payload.scope_value).toUpperCase();
    if (replace) {
      if (!filterYear) throw validationError_('calendar_year is required for replace mode.');
      var all = DbService.getAllRecords(HRMS.SHEETS.HOLIDAY_CALENDAR) || [];
      all.forEach(function (r) {
        if (Number(r.calendar_year) !== filterYear) return;
        var sc = trim_(r.scope).toUpperCase() || SCOPE_ALL_;
        if (filterScope && filterScope !== 'ALL') {
          if (sc !== filterScope && trim_(r.scope_value).toUpperCase() !== filterScope) return;
        }
        if (filterScopeValue && sc !== SCOPE_ALL_ && trim_(r.scope_value).toUpperCase() !== filterScopeValue) return;
        DbService.deleteRecords(HRMS.SHEETS.HOLIDAY_CALENDAR, { holiday_id: r.holiday_id });
      });
    }
    var inserted = 0;
    var skipped = 0;
    rows.forEach(function (r) {
      try {
        if (findDuplicate_(r.holiday_date, r.scope, r.scope_value, null)) {
          skipped++;
          return;
        }
        saveHoliday(session, r);
        inserted++;
      } catch (ignoreDup) {
        skipped++;
      }
    });
    return { inserted: inserted, skipped: skipped, calendar_year: filterYear || null };
  }

  function listPresets_() {
    return [
      {
        id: 'IN_NATIONAL_FIXED',
        label: 'India — fixed national holidays',
        description: 'Republic Day, Independence Day, Gandhi Jayanti, Christmas (same dates every year).'
      }
    ];
  }

  function presetRows_(presetId, calendarYear) {
    var y = Number(calendarYear);
    if (!y) throw validationError_('calendar_year is required.');
    if (presetId !== 'IN_NATIONAL_FIXED') throw validationError_('Unknown preset.');
    return [
      { holiday_date: y + '-01-26', name: 'Republic Day' },
      { holiday_date: y + '-08-15', name: 'Independence Day' },
      { holiday_date: y + '-10-02', name: 'Gandhi Jayanti' },
      { holiday_date: y + '-12-25', name: 'Christmas' }
    ].map(function (r) {
      return {
        calendar_year: y,
        holiday_date: r.holiday_date,
        name: r.name,
        scope: SCOPE_ALL_,
        scope_value: '',
        optional: false,
        register_code: 'H',
        source: 'PRESET'
      };
    });
  }

  function applyPreset(session, payload) {
    requireManage_();
    payload = payload || {};
    var presetId = trim_(payload.preset_id);
    var year = Number(payload.calendar_year);
    var sc = normalizeScope_(payload.scope || SCOPE_ALL_, payload.scope_value);
    var rows = presetRows_(presetId, year).map(function (r) {
      r.scope = sc.scope;
      r.scope_value = sc.scope_value;
      return r;
    });
    return commitImport(session, {
      rows: rows,
      replace: false,
      calendar_year: year
    });
  }

  function driveApiHint_() {
    return ' Enable Google Drive API: Apps Script editor → Services (+) → Google Drive API → Add, then redeploy.';
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
    throw configurationError_('Could not export holiday Excel template.' + driveApiHint_());
  }

  function buildYearTemplateRows_(year) {
    var headers = ['calendar_year', 'holiday_date', 'name', 'scope', 'scope_value', 'optional'];
    var lines = [headers.join(',')];
    presetRows_('IN_NATIONAL_FIXED', year).forEach(function (r) {
      lines.push([year, r.holiday_date, r.name, SCOPE_ALL_, '', 'false'].join(','));
    });
    var blankRows = 54;
    for (var i = 0; i < blankRows; i++) {
      lines.push([year, '', '', 'ALL', '', 'false'].join(','));
    }
    return { headers: headers, csv: lines.join('\n') + '\n' };
  }

  function downloadYearTemplateCsv_(year) {
    var pack = buildYearTemplateRows_(year);
    var blob = Utilities.newBlob(pack.csv, 'text/csv', 'HRMS_Holiday_Calendar_' + year + '.csv');
    return {
      fileName: blob.getName(),
      mimeType: 'text/csv',
      base64: Utilities.base64Encode(blob.getBytes()),
      calendar_year: year,
      templateVersion: '1-csv',
      format: 'csv'
    };
  }

  function fileResponseFromBlob_(blob, year, format) {
    return {
      fileName: blob.getName(),
      mimeType: blob.getContentType(),
      base64: Utilities.base64Encode(blob.getBytes()),
      calendar_year: year,
      templateVersion: '1',
      format: format || 'xlsx'
    };
  }

  function downloadYearTemplate(calendarYear) {
    requireManage_();
    var year = Number(calendarYear) || new Date().getFullYear();
    var ss = SpreadsheetApp.create('HRMS Holiday Calendar ' + year);
    var fileId = ss.getId();
    var blob;
    try {
      var inst = ss.getSheets()[0];
      inst.setName('Instructions');
      var instLines = [
        ['HRMS public holiday calendar — ' + year],
        [''],
        ['1. Open the Holidays sheet. Fill holiday_date (YYYY-MM-DD), name, scope (ALL or vertical code), scope_value (blank or vertical).'],
        ['2. optional: true/false. calendar_year column is pre-filled — keep it as ' + year + '.'],
        ['3. Save this file and upload on Attendance → Holidays (Validate → Import).'],
        ['4. Register template download pre-fills H on these dates for ALL + matching vertical.'],
        ['5. Leave calendar and attendance register screens list holidays for the month.']
      ];
      inst.getRange(1, 1, instLines.length, 1).setValues(instLines);

      var sheet = ss.insertSheet('Holidays');
      var headers = ['calendar_year', 'holiday_date', 'name', 'scope', 'scope_value', 'optional'];
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
      sheet.setFrozenRows(1);

      var data = presetRows_('IN_NATIONAL_FIXED', year).map(function (r) {
        return [year, r.holiday_date, r.name, SCOPE_ALL_, '', 'false'];
      });
      for (var bi = 0; bi < 54; bi++) {
        data.push([year, '', '', 'ALL', '', 'false']);
      }
      if (data.length) {
        sheet.getRange(2, 1, data.length, headers.length).setValues(data);
      }
      sheet.autoResizeColumns(1, headers.length);

      blob = exportSpreadsheetXlsx_(fileId);
      blob.setName('HRMS_Holiday_Calendar_' + year + '.xlsx');
      return fileResponseFromBlob_(blob, year, 'xlsx');
    } catch (e) {
      Logger.log('Holiday xlsx template failed, CSV fallback: ' + (e.message || e));
      if (e.hrmsCode) throw e;
      return downloadYearTemplateCsv_(year);
    } finally {
      try { DriveApp.getFileById(fileId).setTrashed(true); } catch (ignore) {}
    }
  }

  function downloadImportTemplate() {
    var year = new Date().getFullYear();
    return downloadYearTemplate(year);
  }

  /**
   * Holidays applicable in a calendar month (for UI + leave calendar).
   */
  function listHolidaysForMonth(year, month, verticalCode) {
    year = Number(year);
    month = Number(month);
    var out = [];
    var rows = DbService.getAllRecords(HRMS.SHEETS.HOLIDAY_CALENDAR) || [];
    rows.forEach(function (r) {
      if (!rowApplies_(r, verticalCode)) return;
      var d = parseIsoDate_(r.holiday_date);
      if (!d) return;
      var parts = d.split('-');
      if (Number(parts[0]) !== year || Number(parts[1]) !== month) return;
      out.push({
        holiday_id: r.holiday_id,
        holiday_date: d,
        name: trim_(r.name),
        scope: trim_(r.scope).toUpperCase() || SCOPE_ALL_,
        scope_value: trim_(r.scope_value),
        optional: bool_(r.optional),
        register_code: trim_(r.register_code) || 'H'
      });
    });
    out.sort(function (a, b) { return String(a.holiday_date).localeCompare(String(b.holiday_date)); });
    return out;
  }

  function listForMonthClient(session, year, month, vertical) {
    AuthService.requireAuth();
    var y = Number(year) || new Date().getFullYear();
    var m = Number(month) || (new Date().getMonth() + 1);
    var vert = trim_(vertical).toUpperCase();
    if (!vert && session && session.employee_id) {
      var emp = DbService.findOne(HRMS.SHEETS.EMPLOYEES, { employee_id: session.employee_id });
      if (emp) vert = trim_(emp.vertical_name).toUpperCase();
    }
    return {
      year: y,
      month: m,
      vertical: vert || '',
      holidays: listHolidaysForMonth(y, m, vert)
    };
  }

  /**
   * Day-of-month codes for attendance register (e.g. { '26': 'H' }).
   */
  function dayCodesForMonth(year, month, verticalCode) {
    year = Number(year);
    month = Number(month);
    var out = {};
    var rows = DbService.getAllRecords(HRMS.SHEETS.HOLIDAY_CALENDAR) || [];
    rows.forEach(function (r) {
      if (!rowApplies_(r, verticalCode)) return;
      var d = parseIsoDate_(r.holiday_date);
      if (!d) return;
      var parts = d.split('-');
      if (Number(parts[0]) !== year || Number(parts[1]) !== month) return;
      var code = trim_(r.register_code) || 'H';
      out[pad2_(parts[2])] = code;
    });
    return out;
  }

  return {
    listForClient: listForClient,
    saveHoliday: saveHoliday,
    deleteHoliday: deleteHoliday,
    validateImport: validateImport,
    commitImport: commitImport,
    applyPreset: applyPreset,
    downloadImportTemplate: downloadImportTemplate,
    downloadYearTemplate: downloadYearTemplate,
    listHolidaysForMonth: listHolidaysForMonth,
    listForMonthClient: listForMonthClient,
    dayCodesForMonth: dayCodesForMonth
  };
})();
