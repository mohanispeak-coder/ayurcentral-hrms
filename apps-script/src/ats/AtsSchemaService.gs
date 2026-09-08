/**
 * ATS sheet bootstrap — independent of SchemaService.setupDatabase.
 * Creates missing sheets/headers and seeds ATS settings only. Never drops data.
 */
var ATS = ATS || {};

var AtsSchemaService = (function () {
  var SHEET_HEADERS_ = {};
  SHEET_HEADERS_[ATS.SHEETS.JOBS] = [
    'job_id', 'public_slug', 'title', 'department', 'location', 'employment_type',
    'experience', 'education', 'salary_range', 'description', 'responsibilities',
    'requirements', 'skills', 'openings', 'hiring_manager_employee_id', 'hiring_manager_name',
    'status', 'closing_date', 'notes_internal', 'external_ref_json',
    'published_at', 'paused_at', 'closed_at',
    'created_at', 'created_by_email', 'updated_at', 'updated_by_email'
  ];
  SHEET_HEADERS_[ATS.SHEETS.CANDIDATES] = [
    'candidate_id', 'full_name', 'email', 'phone', 'location', 'education',
    'experience_summary', 'skills', 'source',
    'resume_drive_file_id', 'resume_file_name', 'resume_mime_type',
    'hired_employee_id', 'created_at', 'updated_at'
  ];
  SHEET_HEADERS_[ATS.SHEETS.APPLICATIONS] = [
    'application_id', 'job_id', 'candidate_id', 'stage', 'cover_letter', 'source',
    'applied_at', 'updated_at', 'stage_changed_at', 'stage_changed_by_email'
  ];
  SHEET_HEADERS_[ATS.SHEETS.INTERVIEWS] = [
    'interview_id', 'application_id', 'candidate_id', 'job_id', 'stage',
    'scheduled_at', 'interviewer_employee_id', 'interviewer_name', 'interviewer_email',
    'notes', 'rating', 'recommendation',
    'created_at', 'created_by_email', 'updated_at'
  ];
  SHEET_HEADERS_[ATS.SHEETS.ACTIVITY] = [
    'activity_id', 'candidate_id', 'application_id', 'job_id',
    'actor_email', 'action', 'summary', 'created_at'
  ];

  var DEFAULT_SETTINGS_ = [
    [ATS.SEQ.JOB, '0', 'NUMBER', 'Last ATS job sequence', true],
    [ATS.SEQ.CANDIDATE, '0', 'NUMBER', 'Last ATS candidate sequence', true],
    [ATS.SEQ.APPLICATION, '0', 'NUMBER', 'Last ATS application sequence', true],
    [ATS.SEQ.INTERVIEW, '0', 'NUMBER', 'Last ATS interview sequence', true],
    [ATS.SEQ.ACTIVITY, '0', 'NUMBER', 'Last ATS activity sequence', true],
    [ATS.SETTINGS.PIPELINE, JSON.stringify(ATS.DEFAULT_PIPELINE), 'STRING', 'ATS pipeline stages (JSON array)', false],
    [ATS.SETTINGS.APPLY_ENABLED, 'true', 'BOOLEAN', 'Allow public job applications', false],
    [ATS.SETTINGS.RESUME_MAX, String(ATS.LIMITS.RESUME_MAX_BYTES), 'NUMBER', 'Max resume upload bytes', true]
  ];

  function ensureSheet_(ss, name, headers) {
    var sheet = ss.getSheetByName(name);
    var created = false;
    if (!sheet) {
      sheet = ss.insertSheet(name);
      created = true;
    }
    if (sheet.getLastRow() === 0 || sheet.getRange(1, 1).getValue() === '') {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      return { sheet: sheet, created: created, columnsAdded: headers.length };
    }
    var existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    var added = 0;
    headers.forEach(function (h) {
      if (existing.indexOf(h) >= 0) return;
      var col = sheet.getLastColumn() + 1;
      sheet.getRange(1, col).setValue(h).setFontWeight('bold');
      existing.push(h);
      added++;
    });
    return { sheet: sheet, created: created, columnsAdded: added };
  }

  function seedSettings_(ss) {
    var sheet = ss.getSheetByName(HRMS.SHEETS.SETTINGS);
    if (!sheet) return { inserted: 0 };
    var existing = {};
    if (sheet.getLastRow() >= 2) {
      var data = sheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        var k = String(data[i][0] || '').trim();
        if (k) existing[k] = true;
      }
    }
    var now = new Date();
    var actor = 'system';
    try {
      actor = Session.getActiveUser().getEmail().toLowerCase() || 'system';
    } catch (ignore) {}
    var inserted = 0;
    DEFAULT_SETTINGS_.forEach(function (row) {
      if (existing[row[0]]) return;
      sheet.appendRow([row[0], row[1], row[2], row[3], row[4], now, actor]);
      inserted++;
    });
    if (inserted && typeof ConfigService !== 'undefined' && ConfigService.clearSettingsCache) {
      ConfigService.clearSettingsCache();
    }
    return { inserted: inserted };
  }

  function ensureSheets(optSpreadsheet) {
    var ss = optSpreadsheet || ConfigService.openSpreadsheet();
    var sheets = [];
    Object.keys(SHEET_HEADERS_).forEach(function (name) {
      var result = ensureSheet_(ss, name, SHEET_HEADERS_[name]);
      sheets.push({
        name: name,
        created: result.created,
        columnsAdded: result.columnsAdded
      });
    });
    var settings = seedSettings_(ss);
    if (typeof DbService !== 'undefined' && DbService.clearRequestCache) {
      DbService.clearRequestCache();
    }
    return {
      spreadsheetId: ss.getId(),
      sheets: sheets,
      settingsInserted: settings.inserted
    };
  }

  function sheetsExist() {
    try {
      var ss = ConfigService.openSpreadsheet();
      return !!ss.getSheetByName(ATS.SHEETS.JOBS) &&
        !!ss.getSheetByName(ATS.SHEETS.CANDIDATES) &&
        !!ss.getSheetByName(ATS.SHEETS.APPLICATIONS);
    } catch (e) {
      return false;
    }
  }

  function getSchemaInfo() {
    return {
      sheets: Object.keys(SHEET_HEADERS_),
      headers: SHEET_HEADERS_,
      settingsKeys: DEFAULT_SETTINGS_.map(function (r) { return r[0]; })
    };
  }

  return {
    ensureSheets: ensureSheets,
    sheetsExist: sheetsExist,
    getSchemaInfo: getSchemaInfo
  };
})();
