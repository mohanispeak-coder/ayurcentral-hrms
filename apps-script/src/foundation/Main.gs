/**
 * Web app entry point and HTML includes.
 */

/**
 * Telegram Bot API webhook (same web app /exec URL). Run installTelegramWebhook after deploy.
 */
function doPost(e) {
  try {
    if (e && e.postData && e.postData.contents && typeof TelegramLinkService !== 'undefined') {
      var body = JSON.parse(e.postData.contents);
      if (body && body.update_id != null) {
        TelegramLinkService.processUpdate(body);
        return ContentService.createTextOutput('ok');
      }
    }
  } catch (ignore) {}
  return ContentService.createTextOutput('ok');
}

function doGet(e) {
  if (typeof AtsWeb !== 'undefined') {
    var atsOut = AtsWeb.tryServe(e);
    if (atsOut) return atsOut;
  }
  var t0 = Date.now();
  // Shell only — module UI is lazy-loaded via apiGetModuleUi after first paint.
  var template = HtmlService.createTemplateFromFile('ui/Index');
  var output = template
    .evaluate()
    .setTitle('AyurCentral HRMS')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  HrmsPerf.log('doGet', Date.now() - t0);
  return output;
}

/**
 * Include HTML partials: <?!= include('ui/Styles'); ?>
 * @param {string} filename
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Spreadsheet menu (bound script: onOpen; standalone: installHrmsSpreadsheetOpenTrigger).
 */
function buildHrmsSpreadsheetMenu_(ui) {
  ui.createMenu('HRMS')
    .addItem('Run database setup', 'menuRunDatabaseSetup')
    .addItem('Run Drive setup', 'menuRunDriveSetup')
    .addItem('Ensure ATS sheets', 'menuEnsureAtsSchema')
    .addItem('Ensure notification sheets', 'menuEnsureNotificationSchema')
    .addSeparator()
    .addItem('Install Telegram webhook', 'menuInstallTelegramWebhook')
    .addToUi();
}

function menuInstallTelegramWebhook() {
  try {
    var session = AuthService.requireAuth();
    if (!PermissionService.can(HRMS.ACTIONS.ADMIN_SETTINGS, {}, session)) {
      SpreadsheetApp.getUi().alert('Admin/HR settings permission required.');
      return;
    }
    if (typeof TelegramLinkService === 'undefined') {
      SpreadsheetApp.getUi().alert('TelegramLinkService not loaded. Push latest script.');
      return;
    }
    var result = TelegramLinkService.installWebhook();
    SpreadsheetApp.getUi().alert('Telegram webhook installed.\n' + result.url);
  } catch (err) {
    SpreadsheetApp.getUi().alert('Webhook install failed:\n' + (err.message || err));
  }
}

function installTelegramWebhookFromEditor() {
  return TelegramLinkService.installWebhook();
}

/** Bound spreadsheet only — not fired when HRMS uses HRMS_SPREADSHEET_ID + standalone script. */
function onOpen() {
  buildHrmsSpreadsheetMenu_(SpreadsheetApp.getUi());
}

/** Installable onOpen for the HRMS database spreadsheet (standalone deployments). */
function onOpenHrmsSpreadsheet_(e) {
  try {
    buildHrmsSpreadsheetMenu_(SpreadsheetApp.getActiveSpreadsheet().getUi());
  } catch (err) {
    Logger.log('HRMS spreadsheet menu: ' + (err.message || err));
  }
}

/**
 * Run once from Apps Script editor after clasp push.
 * Adds HRMS menu every time you open AyurCentral HRMS Database.
 */
function installHrmsSpreadsheetOpenTrigger() {
  var spreadsheetId = ConfigService.getSpreadsheetId();
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'onOpenHrmsSpreadsheet_' &&
        trigger.getEventType() === ScriptApp.EventType.ON_OPEN) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger('onOpenHrmsSpreadsheet_')
    .forSpreadsheet(spreadsheetId)
    .onOpen()
    .create();
  return {
    ok: true,
    spreadsheetId: spreadsheetId,
    message: 'Trigger installed. Close and reopen the HRMS spreadsheet, or run showHrmsSpreadsheetMenuNow.'
  };
}

/** Immediate menu on the linked spreadsheet (run from editor while sheet may be open). */
function showHrmsSpreadsheetMenuNow() {
  var ss = ConfigService.openSpreadsheet();
  buildHrmsSpreadsheetMenu_(ss.getUi());
  return { ok: true, spreadsheetId: ss.getId() };
}

/** Editor shortcut — same as apiRunDatabaseSetup with no spreadsheet id. */
function runDatabaseSetupFromEditor() {
  return apiRunDatabaseSetup('');
}

function menuRunDatabaseSetup() {
  var users = [];
  try {
    if (ConfigService.getScriptProperty(HRMS.PROPS.SPREADSHEET_ID)) {
      users = DbService.getAllRecords(HRMS.SHEETS.USERS);
    }
  } catch (ignore) {}
  if (users.length > 0) {
    var session = AuthService.requireAuth();
    if (!PermissionService.can(HRMS.ACTIONS.RUN_SETUP, {}, session)) {
      SpreadsheetApp.getUi().alert('Admin permission required.');
      return;
    }
  }
  var packed = withScriptLock_(function () {
    var result = SchemaService.setupDatabase('');
    SchemaService.ensureModuleSheets && SchemaService.ensureModuleSheets();
    var boot = AuthService.bootstrapFirstAdminIfEmpty({ alreadyLocked: true });
    return { result: result, boot: boot };
  });
  SpreadsheetApp.getUi().alert(
    'Database setup complete.\nSpreadsheet: ' + packed.result.spreadsheetId +
    (packed.boot ? '\nFirst admin: ' + packed.boot.google_email : '')
  );
}

function menuRunDriveSetup() {
  var session = AuthService.requireAuth();
  if (!PermissionService.can(HRMS.ACTIONS.RUN_SETUP, {}, session)) {
    SpreadsheetApp.getUi().alert('Admin permission required.');
    return;
  }
  var result = DriveService.setupRootStructure();
  AuditService.log('DRIVE_SETUP', 'Drive', result.rootFolderId, 'Drive setup from menu', session.employee_id);
  SpreadsheetApp.getUi().alert('Drive root: ' + result.rootFolderId);
}
