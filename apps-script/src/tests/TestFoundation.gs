/**
 * Foundation tests — run from Apps Script editor after setup.
 * Does not replace full 11_TEST_PLAN.md coverage.
 */

function testFoundation_All() {
  var results = [];
  function record(name, passed, detail, skipped) {
    results.push({ name: name, passed: passed, detail: detail || '', skipped: !!skipped });
    Logger.log((skipped ? 'SKIP' : passed ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ': ' + detail : ''));
  }

  record('schemaSheetCount', SchemaService.getSchemaInfo().sheets.length === 14, 'count=' + SchemaService.getSchemaInfo().sheets.length);

  record('schemaSettingsKeys', SchemaService.getSchemaInfo().settingsKeys.length >= 15, 'keys=' + SchemaService.getSchemaInfo().settingsKeys.length);

  try {
    withScriptLock_(function () {});
    record('lockUtil', true);
  } catch (e) {
    record('lockUtil', false, e.message);
  }

  record('errorTypes', !!HRMS.ERROR_CODES.AUTHORIZATION && !!HRMS.ERROR_CODES.VALIDATION);

  record('rolesDefined', HRMS.ROLES.ADMIN === 'ADMIN' && HRMS.ROLES.HR === 'HR');

  try {
    var email = AuthService.getSessionEmail();
    record('sessionEmail', typeof email === 'string', email || '(empty — expected in editor without deploy)');
  } catch (e) {
    record('sessionEmail', false, e.message);
  }

  var session = AuthService.resolveSession();
  record('resolveSessionShape', typeof session === 'object' && session.hasOwnProperty('authorized'), session.reason || 'ok');

  var spreadsheetConfigured = !!ConfigService.getScriptProperty(HRMS.PROPS.SPREADSHEET_ID);

  if (spreadsheetConfigured) {
    try {
      var employees = DbService.getAllRecords(HRMS.SHEETS.EMPLOYEES);
      record('dbRead', Array.isArray(employees), 'rows=' + employees.length);
    } catch (e) {
      record('dbRead', false, e.message);
    }

    try {
      var company = ConfigService.getCompanyName();
      record('configLoad', !!company, company);
    } catch (e) {
      record('configLoad', false, e.message);
    }

    try {
      var usersSheet = ConfigService.openSpreadsheet().getSheetByName(HRMS.SHEETS.USERS);
      var userHeaders = usersSheet.getRange(1, 1, 1, usersSheet.getLastColumn()).getValues()[0];
      record('usersHeaders', userHeaders[0] === 'google_email' && userHeaders.indexOf('employee_id') >= 0,
        userHeaders.join(','));
    } catch (e) {
      record('usersHeaders', false, e.message);
    }

    if (session.authorized) {
      record('permissionAccess', PermissionService.can(HRMS.ACTIONS.ACCESS_APP, {}, session));
      record('permissionAdmin', PermissionService.can(HRMS.ACTIONS.RUN_SETUP, {}, session) === (session.role === 'ADMIN'));
      record('permissionEmployeeNoAdmin', session.role === 'EMPLOYEE'
        ? !PermissionService.can(HRMS.ACTIONS.RUN_SETUP, {}, session)
        : true, session.role);
      record('userEmployeeRoleChain',
        !!session.employee_id && !!session.role,
        session.employee_id + ' / ' + session.role);
      try {
        AuditService.log('FOUNDATION_TEST', 'System', 'self-test', 'Automated foundation test');
        record('auditWrite', true);
      } catch (e) {
        record('auditWrite', false, e.message);
      }
    } else {
      record('authChain', true, 'Not authorized: ' + (session.reason || 'unknown'), true);
    }

    var driveId = ConfigService.getDriveRootFolderId() || ConfigService.getSetting('drive_root_folder_id', '');
    if (driveId) {
      try {
        DriveService.verifyAccess();
        record('driveAccess', true);
      } catch (e) {
        record('driveAccess', false, e.message);
      }
    } else {
      record('driveAccess', true, 'Drive not configured yet', true);
    }
  } else {
    record('dbConfigured', true, 'Run apiRunDatabaseSetup first', true);
    record('driveAccess', true, 'Requires database first', true);
  }

  record('navAdminCount', PermissionService.getNavForRole('ADMIN').length >= 10, 'items=' + PermissionService.getNavForRole('ADMIN').length);
  record('navManagerHasTeam', PermissionService.getNavForRole('MANAGER').some(function (n) { return n.id === 'my-team'; }));
  record('navEmployeeNoEmployees', !PermissionService.getNavForRole('EMPLOYEE').some(function (n) { return n.id === 'employees'; }));

  // Request-scoped DB cache: second read of same sheet must not re-fetch getDataRange.
  if (spreadsheetConfigured) {
    try {
      DbService.clearRequestCache();
      ConfigService.resetOpenByIdCountForTests();
      ConfigService.clearSpreadsheetRequestCache();
      DbService.findOne(HRMS.SHEETS.USERS, { google_email: '__cache_probe_a__' });
      var afterFirst = DbService.getRequestCacheStatsForTests();
      var opensAfterFirst = ConfigService.getOpenByIdCountForTests();
      DbService.findOne(HRMS.SHEETS.USERS, { google_email: '__cache_probe_b__' });
      var afterSecond = DbService.getRequestCacheStatsForTests();
      var opensAfterSecond = ConfigService.getOpenByIdCountForTests();
      record('dbRequestCacheOpenByIdOnce',
        opensAfterFirst === 1 && opensAfterSecond === 1,
        'opens=' + opensAfterSecond);
      record('dbTargetedFindOneNoFullSheet',
        afterFirst.getDataRange === 0 && afterSecond.getDataRange === 0,
        'getDataRange=' + afterSecond.getDataRange);
      record('dbTargetedFindOneColumnReuse',
        afterFirst.getColumn >= 1 && afterSecond.getColumn === afterFirst.getColumn,
        'getColumn first=' + afterFirst.getColumn + ' second=' + afterSecond.getColumn);
    } catch (e) {
      record('dbRequestCacheOpenByIdOnce', false, e.message);
      record('dbRequestCacheDataRangeOnce', false, e.message);
    }
  }

  // Module UI allowlist for lazy load.
  record('moduleUiEmployeeFiles',
    HRMS_MODULE_UI_FILES_ && HRMS_MODULE_UI_FILES_.employee && HRMS_MODULE_UI_FILES_.employee.length === 2);
  record('moduleUiLeaveFiles',
    HRMS_MODULE_UI_FILES_ && HRMS_MODULE_UI_FILES_.leave && HRMS_MODULE_UI_FILES_.leave.length === 2);
  record('moduleUiPayrollFiles',
    HRMS_MODULE_UI_FILES_ && HRMS_MODULE_UI_FILES_.payroll && HRMS_MODULE_UI_FILES_.payroll.length === 1);

  var failed = results.filter(function (r) { return !r.passed && !r.skipped; });
  Logger.log('Foundation tests: ' + (results.length - failed.length) + '/' + results.length + ' passed (' + failed.length + ' failed)');
  return { results: results, allPassed: failed.length === 0, failedCount: failed.length };
}

/** Static checks that do not need spreadsheet access. */
function testFoundation_Static() {
  var info = SchemaService.getSchemaInfo();
  var expectedSheets = [
    'Employees', 'Users', 'LeaveTypes', 'LeaveBalances', 'LeaveRequests',
    'SalaryStructures', 'SalaryComponents', 'PayrollRuns', 'PayrollInputs',
    'PayrollRecords', 'Notifications', 'AuditLog', 'Settings', 'Documents'
  ];
  var missing = expectedSheets.filter(function (s) { return info.sheets.indexOf(s) < 0; });
  if (missing.length) {
    throw new Error('Missing sheets in schema: ' + missing.join(', '));
  }
  return { ok: true, sheetCount: info.sheets.length };
}
