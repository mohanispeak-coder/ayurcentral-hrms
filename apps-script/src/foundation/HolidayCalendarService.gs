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
    var n = 1;
    if (DbService.nextSequenceAssumingLocked) {
      n = DbService.nextSequenceAssumingLocked('seq_holiday');
    } else {
      var row = DbService.findOne(HRMS.SHEETS.SETTINGS, { setting_key: 'seq_holiday' });
      n = Number(row && row.setting_value) + 1;
      if (!isFinite(n) || n < 1) n = 1;
      DbService.updateRecord(HRMS.SHEETS.SETTINGS, 'setting_key', 'seq_holiday', {
        setting_value: String(n),
        updated_at: new Date()
      });
    }
    return 'HOL' + String(n).replace(/\D/g, '').slice(-8) || ('HOL' + n);
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
      var year = defaultYear || Number(date.substring(0, 4));
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

  function validateImport(session, meta) {
    requireManage_();
    meta = meta || {};
    var text = trim_(meta.csv_text);
    if (!text && meta.base64) {
      text = Utilities.newBlob(Utilities.base64Decode(meta.base64)).getDataAsString('UTF-8');
    }
    if (!text) throw validationError_('CSV content is required.');
    var defaultYear = Number(meta.calendar_year) || 0;
    var parsed = parseCsvText_(text);
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

  function downloadImportTemplate() {
    requireManage_();
    var header = 'holiday_date,name,scope,scope_value,optional';
    var sample = '2026-01-26,Republic Day,ALL,,false';
    var blob = Utilities.newBlob(header + '\n' + sample + '\n', 'text/csv', 'HRMS_Holiday_Import_Template.csv');
    return {
      fileName: blob.getName(),
      mimeType: 'text/csv',
      base64: Utilities.base64Encode(blob.getBytes())
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
      if (Number(r.calendar_year) !== year && Number(r.calendar_year) !== 0) {
        var d = parseIsoDate_(r.holiday_date);
        if (!d || Number(d.substring(0, 4)) !== year) return;
      }
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
    dayCodesForMonth: dayCodesForMonth
  };
})();
