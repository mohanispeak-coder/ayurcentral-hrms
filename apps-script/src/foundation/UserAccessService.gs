/**
 * Per-user self-service access flags (Admin-controlled checkboxes).
 * HR/ADMIN always have full access; flags apply to EMPLOYEE and MANAGER self-service.
 */
var HRMS = HRMS || {};

var UserAccessService = (function () {
  var ACCESS_COLUMNS_ = ['access_documents', 'access_payslips', 'access_leave'];
  var ASSIGNABLE_ROLES_ = [
    HRMS.ROLES.EMPLOYEE,
    HRMS.ROLES.MANAGER,
    HRMS.ROLES.HR,
    HRMS.ROLES.ADMIN
  ];

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

  function roleDefaults_(role) {
    if (typeof AdminSettingsService !== 'undefined' && AdminSettingsService.roleAccessDefaultsForRole) {
      return AdminSettingsService.roleAccessDefaultsForRole(role);
    }
    return defaultFlags_();
  }

  function flagsFromUser_(user) {
    var role = user && user.role ? String(user.role).toUpperCase() : HRMS.ROLES.EMPLOYEE;
    var defaults = roleDefaults_(role);
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

  function isOwnerRole_(role) {
    return String(role || '').trim().toUpperCase() === HRMS.ROLES.OWNER;
  }

  function requireEmployeeAccessEditor_(session, employeeId) {
    if (!PermissionService.isHrOrAdmin(session)) {
      throw authorizationError_('You do not have permission to manage employee login settings.');
    }
    if (session.employee_id && String(session.employee_id) === String(employeeId)) {
      throw authorizationError_('You cannot edit your own login and role settings.');
    }
  }

  function canEditRoleForUser_(session, user) {
    if (!PermissionService.isAdmin(session) || !user) return false;
    if (isOwnerRole_(user.role)) return false;
    if (session.employee_id && user.employee_id &&
        String(session.employee_id) === String(user.employee_id)) {
      return false;
    }
    var sessionEmail = String(session.email || '').trim().toLowerCase();
    var userEmail = String(user.google_email || '').trim().toLowerCase();
    if (sessionEmail && userEmail && sessionEmail === userEmail) return false;
    return true;
  }

  function employeeAccessDto_(session, employeeId, user) {
    var welcomeMeta = (typeof EmployeeWelcomeService !== 'undefined' && EmployeeWelcomeService.statusForClient)
      ? EmployeeWelcomeService.statusForClient()
      : {};
    return {
      employee_id: employeeId,
      has_login: !!user,
      google_email: user ? user.google_email : '',
      role: user ? user.role : '',
      access: flagsFromUser_(user),
      defaults: defaultFlags_(),
      can_edit_role: canEditRoleForUser_(session, user),
      assignable_roles: ASSIGNABLE_ROLES_.slice(),
      role_is_owner: user ? isOwnerRole_(user.role) : false,
      can_send_welcome: true,
      welcome: welcomeMeta
    };
  }

  function getEmployeeAccess(session, employeeId) {
    requireEmployeeAccessEditor_(session, employeeId);
    var emp = EmployeeRepository.findById(employeeId);
    if (!emp) throw notFoundError_('Employee not found.');
    var user = EmployeeRepository.findUserByEmployeeId(employeeId);
    return employeeAccessDto_(session, employeeId, user);
  }

  function saveEmployeeAccess(session, employeeId, payload) {
    requireEmployeeAccessEditor_(session, employeeId);
    payload = payload || {};
    var emp = EmployeeRepository.findById(employeeId);
    if (!emp) throw notFoundError_('Employee not found.');
    var user = EmployeeRepository.findUserByEmployeeId(employeeId);
    if (!user) {
      throw validationError_('This employee does not have a login yet. Create a user first.', {
        fields: { google_email: 'No Users row linked to this employee.' }
      });
    }
    if (isOwnerRole_(user.role)) {
      throw authorizationError_('Owner login settings cannot be changed here.');
    }
    ensureColumns_();
    var updates = {
      access_documents: parseFlag_(payload.access_documents, true) ? 'TRUE' : 'FALSE',
      access_payslips: parseFlag_(payload.access_payslips, true) ? 'TRUE' : 'FALSE',
      access_leave: parseFlag_(payload.access_leave, true) ? 'TRUE' : 'FALSE',
      updated_at: new Date()
    };
    var previousRole = String(user.role || '').trim().toUpperCase();
    var roleChanged = false;
    if (payload.role !== undefined && payload.role !== null && String(payload.role).trim() !== '') {
      if (PermissionService.isAdmin(session)) {
        if (!canEditRoleForUser_(session, user)) {
          throw authorizationError_('You cannot change this user\'s HRMS role.');
        }
        var newRole = String(payload.role).trim().toUpperCase();
        if (ASSIGNABLE_ROLES_.indexOf(newRole) < 0) {
          throw validationError_('Invalid role.', { fields: { role: 'Choose EMPLOYEE, MANAGER, HR, or ADMIN.' } });
        }
        if (newRole !== previousRole) {
          updates.role = newRole;
          roleChanged = true;
        }
      }
    }
    EmployeeRepository.updateUser(user.google_email, updates);
    if (typeof AuthService !== 'undefined' && AuthService.invalidateIdentitySnapshots) {
      AuthService.invalidateIdentitySnapshots();
    }
    if (roleChanged) {
      AuditService.log(
        'USER_ROLE_UPDATE',
        'Users',
        user.google_email,
        'Role changed from ' + previousRole + ' to ' + updates.role + ' for ' + employeeId,
        employeeId
      );
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

  function newUserAccessDefaults_(role) {
    var flags = roleDefaults_(role || HRMS.ROLES.EMPLOYEE);
    return {
      access_documents: flags.access_documents ? 'TRUE' : 'FALSE',
      access_payslips: flags.access_payslips ? 'TRUE' : 'FALSE',
      access_leave: flags.access_leave ? 'TRUE' : 'FALSE'
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
