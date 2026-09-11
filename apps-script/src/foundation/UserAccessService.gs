/**
 * Per-user self-service access flags (Admin-controlled checkboxes).
 * HR/ADMIN always have full access; flags apply to EMPLOYEE and MANAGER self-service.
 */
var HRMS = HRMS || {};

var UserAccessService = (function () {
  var ACCESS_COLUMNS_ = ['access_documents', 'access_payslips', 'access_leave'];

  function defaultFlags_() {
    return {
      access_documents: true,
      access_payslips: true,
      access_leave: true
    };
  }

  function parseFlag_(value, defaultValue) {
    if (value === null || value === undefined || value === '') return defaultValue;
    if (value === true || value === 1) return true;
    if (value === false || value === 0) return false;
    var s = String(value).trim().toUpperCase();
    if (s === 'TRUE' || s === 'YES' || s === 'Y' || s === '1') return true;
    if (s === 'FALSE' || s === 'NO' || s === 'N' || s === '0') return false;
    return defaultValue;
  }

  function flagsFromUser_(user) {
    var defaults = defaultFlags_();
    if (!user) return defaults;
    return {
      access_documents: parseFlag_(user.access_documents, defaults.access_documents),
      access_payslips: parseFlag_(user.access_payslips, defaults.access_payslips),
      access_leave: parseFlag_(user.access_leave, defaults.access_leave)
    };
  }

  function ensureColumns_() {
    var ss = ConfigService.openSpreadsheet();
    var sheet = ss.getSheetByName(HRMS.SHEETS.USERS);
    if (!sheet) return { added: [] };
    var lastCol = sheet.getLastColumn();
    var headers = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
    var added = [];
    ACCESS_COLUMNS_.forEach(function (col) {
      if (headers.indexOf(col) >= 0) return;
      var nextCol = sheet.getLastColumn() + 1;
      sheet.getRange(1, nextCol).setValue(col).setFontWeight('bold');
      var lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        var fill = [];
        for (var r = 2; r <= lastRow; r++) fill.push(['TRUE']);
        sheet.getRange(2, nextCol, lastRow, nextCol).setValues(fill);
      }
      added.push(col);
    });
    return { added: added };
  }

  function attachToSession_(session, user) {
    session.access = flagsFromUser_(user);
    return session;
  }

  function getFlagsForSession(session) {
    if (!session) return defaultFlags_();
    if (typeof PermissionService !== 'undefined' && PermissionService.isHrOrAdmin(session)) {
      return defaultFlags_();
    }
    return session.access || defaultFlags_();
  }

  function hasSelfServiceAccess(session, feature) {
    if (!session || !session.authorized) return false;
    if (typeof PermissionService !== 'undefined' && PermissionService.isHrOrAdmin(session)) {
      return true;
    }
    var flags = getFlagsForSession(session);
    if (feature === 'documents') return !!flags.access_documents;
    if (feature === 'payslips') return !!flags.access_payslips;
    if (feature === 'leave') return !!flags.access_leave;
    return false;
  }

  function requireSelfServiceAccess(session, feature) {
    if (!hasSelfServiceAccess(session, feature)) {
      throw authorizationError_('You do not have access to this feature. Contact your administrator.');
    }
  }

  function getEmployeeAccess(session, employeeId) {
    PermissionService.require(HRMS.ACTIONS.ADMIN_USERS, {}, session);
    var emp = EmployeeRepository.findById(employeeId);
    if (!emp) throw notFoundError_('Employee not found.');
    var user = EmployeeRepository.findUserByEmployeeId(employeeId);
    return {
      employee_id: employeeId,
      has_login: !!user,
      google_email: user ? user.google_email : '',
      role: user ? user.role : '',
      access: flagsFromUser_(user),
      defaults: defaultFlags_()
    };
  }

  function saveEmployeeAccess(session, employeeId, payload) {
    PermissionService.require(HRMS.ACTIONS.ADMIN_USERS, {}, session);
    payload = payload || {};
    var emp = EmployeeRepository.findById(employeeId);
    if (!emp) throw notFoundError_('Employee not found.');
    var user = EmployeeRepository.findUserByEmployeeId(employeeId);
    if (!user) {
      throw validationError_('This employee does not have a login yet. Create a user first.', {
        fields: { google_email: 'No Users row linked to this employee.' }
      });
    }
    ensureColumns_();
    var updates = {
      access_documents: parseFlag_(payload.access_documents, true) ? 'TRUE' : 'FALSE',
      access_payslips: parseFlag_(payload.access_payslips, true) ? 'TRUE' : 'FALSE',
      access_leave: parseFlag_(payload.access_leave, true) ? 'TRUE' : 'FALSE',
      updated_at: new Date()
    };
    EmployeeRepository.updateUser(user.google_email, updates);
    if (typeof AuthService !== 'undefined' && AuthService.invalidateIdentitySnapshots) {
      AuthService.invalidateIdentitySnapshots();
    }
    AuditService.log(
      'USER_ACCESS_UPDATE',
      'Users',
      user.google_email,
      'App access updated for ' + employeeId,
      employeeId
    );
    return getEmployeeAccess(session, employeeId);
  }

  function newUserAccessDefaults_() {
    return {
      access_documents: 'TRUE',
      access_payslips: 'TRUE',
      access_leave: 'TRUE'
    };
  }

  return {
    defaultFlags: defaultFlags_,
    flagsFromUser: flagsFromUser_,
    ensureColumns: ensureColumns_,
    attachToSession: attachToSession_,
    getFlagsForSession: getFlagsForSession,
    hasSelfServiceAccess: hasSelfServiceAccess,
    requireSelfServiceAccess: requireSelfServiceAccess,
    getEmployeeAccess: getEmployeeAccess,
    saveEmployeeAccess: saveEmployeeAccess,
    newUserAccessDefaults: newUserAccessDefaults_,
    parseFlag: parseFlag_
  };
})();
