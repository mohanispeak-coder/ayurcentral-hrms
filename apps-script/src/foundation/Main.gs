/**
 * Web app entry point and HTML includes.
 */

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
 * Spreadsheet menu for administrators (optional convenience).
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('HRMS')
    .addItem('Run database setup', 'menuRunDatabaseSetup')
    .addItem('Run Drive setup', 'menuRunDriveSetup')
    .addItem('Ensure PMS sheets', 'menuEnsurePmsSchema')
    .addItem('Ensure ATS sheets', 'menuEnsureAtsSchema')
    .addItem('Ensure notification sheets', 'menuEnsureNotificationSchema')
    .addToUi();
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
