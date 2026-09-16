/**
 * Admin-editable organisation settings (Notifications sheet + Settings tab).
 * OWNER/ADMIN only — exposed via Settings UI.
 */
var HRMS = HRMS || {};

var AdminSettingsService = (function () {
  var EMAIL_KEYS_ = [
    { key: 'notification_leave', label: 'Leave notification emails', type: 'boolean' },
    { key: 'notification_payroll', label: 'Payroll notification emails', type: 'boolean' },
    { key: 'notification_employee_create', label: 'Email when a new employee is created', type: 'boolean' },
    { key: 'leave_decision_notify_employee', label: 'Leave approve/reject — email employee', type: 'boolean' },
    { key: 'leave_decision_notify_manager', label: 'Leave approve/reject — email manager', type: 'boolean' },
    { key: 'leave_decision_notify_additional_enabled', label: 'Leave approve/reject — extra recipient enabled', type: 'boolean' },
    { key: 'leave_decision_notify_additional_email', label: 'Leave approve/reject — extra recipient email', type: 'string' }
  ];

  /** Lazy — AdminSettingsService loads before Constants.gs in Apps Script file order. */
  function roleAccessRoles_() {
    return ['EMPLOYEE', 'MANAGER'];
  }

  var ROLE_ACCESS_FEATURES_ = [
    { id: 'documents', label: 'Download documents' },
    { id: 'payslips', label: 'Download payslips' },
    { id: 'leave', label: 'Leave apply and history' }
  ];

  function roleAccessKey_(role, feature) {
    return 'role_access_' + String(role).toUpperCase() + '_' + String(feature);
  }

  function parseBool_(value, defaultValue) {
    if (value === null || value === undefined || value === '') return defaultValue;
    if (value === true || value === 1) return true;
    if (value === false || value === 0) return false;
    var s = String(value).trim().toUpperCase();
    if (s === 'TRUE' || s === 'YES' || s === 'Y' || s === '1') return true;
    if (s === 'FALSE' || s === 'NO' || s === 'N' || s === '0') return false;
    return defaultValue;
  }

  function upsertSettingValue_(settingKey, value, session) {
    ConfigService.clearSettingsCache();
    var row = DbService.findOne(HRMS.SHEETS.SETTINGS, { setting_key: settingKey });
    if (!row) {
      throw configurationError_('Unknown setting key: ' + settingKey + '. Re-run database setup to seed Settings.');
    }
    var actor = (session && session.email) ? String(session.email).trim().toLowerCase() : 'system';
    DbService.updateRecord(HRMS.SHEETS.SETTINGS, 'setting_key', settingKey, {
      setting_value: String(value),
      updated_at: new Date(),
      updated_by_email: actor
    });
    ConfigService.clearSettingsCache();
  }

  function readEmailSettings_() {
    return EMAIL_KEYS_.map(function (def) {
      var raw = ConfigService.getSetting(def.key, def.type === 'boolean' ? true : '');
      var value = def.type === 'boolean' ? parseBool_(raw, true) : String(raw || '');
      return {
        key: def.key,
        label: def.label,
        type: def.type,
        value: value
      };
    });
  }

  function readRoleAccessMatrix_() {
    var matrix = [];
    ROLE_ACCESS_ROLES_.forEach(function (role) {
      var row = { role: role, flags: {} };
      ROLE_ACCESS_FEATURES_.forEach(function (feat) {
        var key = roleAccessKey_(role, feat.id);
        row.flags[feat.id] = parseBool_(ConfigService.getSetting(key, true), true);
      });
      matrix.push(row);
    });
    return {
      roles: ROLE_ACCESS_ROLES_,
      features: ROLE_ACCESS_FEATURES_,
      matrix: matrix
    };
  }

  function getSettings(session) {
    PermissionService.require(HRMS.ACTIONS.ADMIN_SETTINGS, {}, session);
    return {
      email: readEmailSettings_(),
      role_access: readRoleAccessMatrix_()
    };
  }

  function saveSettings(session, payload) {
    PermissionService.require(HRMS.ACTIONS.ADMIN_SETTINGS, {}, session);
    payload = payload || {};
    var email = payload.email || {};
    EMAIL_KEYS_.forEach(function (def) {
      if (!email.hasOwnProperty(def.key)) return;
      var val = email[def.key];
      if (def.type === 'boolean') {
        upsertSettingValue_(def.key, parseBool_(val, true) ? 'true' : 'false', session);
      } else {
        upsertSettingValue_(def.key, String(val || '').trim(), session);
      }
    });
    var roleAccess = payload.role_access || {};
    ROLE_ACCESS_ROLES_.forEach(function (role) {
      var patch = roleAccess[role] || roleAccess[String(role).toUpperCase()];
      if (!patch) return;
      ROLE_ACCESS_FEATURES_.forEach(function (feat) {
        if (!patch.hasOwnProperty(feat.id)) return;
        var key = roleAccessKey_(role, feat.id);
        upsertSettingValue_(key, parseBool_(patch[feat.id], true) ? 'true' : 'false', session);
      });
    });
    AuditService.log('ADMIN_SETTINGS_SAVE', 'Settings', 'org', 'Updated organisation settings', session.employee_id || '');
    return getSettings(session);
  }

  function roleAccessDefaultsForRole_(role) {
    role = String(role || HRMS.ROLES.EMPLOYEE).toUpperCase();
    if (ROLE_ACCESS_ROLES_.indexOf(role) < 0) {
      return UserAccessService.defaultFlags();
    }
    return {
      access_documents: parseBool_(ConfigService.getSetting(roleAccessKey_(role, 'documents'), true), true),
      access_payslips: parseBool_(ConfigService.getSetting(roleAccessKey_(role, 'payslips'), true), true),
      access_leave: parseBool_(ConfigService.getSetting(roleAccessKey_(role, 'leave'), true), true)
    };
  }

  return {
    getSettings: getSettings,
    saveSettings: saveSettings,
    roleAccessDefaultsForRole: roleAccessDefaultsForRole_
  };
})();
