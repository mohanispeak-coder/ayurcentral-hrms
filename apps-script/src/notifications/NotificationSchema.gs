/**
 * Notification Center sheets — independent of SchemaService.
 * Existing `Notifications` sheet remains the email delivery log (02).
 *
 * Optional later registry (do not apply in this stream):
 *   HRMS.SHEETS.NOTIFICATION_INBOX = 'NotificationInbox';
 *   HRMS.SHEETS.NOTIFICATION_PREFERENCES = 'NotificationPreferences';
 *   SchemaService SHEET_HEADERS_ entries — see docs/NOTIFICATIONS_INTEGRATION_NOTES.md
 */
var HRMS = HRMS || {};

var NotificationSchema = (function () {
  var INBOX = 'NotificationInbox';
  var PREFS = 'NotificationPreferences';
  var EMAIL_LOG = (HRMS.SHEETS && HRMS.SHEETS.NOTIFICATIONS) || 'Notifications';

  var INBOX_HEADERS = [
    'notification_id', 'recipient_employee_id', 'recipient_email', 'type', 'title', 'message',
    'source_module', 'source_record_id', 'created_at', 'read_at', 'priority',
    'action_route', 'action_params', 'dedupe_key', 'status', 'actor_employee_id',
    'email_status', 'email_log_id'
  ];

  var PREF_HEADERS = [
    'preference_id', 'employee_id', 'notification_type', 'in_app_enabled', 'email_enabled', 'updated_at'
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
      return { sheet: sheet, created: created, headersAdded: headers.length };
    }
    var existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    var added = 0;
    for (var i = 0; i < headers.length; i++) {
      if (existing.indexOf(headers[i]) < 0) {
        var col = existing.length + 1;
        sheet.getRange(1, col).setValue(headers[i]).setFontWeight('bold');
        existing.push(headers[i]);
        added++;
      }
    }
    return { sheet: sheet, created: created, headersAdded: added };
  }

  /**
   * Create NotificationInbox / NotificationPreferences if missing.
   * Does not alter the email-log `Notifications` sheet.
   * @return {{ok:boolean, inbox:Object, preferences:Object}}
   */
  function ensureSheets() {
    var t0 = Date.now();
    var ss = ConfigService.openSpreadsheet();
    var inbox = ensureSheet_(ss, INBOX, INBOX_HEADERS);
    var prefs = ensureSheet_(ss, PREFS, PREF_HEADERS);
    if (typeof DbService !== 'undefined' && DbService.invalidateSheetData) {
      DbService.invalidateSheetData(INBOX);
      DbService.invalidateSheetData(PREFS);
    }
    if (typeof HrmsPerf !== 'undefined' && HrmsPerf.addStage) {
      HrmsPerf.addStage('ensure', Date.now() - t0);
    }
    return { ok: true, inbox: inbox, preferences: prefs };
  }

  function getSchemaInfo() {
    return {
      inbox: INBOX,
      preferences: PREFS,
      emailLog: EMAIL_LOG,
      inboxHeaders: INBOX_HEADERS.slice(),
      preferenceHeaders: PREF_HEADERS.slice(),
      dbServiceRegistry: [
        'NotificationInbox is read/written via DbService.getAllRecords / insertRecord / updateRecord (no extra API).',
        'Call NotificationSchema.ensureSheets() once per execution before first access, or register sheets in SchemaService.setupDatabase.'
      ]
    };
  }

  return {
    INBOX: INBOX,
    PREFS: PREFS,
    EMAIL_LOG: EMAIL_LOG,
    INBOX_HEADERS: INBOX_HEADERS,
    PREF_HEADERS: PREF_HEADERS,
    ensureSheets: ensureSheets,
    getSchemaInfo: getSchemaInfo
  };
})();
