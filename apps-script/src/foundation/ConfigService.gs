/**
 * Configuration — PropertiesService + Settings sheet.
 */
var HRMS = HRMS || {};

var ConfigService = (function () {
  var scriptProps_ = PropertiesService.getScriptProperties();

  /** Request-scoped spreadsheet handle — cleared when ID changes. */
  var spreadsheetCache_ = null;
  var spreadsheetCacheId_ = '';
  var openByIdCount_ = 0;

  function getScriptProperty(key) {
    return scriptProps_.getProperty(key) || '';
  }

  function setScriptProperty(key, value) {
    scriptProps_.setProperty(key, String(value));
  }

  function getSpreadsheetId() {
    var id = getScriptProperty(HRMS.PROPS.SPREADSHEET_ID);
    if (!id) {
      throw configurationError_('Spreadsheet ID is not set. Run database setup from the Apps Script editor or set HRMS_SPREADSHEET_ID.');
    }
    return id;
  }

  function clearSpreadsheetRequestCache_() {
    spreadsheetCache_ = null;
    spreadsheetCacheId_ = '';
  }

  function setSpreadsheetId(id) {
    setScriptProperty(HRMS.PROPS.SPREADSHEET_ID, id);
    clearSpreadsheetRequestCache_();
  }

  function getDriveRootFolderId() {
    return getScriptProperty(HRMS.PROPS.DRIVE_ROOT_FOLDER_ID) || '';
  }

  function setDriveRootFolderId(id) {
    setScriptProperty(HRMS.PROPS.DRIVE_ROOT_FOLDER_ID, id);
  }

  function openSpreadsheet() {
    var id = getSpreadsheetId();
    if (spreadsheetCache_ && spreadsheetCacheId_ === id) {
      return spreadsheetCache_;
    }
    var t0 = Date.now();
    spreadsheetCache_ = SpreadsheetApp.openById(id);
    spreadsheetCacheId_ = id;
    openByIdCount_++;
    var ms = Date.now() - t0;
    if (typeof HrmsPerf !== 'undefined') {
      HrmsPerf.log('openById', ms);
      if (HrmsPerf.addStage) HrmsPerf.addStage('openById', ms);
      if (HrmsPerf.count) HrmsPerf.count('openById');
    }
    return spreadsheetCache_;
  }

  function clearSettingsCache_() {
    CacheService.getScriptCache().remove(HRMS.CACHE.SETTINGS_KEY);
    if (typeof DbService !== 'undefined' && DbService.invalidateSheetData) {
      try {
        DbService.invalidateSheetData(HRMS.SHEETS.SETTINGS);
      } catch (ignore) {}
    }
  }

  /**
   * Load all settings from Settings sheet into a map (cached).
   * @return {Object.<string, {value: *, raw: string, type: string, adminOnly: boolean}>}
   */
  function loadSettingsMap_() {
    var cache = CacheService.getScriptCache();
    var cached = cache.get(HRMS.CACHE.SETTINGS_KEY);
    if (cached) {
      if (typeof HrmsPerf !== 'undefined' && HrmsPerf.count) {
        HrmsPerf.count('settingsCacheHit');
      }
      return JSON.parse(cached);
    }
    if (typeof HrmsPerf !== 'undefined' && HrmsPerf.count) {
      HrmsPerf.count('settingsCacheMiss');
    }
    var sheet = openSpreadsheet().getSheetByName(HRMS.SHEETS.SETTINGS);
    if (typeof HrmsPerf !== 'undefined' && HrmsPerf.count) {
      HrmsPerf.count('getSheetByName', HRMS.SHEETS.SETTINGS);
    }
    if (!sheet || sheet.getLastRow() < 2) {
      if (typeof HrmsPerf !== 'undefined' && HrmsPerf.count) {
        HrmsPerf.count('getLastRow', HRMS.SHEETS.SETTINGS);
      }
      return {};
    }
    if (typeof HrmsPerf !== 'undefined' && HrmsPerf.count) {
      HrmsPerf.count('getLastRow', HRMS.SHEETS.SETTINGS);
    }
    var tRead = Date.now();
    var rows = sheet.getDataRange().getValues();
    if (typeof HrmsPerf !== 'undefined') {
      HrmsPerf.addStage('getDataRange', Date.now() - tRead);
      HrmsPerf.count('getDataRange', HRMS.SHEETS.SETTINGS);
      HrmsPerf.count('getValues', HRMS.SHEETS.SETTINGS);
    }
    var headers = rows[0].map(String);
    var keyIdx = headers.indexOf('setting_key');
    var valIdx = headers.indexOf('setting_value');
    var typeIdx = headers.indexOf('value_type');
    var adminIdx = headers.indexOf('admin_only');
    var map = {};
    for (var i = 1; i < rows.length; i++) {
      var key = String(rows[i][keyIdx] || '').trim();
      if (!key) continue;
      var raw = rows[i][valIdx];
      var type = String(rows[i][typeIdx] || 'STRING').toUpperCase();
      var adminOnly = String(rows[i][adminIdx]).toUpperCase() === 'TRUE';
      map[key] = {
        raw: raw === null || raw === undefined ? '' : String(raw),
        value: coerceSettingValue_(raw, type),
        type: type,
        adminOnly: adminOnly
      };
    }
    // Avoid clobbering a fresher cache written by a concurrent Settings updater.
    if (!cache.get(HRMS.CACHE.SETTINGS_KEY)) {
      cache.put(HRMS.CACHE.SETTINGS_KEY, JSON.stringify(map), HRMS.CACHE.TTL_SECONDS);
    }
    return map;
  }

  function coerceSettingValue_(raw, type) {
    if (type === 'NUMBER') {
      var n = Number(raw);
      return isNaN(n) ? 0 : n;
    }
    if (type === 'BOOLEAN') {
      return String(raw).toUpperCase() === 'TRUE';
    }
    return raw === null || raw === undefined ? '' : String(raw);
  }

  function getSetting(key, defaultValue) {
    var map = loadSettingsMap_();
    if (map[key]) return map[key].value;
    return defaultValue !== undefined ? defaultValue : '';
  }

  function getCompanyName() {
    return getSetting('company_name', 'AyurCentral HRMS');
  }

  function getTimezone() {
    return getSetting('timezone', 'Asia/Kolkata');
  }

  function getCurrency() {
    return 'INR';
  }

  function normalizeAppMode_(mode) {
    var value = String(mode || '').trim().toUpperCase();
    return value === HRMS.APP_MODE.DEMO ? HRMS.APP_MODE.DEMO : HRMS.APP_MODE.PRODUCTION;
  }

  function normalizeEmail_(email) {
    return String(email || '').trim().toLowerCase();
  }

  function parseDemoEmailList_(raw) {
    var seen = {};
    var list = [];
    String(raw || '').split(/[,;\n]+/).forEach(function (part) {
      var email = normalizeEmail_(part);
      if (!email || seen[email]) return;
      seen[email] = true;
      list.push(email);
    });
    return list;
  }

  function parseDemoRoleMap_(raw) {
    var map = {};
    String(raw || '').split(/[,;\n]+/).forEach(function (part) {
      var pair = String(part || '').trim();
      if (!pair) return;
      var sep = pair.indexOf(':');
      if (sep < 0) return;
      var email = normalizeEmail_(pair.slice(0, sep));
      var role = String(pair.slice(sep + 1) || '').trim().toUpperCase();
      if (!email || !role) return;
      map[email] = role;
    });
    return map;
  }

  function isValidRole_(role) {
    return role === HRMS.ROLES.OWNER ||
      role === HRMS.ROLES.ADMIN ||
      role === HRMS.ROLES.HR ||
      role === HRMS.ROLES.MANAGER ||
      role === HRMS.ROLES.EMPLOYEE;
  }

  /**
   * Application mode — defaults to PRODUCTION when unset or unreadable.
   * @return {string} HRMS.APP_MODE value
   */
  function getAppMode() {
    try {
      return normalizeAppMode_(getSetting(HRMS.SETTINGS_KEYS.APP_MODE, HRMS.APP_MODE.PRODUCTION));
    } catch (e) {
      return HRMS.APP_MODE.PRODUCTION;
    }
  }

  function isDemoMode() {
    return getAppMode() === HRMS.APP_MODE.DEMO;
  }

  /**
   * @param {string} email Normalized or raw email.
   * @return {boolean}
   */
  function isDemoAllowlisted(email) {
    if (!isDemoMode()) return false;
    try {
      var allowlist = parseDemoEmailList_(getSetting(HRMS.SETTINGS_KEYS.DEMO_EMAILS, ''));
      return allowlist.indexOf(normalizeEmail_(email)) >= 0;
    } catch (e) {
      return false;
    }
  }

  /**
   * @param {string} email Normalized or raw email.
   * @return {string}
   */
  function getDemoRoleForEmail(email) {
    email = normalizeEmail_(email);
    try {
      var roleMap = parseDemoRoleMap_(getSetting(HRMS.SETTINGS_KEYS.DEMO_ROLES, ''));
      if (roleMap[email] && isValidRole_(roleMap[email])) {
        return roleMap[email];
      }
      var fallback = String(getSetting(HRMS.SETTINGS_KEYS.DEMO_DEFAULT_ROLE, HRMS.ROLES.ADMIN))
        .trim()
        .toUpperCase();
      return isValidRole_(fallback) ? fallback : HRMS.ROLES.ADMIN;
    } catch (e) {
      return HRMS.ROLES.ADMIN;
    }
  }

  return {
    getScriptProperty: getScriptProperty,
    setScriptProperty: setScriptProperty,
    getSpreadsheetId: getSpreadsheetId,
    setSpreadsheetId: setSpreadsheetId,
    getDriveRootFolderId: getDriveRootFolderId,
    setDriveRootFolderId: setDriveRootFolderId,
    openSpreadsheet: openSpreadsheet,
    clearSpreadsheetRequestCache: clearSpreadsheetRequestCache_,
    clearSettingsCache: clearSettingsCache_,
    getSetting: getSetting,
    getCompanyName: getCompanyName,
    getTimezone: getTimezone,
    getCurrency: getCurrency,
    loadSettingsMap: loadSettingsMap_,
    getAppMode: getAppMode,
    isDemoMode: isDemoMode,
    isDemoAllowlisted: isDemoAllowlisted,
    getDemoRoleForEmail: getDemoRoleForEmail,
    parseDemoEmailList: parseDemoEmailList_,
    parseDemoRoleMap: parseDemoRoleMap_,
    /** Test helper — openById calls this execution. */
    getOpenByIdCountForTests: function () { return openByIdCount_; },
    resetOpenByIdCountForTests: function () { openByIdCount_ = 0; }
  };
})();
