/**
 * Lightweight Google Sheets data access layer.
 * Request-scoped caches avoid repeated openById / getSheetByName / getDataRange
 * within a single Apps Script execution. Writes invalidate sheet value caches.
 */
var HRMS = HRMS || {};

var DbService = (function () {
  /** @type {Object.<string, GoogleAppsScript.Spreadsheet.Sheet>} */
  var sheetCache_ = {};
  /** @type {Object.<string, Array.<Array.<*>>>} */
  var valuesCache_ = {};
  /** @type {Object.<string, Array.<*>>} sheetName#colName → column values including header */
  var columnCache_ = {};
  var stats_ = { getSheetByName: 0, getDataRange: 0, getLastRow: 0, setValue: 0, setValues: 0, appendRow: 0, getColumn: 0 };

  function getSheet_(sheetName) {
    if (sheetCache_[sheetName]) {
      if (typeof HrmsPerf !== 'undefined' && HrmsPerf.count) {
        HrmsPerf.count('sheetCacheHit');
      }
      return sheetCache_[sheetName];
    }
    var t0 = Date.now();
    var sheet = ConfigService.openSpreadsheet().getSheetByName(sheetName);
    stats_.getSheetByName++;
    if (typeof HrmsPerf !== 'undefined') {
      HrmsPerf.addStage('sheetLookup', Date.now() - t0);
      HrmsPerf.count('getSheetByName', sheetName);
    }
    if (!sheet) {
      throw notFoundError_('Sheet not found: ' + sheetName);
    }
    sheetCache_[sheetName] = sheet;
    return sheet;
  }

  /**
   * Full sheet values for this execution (invalidated on write).
   * @param {string} sheetName
   * @return {Array.<Array.<*>>}
   */
  function getSheetValues_(sheetName) {
    if (valuesCache_.hasOwnProperty(sheetName)) {
      if (typeof HrmsPerf !== 'undefined' && HrmsPerf.count) {
        HrmsPerf.count('valuesCacheHit');
      }
      return valuesCache_[sheetName];
    }
    var sheet = getSheet_(sheetName);
    var t0 = Date.now();
    stats_.getLastRow++;
    if (typeof HrmsPerf !== 'undefined' && HrmsPerf.count) {
      HrmsPerf.count('getLastRow', sheetName);
    }
    var data = sheet.getLastRow() < 1 ? [] : sheet.getDataRange().getValues();
    if (data.length) {
      stats_.getDataRange++;
      if (typeof HrmsPerf !== 'undefined') {
        HrmsPerf.count('getDataRange', sheetName);
        HrmsPerf.count('getValues', sheetName);
      }
    }
    var ms = Date.now() - t0;
    if (typeof HrmsPerf !== 'undefined') {
      HrmsPerf.log('getDataRange:' + sheetName, ms);
      HrmsPerf.addStage('getDataRange', ms);
    }
    valuesCache_[sheetName] = data;
    return data;
  }

  function invalidateSheetData_(sheetName) {
    delete valuesCache_[sheetName];
    var prefix = sheetName + '#';
    Object.keys(columnCache_).forEach(function (key) {
      if (key.indexOf(prefix) === 0) delete columnCache_[key];
    });
    if (sheetName === HRMS.SHEETS.USERS || sheetName === HRMS.SHEETS.EMPLOYEES) {
      if (typeof AuthService !== 'undefined' && AuthService.invalidateIdentitySnapshots) {
        AuthService.invalidateIdentitySnapshots();
      }
    }
  }

  function clearRequestCache_() {
    sheetCache_ = {};
    valuesCache_ = {};
    columnCache_ = {};
    stats_ = { getSheetByName: 0, getDataRange: 0, getLastRow: 0, setValue: 0, setValues: 0, appendRow: 0, getColumn: 0 };
  }

  function cellEquals_(cell, expected) {
    if (cell === expected) return true;
    if (typeof cell === 'string' && typeof expected === 'string') {
      return cell.toLowerCase() === expected.toLowerCase();
    }
    if (cell === '' || cell === null || cell === undefined) {
      return expected === '' || expected === null || expected === undefined;
    }
    return String(cell) === String(expected);
  }

  function getHeaders_(sheet) {
    stats_.getLastRow++;
    if (typeof HrmsPerf !== 'undefined' && HrmsPerf.count) {
      HrmsPerf.count('getLastRow');
    }
    if (sheet.getLastRow() < 1) return [];
    var t0 = Date.now();
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    if (typeof HrmsPerf !== 'undefined') {
      HrmsPerf.addStage('getDataRange', Date.now() - t0);
      HrmsPerf.count('getValues');
    }
    return headers;
  }

  /**
   * One column including the header row. Cached per request until the sheet is written.
   * @param {string} sheetName
   * @param {string} columnName
   * @return {{headers: Array.<string>, colIdx: number, values: Array.<*>}}
   */
  function getColumnValues_(sheetName, columnName) {
    var cacheKey = sheetName + '#' + columnName;
    if (columnCache_.hasOwnProperty(cacheKey)) {
      if (typeof HrmsPerf !== 'undefined' && HrmsPerf.count) HrmsPerf.count('columnCacheHit');
      return columnCache_[cacheKey];
    }
    if (valuesCache_.hasOwnProperty(sheetName)) {
      var data = valuesCache_[sheetName];
      var headers = data.length ? data[0].map(String) : [];
      var idx = headers.indexOf(columnName);
      var vals = [];
      if (idx >= 0) {
        for (var i = 0; i < data.length; i++) vals.push(data[i][idx]);
      }
      var fromFull = { headers: headers, colIdx: idx, values: vals };
      columnCache_[cacheKey] = fromFull;
      return fromFull;
    }
    var sheet = getSheet_(sheetName);
    var headers = getHeaders_(sheet);
    var colIdx = headers.indexOf(columnName);
    if (colIdx < 0) {
      throw configurationError_('Column not found: ' + columnName + ' on ' + sheetName);
    }
    stats_.getLastRow++;
    if (typeof HrmsPerf !== 'undefined' && HrmsPerf.count) HrmsPerf.count('getLastRow', sheetName);
    var lastRow = sheet.getLastRow();
    var values = [];
    if (lastRow >= 1) {
      var t0 = Date.now();
      values = sheet.getRange(1, colIdx + 1, lastRow, 1).getValues().map(function (r) { return r[0]; });
      stats_.getColumn++;
      if (typeof HrmsPerf !== 'undefined') {
        HrmsPerf.addStage('getColumn', Date.now() - t0);
        HrmsPerf.count('getColumn', sheetName + '.' + columnName);
        HrmsPerf.count('getValues', sheetName);
      }
    }
    var packed = { headers: headers, colIdx: colIdx, values: values };
    columnCache_[cacheKey] = packed;
    return packed;
  }

  /**
   * 1-based sheet row number for a column match, or 0.
   * @param {string} sheetName
   * @param {string} pkColumn
   * @param {*} pkValue
   * @return {number}
   */
  function findRowNumber(sheetName, pkColumn, pkValue) {
    var col = getColumnValues_(sheetName, pkColumn);
    if (col.colIdx < 0 || !col.values || col.values.length < 2) return 0;
    for (var i = 1; i < col.values.length; i++) {
      if (cellEquals_(col.values[i], pkValue)) return i + 1;
    }
    return 0;
  }

  /**
   * Read one data row as an object (rowNumber is 1-based, header is 1).
   * @param {string} sheetName
   * @param {number} rowNumber
   * @return {Object|null}
   */
  function getRecordAtRow(sheetName, rowNumber) {
    if (!rowNumber || rowNumber < 2) return null;
    if (valuesCache_.hasOwnProperty(sheetName)) {
      var cached = valuesCache_[sheetName];
      if (!cached || rowNumber > cached.length) return null;
      return rowToObject_(cached[0].map(String), cached[rowNumber - 1]);
    }
    var sheet = getSheet_(sheetName);
    var headers = getHeaders_(sheet);
    if (!headers.length) return null;
    var t0 = Date.now();
    var row = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
    if (typeof HrmsPerf !== 'undefined') {
      HrmsPerf.addStage('getRow', Date.now() - t0);
      HrmsPerf.count('getValues', sheetName);
    }
    return rowToObject_(headers, row);
  }

  /**
   * Read selected columns as objects. Uses the full-sheet cache when already loaded.
   * @param {string} sheetName
   * @param {Array.<string>} columnNames
   * @return {Array.<Object>}
   */
  function getProjectedRecords(sheetName, columnNames) {
    columnNames = columnNames || [];
    if (valuesCache_.hasOwnProperty(sheetName)) {
      return getAllRecords(sheetName).map(function (rec) {
        var out = {};
        columnNames.forEach(function (c) { out[c] = rec[c]; });
        return out;
      });
    }
    if (!columnNames.length) return getAllRecords(sheetName);
    var first = getColumnValues_(sheetName, columnNames[0]);
    var height = first.values ? first.values.length : 0;
    if (height < 2) return [];
    var cols = {};
    cols[columnNames[0]] = first.values;
    for (var c = 1; c < columnNames.length; c++) {
      cols[columnNames[c]] = getColumnValues_(sheetName, columnNames[c]).values;
    }
    var records = [];
    for (var i = 1; i < height; i++) {
      var obj = {};
      var empty = true;
      for (var j = 0; j < columnNames.length; j++) {
        var name = columnNames[j];
        var val = cols[name] && cols[name][i];
        obj[name] = val;
        if (val !== '' && val !== null && val !== undefined) empty = false;
      }
      if (!empty) records.push(obj);
    }
    return records;
  }

  function rowToObject_(headers, row) {
    var obj = {};
    for (var i = 0; i < headers.length; i++) {
      var h = headers[i];
      if (!h) continue;
      obj[h] = row[i];
    }
    return obj;
  }

  function isEmptyRow_(headers, row) {
    var pk = headers[0];
    if (!pk) return true;
    var idx = headers.indexOf(pk);
    var val = row[idx];
    return val === '' || val === null || val === undefined;
  }

  /**
   * @param {string} sheetName
   * @return {Array.<Object>}
   */
  function getAllRecords(sheetName) {
    var data = getSheetValues_(sheetName);
    if (!data || data.length < 2) return [];
    var headers = data[0].map(String);
    var records = [];
    for (var i = 1; i < data.length; i++) {
      if (isEmptyRow_(headers, data[i])) continue;
      records.push(rowToObject_(headers, data[i]));
    }
    return records;
  }

  /**
   * @param {string} sheetName
   * @param {Object} filter Column name → value (strict equality).
   * @return {Array.<Object>}
   */
  function findRecords(sheetName, filter) {
    filter = filter || {};
    return getAllRecords(sheetName).filter(function (record) {
      return Object.keys(filter).every(function (key) {
        var expected = filter[key];
        var actual = record[key];
        if (typeof expected === 'string' && typeof actual === 'string') {
          return actual.toLowerCase() === expected.toLowerCase();
        }
        return actual === expected;
      });
    });
  }

  /**
   * @param {string} sheetName
   * @param {Object} filter
   * @return {Object|null}
   */
  function findOne(sheetName, filter) {
    filter = filter || {};
    var keys = Object.keys(filter);
    if (keys.length === 1 && !valuesCache_.hasOwnProperty(sheetName)) {
      var rowNumber = findRowNumber(sheetName, keys[0], filter[keys[0]]);
      if (!rowNumber) return null;
      var record = getRecordAtRow(sheetName, rowNumber);
      return record && recordMatchesFilter_(record, filter) ? record : null;
    }
    var list = findRecords(sheetName, filter);
    return list.length ? list[0] : null;
  }

  /**
   * @param {string} sheetName
   * @param {Object} record Keys must match header names.
   * @return {Object} Inserted record.
   */
  function insertRecord(sheetName, record) {
    var sheet = getSheet_(sheetName);
    var headers = getHeaders_(sheet);
    if (!headers.length) {
      throw configurationError_('Sheet has no headers: ' + sheetName);
    }
    var row = headers.map(function (h) {
      return record.hasOwnProperty(h) ? record[h] : '';
    });
    var tWrite = Date.now();
    sheet.appendRow(row);
    stats_.appendRow++;
    if (typeof HrmsPerf !== 'undefined') {
      HrmsPerf.addStage('write', Date.now() - tWrite);
      HrmsPerf.count('appendRow', sheetName);
    }
    invalidateSheetData_(sheetName);
    return record;
  }

  /**
   * Batch insert — required for payroll calculate (avoid per-row append).
   * @param {string} sheetName
   * @param {Array.<Object>} records
   * @return {number}
   */
  function insertRecords(sheetName, records) {
    if (!records || !records.length) return 0;
    var sheet = getSheet_(sheetName);
    var headers = getHeaders_(sheet);
    if (!headers.length) {
      throw configurationError_('Sheet has no headers: ' + sheetName);
    }
    var values = records.map(function (record) {
      return headers.map(function (h) {
        return record.hasOwnProperty(h) ? record[h] : '';
      });
    });
    stats_.getLastRow++;
    if (typeof HrmsPerf !== 'undefined' && HrmsPerf.count) {
      HrmsPerf.count('getLastRow', sheetName);
    }
    var start = Math.max(sheet.getLastRow() + 1, 2);
    var tWrite = Date.now();
    sheet.getRange(start, 1, values.length, headers.length).setValues(values);
    stats_.setValues++;
    if (typeof HrmsPerf !== 'undefined') {
      HrmsPerf.addStage('write', Date.now() - tWrite);
      HrmsPerf.count('setValues', sheetName);
    }
    invalidateSheetData_(sheetName);
    return records.length;
  }

  function recordMatchesFilter_(record, filter) {
    return Object.keys(filter).every(function (key) {
      var expected = filter[key];
      var actual = record[key];
      if (typeof expected === 'string' && typeof actual === 'string') {
        return actual.toLowerCase() === expected.toLowerCase();
      }
      return actual === expected;
    });
  }

  /**
   * Delete rows matching filter. Used to rewrite DRAFT/CALCULATED payroll rows.
   * @param {string} sheetName
   * @param {Object} filter
   * @return {number} Deleted count.
   */
  function deleteRecords(sheetName, filter) {
    filter = filter || {};
    var sheet = getSheet_(sheetName);
    var data = getSheetValues_(sheetName);
    if (!data || data.length < 2) return 0;
    var headers = data[0].map(String);
    var deleted = 0;
    for (var i = data.length - 1; i >= 1; i--) {
      if (isEmptyRow_(headers, data[i])) continue;
      var record = rowToObject_(headers, data[i]);
      if (recordMatchesFilter_(record, filter)) {
        sheet.deleteRow(i + 1);
        deleted++;
      }
    }
    if (deleted) {
      invalidateSheetData_(sheetName);
    }
    return deleted;
  }

  /**
   * @param {string} sheetName
   * @param {string} pkColumn
   * @param {*} pkValue
   * @param {Object} updates
   * @return {Object|null} Updated record or null if not found.
   */
  function writeRowValues_(sheet, sheetName, rowNumber, headers, row) {
    var width = headers.length;
    var slice = row.slice(0, width);
    while (slice.length < width) slice.push('');
    var tWrite = Date.now();
    sheet.getRange(rowNumber, 1, 1, width).setValues([slice]);
    stats_.setValues++;
    if (typeof HrmsPerf !== 'undefined') {
      HrmsPerf.addStage('write', Date.now() - tWrite);
      HrmsPerf.count('setValues', sheetName);
    }
  }

  function applyUpdatesToRow_(headers, row, updates) {
    Object.keys(updates || {}).forEach(function (key) {
      var colIdx = headers.indexOf(key);
      if (colIdx >= 0) row[colIdx] = updates[key];
    });
    return row;
  }

  function updateRecord(sheetName, pkColumn, pkValue, updates) {
    var sheet = getSheet_(sheetName);
    var rowNumber = 0;
    var headers = [];
    var row = [];
    if (valuesCache_.hasOwnProperty(sheetName)) {
      var data = valuesCache_[sheetName];
      if (!data || data.length < 2) return null;
      headers = data[0].map(String);
      var pkIdx = headers.indexOf(pkColumn);
      if (pkIdx < 0) {
        throw configurationError_('Primary key column not found: ' + pkColumn);
      }
      for (var i = 1; i < data.length; i++) {
        if (cellEquals_(data[i][pkIdx], pkValue)) {
          rowNumber = i + 1;
          row = data[i].slice();
          break;
        }
      }
    } else {
      rowNumber = findRowNumber(sheetName, pkColumn, pkValue);
      if (!rowNumber) return null;
      headers = getHeaders_(sheet);
      row = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
      if (typeof HrmsPerf !== 'undefined' && HrmsPerf.count) HrmsPerf.count('getValues', sheetName);
    }
    if (!rowNumber) return null;
    applyUpdatesToRow_(headers, row, updates);
    writeRowValues_(sheet, sheetName, rowNumber, headers, row);
    invalidateSheetData_(sheetName);
    return rowToObject_(headers, row);
  }

  /**
   * Batch-update rows by primary key. One sheet read (or cache) and one setValues
   * per contiguous row block — not per cell and not a full reread after each row.
   * @param {string} sheetName
   * @param {string} pkColumn
   * @param {Array.<{pk: *, updates: Object}>} items
   * @return {number} Updated row count
   */
  function updateRecords(sheetName, pkColumn, items) {
    if (!items || !items.length) return 0;
    var sheet = getSheet_(sheetName);
    var data = getSheetValues_(sheetName);
    if (!data || data.length < 2) return 0;
    var headers = data[0].map(String);
    var pkIdx = headers.indexOf(pkColumn);
    if (pkIdx < 0) {
      throw configurationError_('Primary key column not found: ' + pkColumn);
    }
    var byPk = {};
    items.forEach(function (item) {
      if (!item) return;
      var key = typeof item.pk === 'string' ? item.pk.toLowerCase() : String(item.pk);
      byPk[key] = item.updates || {};
    });
    var changedRows = [];
    for (var i = 1; i < data.length; i++) {
      var cell = data[i][pkIdx];
      var key = typeof cell === 'string' ? cell.toLowerCase() : String(cell);
      if (!byPk.hasOwnProperty(key)) continue;
      applyUpdatesToRow_(headers, data[i], byPk[key]);
      changedRows.push(i + 1);
    }
    if (!changedRows.length) return 0;
    changedRows.sort(function (a, b) { return a - b; });
    var blockStart = 0;
    while (blockStart < changedRows.length) {
      var blockEnd = blockStart;
      while (blockEnd + 1 < changedRows.length && changedRows[blockEnd + 1] === changedRows[blockEnd] + 1) {
        blockEnd++;
      }
      var firstRow = changedRows[blockStart];
      var height = changedRows[blockEnd] - firstRow + 1;
      var block = [];
      for (var r = firstRow; r <= changedRows[blockEnd]; r++) {
        block.push(data[r - 1].slice(0, headers.length));
      }
      var tWrite = Date.now();
      sheet.getRange(firstRow, 1, height, headers.length).setValues(block);
      stats_.setValues++;
      if (typeof HrmsPerf !== 'undefined') {
        HrmsPerf.addStage('write', Date.now() - tWrite);
        HrmsPerf.count('setValues', sheetName);
      }
      blockStart = blockEnd + 1;
    }
    invalidateSheetData_(sheetName);
    return changedRows.length;
  }

  /**
   * Increment a numeric sequence stored in Settings.
   * Caller must already hold the script lock (avoids nested LockService).
   * @param {string} settingKey e.g. seq_employee
   * @return {number}
   */
  function nextSequenceAssumingLocked(settingKey) {
    ConfigService.clearSettingsCache();
    var row = findOne(HRMS.SHEETS.SETTINGS, { setting_key: settingKey });
    if (!row) {
      throw configurationError_('Missing settings sequence: ' + settingKey + '. Run database setup.');
    }
    var next = Number(row.setting_value) + 1;
    if (isNaN(next) || next < 1) {
      next = 1;
    }
    var actor = 'system';
    try {
      actor = Session.getActiveUser().getEmail().toLowerCase() || 'system';
    } catch (ignore) {}
    updateRecord(HRMS.SHEETS.SETTINGS, 'setting_key', settingKey, {
      setting_value: String(next),
      updated_at: new Date(),
      updated_by_email: actor
    });
    ConfigService.clearSettingsCache();
    return next;
  }

  /**
   * Increment a numeric sequence stored in Settings.
   * @param {string} settingKey e.g. seq_employee
   * @return {number}
   */
  function nextSequence(settingKey) {
    return withScriptLock_(function () {
      return nextSequenceAssumingLocked(settingKey);
    });
  }

  function formatEmployeeId_(seq) {
    var prefix = ConfigService.getSetting('employee_id_prefix', 'EMP');
    var pad = Number(ConfigService.getSetting('employee_id_pad', 3)) || 3;
    var num = String(seq);
    while (num.length < pad) num = '0' + num;
    return prefix + num;
  }

  function nextEmployeeId() {
    var seq = nextSequence('seq_employee');
    return formatEmployeeId_(seq);
  }

  /** Caller must already hold the script lock. */
  function nextEmployeeIdAssumingLocked() {
    var seq = nextSequenceAssumingLocked('seq_employee');
    return formatEmployeeId_(seq);
  }

  function generateId_(prefix) {
    var ts = Utilities.formatDate(new Date(), ConfigService.getTimezone(), 'yyyyMMddHHmmss');
    var rand = Math.floor(Math.random() * 10000);
    return prefix + '-' + ts + '-' + rand;
  }

  return {
    getAllRecords: getAllRecords,
    findRecords: findRecords,
    findOne: findOne,
    findRowNumber: findRowNumber,
    getRecordAtRow: getRecordAtRow,
    getProjectedRecords: getProjectedRecords,
    insertRecord: insertRecord,
    insertRecords: insertRecords,
    deleteRecords: deleteRecords,
    updateRecord: updateRecord,
    updateRecords: updateRecords,
    nextSequence: nextSequence,
    nextSequenceAssumingLocked: nextSequenceAssumingLocked,
    nextEmployeeId: nextEmployeeId,
    nextEmployeeIdAssumingLocked: nextEmployeeIdAssumingLocked,
    generateId: generateId_,
    invalidateSheetData: invalidateSheetData_,
    clearRequestCache: clearRequestCache_,
    getRequestCacheStatsForTests: function () {
      return {
        getSheetByName: stats_.getSheetByName,
        getDataRange: stats_.getDataRange,
        getLastRow: stats_.getLastRow,
        setValue: stats_.setValue,
        setValues: stats_.setValues,
        appendRow: stats_.appendRow,
        getColumn: stats_.getColumn,
        sheetsCached: Object.keys(sheetCache_).length,
        valuesCached: Object.keys(valuesCache_).length
      };
    }
  };
})();
