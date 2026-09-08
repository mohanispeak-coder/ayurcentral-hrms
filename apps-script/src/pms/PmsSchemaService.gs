/**
 * Module-owned PMS sheet bootstrap. Does not edit SchemaService.gs.
 * Called lazily from PMS APIs. Optional later hook: SchemaService.setupDatabase.
 */
var HRMS = HRMS || {};

var PmsSchemaService = (function () {
  var ensuredThisExecution_ = false;

  if (!HRMS.SHEETS || !HRMS.SHEETS.PERFORMANCE_CYCLES) {
    throw new Error('PmsConstants must load before PmsSchemaService.');
  }

  var SHEET_HEADERS_ = {};
  SHEET_HEADERS_[HRMS.SHEETS.PERFORMANCE_CYCLES] = [
    'cycle_id', 'name', 'start_date', 'end_date', 'status',
    'submission_deadline', 'review_deadline', 'notes',
    'created_at', 'created_by_email', 'updated_at', 'updated_by_email'
  ];
  SHEET_HEADERS_[HRMS.SHEETS.PERFORMANCE_GOALS] = [
    'goal_id', 'cycle_id', 'employee_id', 'title', 'description', 'measurement', 'target',
    'weight', 'status', 'progress', 'achievement',
    'employee_comments', 'manager_comments', 'employee_rating', 'manager_rating',
    'created_at', 'created_by_email', 'updated_at', 'updated_by_email'
  ];
  SHEET_HEADERS_[HRMS.SHEETS.PERFORMANCE_REVIEWS] = [
    'review_id', 'cycle_id', 'employee_id', 'manager_employee_id', 'status',
    'employee_overall_comments', 'manager_overall_comments', 'hr_comments',
    'overall_rating', 'final_rating', 'reopen_allowed',
    'employee_submitted_at', 'manager_submitted_at', 'finalized_at', 'finalized_by_email',
    'created_at', 'updated_at', 'updated_by_email'
  ];
  SHEET_HEADERS_[HRMS.SHEETS.PERFORMANCE_RATINGS] = [
    'rating_id', 'scale_code', 'value', 'label', 'description', 'sort_order', 'is_active'
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
      return { sheet: sheet, created: created, headersAdded: headers.slice() };
    }
    var lastCol = Math.max(sheet.getLastColumn(), 1);
    var existing = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
    var missing = [];
    headers.forEach(function (h) {
      if (existing.indexOf(h) < 0) missing.push(h);
    });
    if (missing.length) {
      sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
      sheet.getRange(1, 1, 1, existing.length + missing.length).setFontWeight('bold');
    }
    return { sheet: sheet, created: created, headersAdded: missing };
  }

  function seedRatings_(ss) {
    var sheet = ss.getSheetByName(HRMS.SHEETS.PERFORMANCE_RATINGS);
    if (!sheet) return { inserted: 0 };
    if (sheet.getLastRow() >= 2) return { inserted: 0 };
    var defaults = HRMS.PMS.DEFAULT_RATINGS || [];
    var rows = defaults.map(function (row, i) {
      return [
        (typeof DbService !== 'undefined' && DbService.generateId)
          ? DbService.generateId(HRMS.PMS.ID_PREFIX.RATING)
          : ('PRT-' + (i + 1)),
        HRMS.PMS.SCALE_CODE,
        row.value,
        row.label,
        row.description || '',
        row.sort_order || (i + 1),
        true
      ];
    });
    if (!rows.length) return { inserted: 0 };
    sheet.getRange(2, 1, rows.length, SHEET_HEADERS_[HRMS.SHEETS.PERFORMANCE_RATINGS].length).setValues(rows);
    if (typeof DbService !== 'undefined' && DbService.invalidateSheetData) {
      DbService.invalidateSheetData(HRMS.SHEETS.PERFORMANCE_RATINGS);
    }
    return { inserted: rows.length };
  }

  function getHeaderMap() {
    var copy = {};
    Object.keys(SHEET_HEADERS_).forEach(function (k) {
      copy[k] = SHEET_HEADERS_[k].slice();
    });
    return copy;
  }

  /**
   * Create PMS sheets/headers and seed the default rating scale when empty.
   * @return {Object}
   */
  function ensure() {
    if (ensuredThisExecution_) {
      return { already: true, sheets: Object.keys(SHEET_HEADERS_) };
    }
    if (typeof ConfigService === 'undefined' || !ConfigService.openSpreadsheet) {
      throw (typeof configurationError_ === 'function'
        ? configurationError_('Spreadsheet is not configured.')
        : new Error('Spreadsheet is not configured.'));
    }
    var t0 = Date.now();
    var ss = ConfigService.openSpreadsheet();
    var sheetResults = [];
    Object.keys(SHEET_HEADERS_).forEach(function (name) {
      var result = ensureSheet_(ss, name, SHEET_HEADERS_[name]);
      sheetResults.push({ name: name, created: result.created, headersAdded: result.headersAdded });
    });
    if (typeof HrmsPerf !== 'undefined' && HrmsPerf.addStage) {
      HrmsPerf.addStage('ensure', Date.now() - t0);
    }
    var seed = seedRatings_(ss);
    ensuredThisExecution_ = true;
    if (typeof DbService !== 'undefined' && DbService.clearRequestCache) {
      /* newly created sheets must be readable this execution */
    }
    return {
      already: false,
      sheets: sheetResults,
      ratingsInserted: seed.inserted
    };
  }

  function getSchemaInfo() {
    return {
      sheets: Object.keys(SHEET_HEADERS_),
      headers: getHeaderMap()
    };
  }

  /** Test helper — reset per-execution guard. */
  function resetEnsureFlagForTests() {
    ensuredThisExecution_ = false;
  }

  return {
    ensure: ensure,
    getSchemaInfo: getSchemaInfo,
    getHeaderMap: getHeaderMap,
    resetEnsureFlagForTests: resetEnsureFlagForTests
  };
})();
