/**
 * Admin-editable organisation settings (Notifications sheet + Settings tab).
 * OWNER/ADMIN/HR - exposed via Settings UI (Users route remains Admin-only).
 */
var HRMS = HRMS || {};

var AdminSettingsService = (function () {
  var EMAIL_KEYS_ = [
    { key: 'notification_leave', label: 'Leave notification emails', type: 'boolean' },
    { key: 'notification_payroll', label: 'Payroll notification emails', type: 'boolean' },
    { key: 'notification_employee_create', label: 'Email when a new employee is created', type: 'boolean' },
    { key: 'notification_employee_welcome', label: 'Welcome email to new employee (when login is created)', type: 'boolean' },
    { key: 'hrms_webapp_url', label: 'HRMS web app URL for welcome emails', type: 'string' },
    { key: 'leave_decision_notify_employee', label: 'Leave approve/reject - email employee', type: 'boolean' },
    { key: 'leave_decision_notify_manager', label: 'Leave approve/reject - email manager', type: 'boolean' },
    { key: 'leave_decision_notify_additional_enabled', label: 'Leave approve/reject - extra recipient enabled', type: 'boolean' },
    { key: 'leave_decision_notify_additional_email', label: 'Leave approve/reject - extra recipient email', type: 'string' }
  ];

  /** Lazy - AdminSettingsService loads before Constants.gs in Apps Script file order. */
  function roleAccessRoles_() {
    return ['EMPLOYEE', 'MANAGER', 'HR', 'ADMIN'];
  }

  var ROLE_ACCESS_FEATURES_ = [
    { id: 'documents', label: 'Download documents' },
    { id: 'upload_documents', label: 'Upload documents' },
    { id: 'payslips', label: 'Download payslips' },
    { id: 'leave', label: 'Leave apply and history' }
  ];

  /** Which HRMS areas each role may use (sidebar + APIs). OWNER is always full access. */
  var ROLE_MODULE_ROLES_ = ['EMPLOYEE', 'MANAGER', 'HR', 'ADMIN'];
  var ROLE_MODULE_ITEMS_ = [
    { id: 'dashboard', label: 'Dashboard', navIds: ['dashboard'], defaultRoles: ['EMPLOYEE', 'MANAGER', 'HR', 'ADMIN'] },
    { id: 'my_profile', label: 'My profile', navIds: ['my-profile'], defaultRoles: ['EMPLOYEE', 'MANAGER', 'HR', 'ADMIN'] },
    { id: 'employees', label: 'Employees', navIds: ['employees'], defaultRoles: ['HR', 'ADMIN'] },
    { id: 'my_team', label: 'My team', navIds: ['my-team'], defaultRoles: ['MANAGER'] },
    { id: 'leave_admin', label: 'Leave administration', navIds: ['leave-admin'], defaultRoles: ['HR', 'ADMIN'] },
    { id: 'leave_approvals', label: 'Leave approvals', navIds: ['leave-approvals'], defaultRoles: ['MANAGER', 'HR', 'ADMIN'] },
    { id: 'my_leave', label: 'My leave', navIds: ['my-leave', 'leave-apply', 'leave-calendar'], defaultRoles: ['EMPLOYEE', 'MANAGER', 'HR', 'ADMIN'] },
    { id: 'attendance', label: 'Attendance', navIds: ['attendance-bulk-upload', 'attendance-form-t'], defaultRoles: ['HR', 'ADMIN'] },
    { id: 'payroll', label: 'Payroll', navIds: ['salary-structure', 'salary-statement', 'payroll', 'payroll-run', 'compensation'], defaultRoles: ['HR', 'ADMIN'] },
    { id: 'my_payslips', label: 'My payslips', navIds: ['my-payslips'], defaultRoles: ['EMPLOYEE', 'MANAGER', 'HR', 'ADMIN'] },
    { id: 'ats', label: 'Recruitment (ATS)', navIds: ['ats', 'ats-jobs', 'ats-job', 'ats-job-new', 'ats-job-edit', 'ats-candidates', 'ats-candidate'], defaultRoles: ['MANAGER', 'HR', 'ADMIN'] },
    { id: 'notifications', label: 'Notifications', navIds: ['notifications'], defaultRoles: ['HR', 'ADMIN'] },
    { id: 'settings', label: 'Settings / users', navIds: ['settings', 'users'], defaultRoles: ['HR', 'ADMIN'] }
  ];

  var ACTION_MODULE_MAP_ = {
    EMPLOYEE_DIRECTORY: 'employees',
    EMPLOYEE_CREATE: 'employees',
    EMPLOYEE_STATUS: 'employees',
    LEAVE_ADMIN: 'leave_admin',
    LEAVE_APPROVE: 'leave_approvals',
    LEAVE_APPLY: 'my_leave',
    PAYROLL_RUN: 'payroll',
    ATTENDANCE_MANAGE: 'attendance',
    COMPENSATION_MANAGE: 'payroll',
    VIEW_OWN_PAYSLIP: 'my_payslips',
    ATS_ACCESS: 'ats',
    ATS_MANAGE: 'ats',
    ADMIN_SETTINGS: 'settings',
    ADMIN_USERS: 'settings',
    VIEW_AUDIT: 'notifications',
    ASK_HR: 'dashboard'
  };

  function roleAccessKey_(role, feature) {
    return 'role_access_' + String(role).toUpperCase() + '_' + String(feature);
  }

  function roleModuleKey_(role, moduleId) {
    return 'role_module_' + String(role).toUpperCase() + '_' + String(moduleId);
  }

  function findModuleDef_(moduleId) {
    var id = String(moduleId || '');
    for (var i = 0; i < ROLE_MODULE_ITEMS_.length; i++) {
      if (ROLE_MODULE_ITEMS_[i].id === id) return ROLE_MODULE_ITEMS_[i];
    }
    return null;
  }

  function defaultModuleEnabled_(role, moduleDef) {
    role = String(role || '').toUpperCase();
    return moduleDef.defaultRoles.indexOf(role) >= 0;
  }

  function ensureDefaultSettingsSeeded_() {
    if (typeof SchemaService !== 'undefined' && SchemaService.seedMissingDefaultSettings) {
      return SchemaService.seedMissingDefaultSettings();
    }
    return { inserted: 0 };
  }

  function ensureRoleModuleSettingsSeeded_() {
    var ss = ConfigService.openSpreadsheet();
    var sheet = ss.getSheetByName(HRMS.SHEETS.SETTINGS);
    if (!sheet) return { inserted: 0 };
    var existing = {};
    if (sheet.getLastRow() >= 2) {
      var data = sheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        var k = String(data[i][0] || '').trim();
        if (k) existing[k] = true;
      }
    }
    var now = new Date();
    var actor = 'system';
    var inserted = 0;
    ROLE_MODULE_ROLES_.forEach(function (role) {
      ROLE_MODULE_ITEMS_.forEach(function (mod) {
        var key = roleModuleKey_(role, mod.id);
        if (existing[key]) return;
        var val = defaultModuleEnabled_(role, mod) ? 'true' : 'false';
        sheet.appendRow([key, val, 'BOOLEAN', 'Role module: ' + role + ' → ' + mod.label, false, now, actor]);
        existing[key] = true;
        inserted++;
      });
    });
    if (inserted) ConfigService.clearSettingsCache();
    return { inserted: inserted };
  }

  function isModuleEnabledForRole_(role, moduleId) {
    role = String(role || '').toUpperCase();
    if (role === 'OWNER') return true;
    var mod = findModuleDef_(moduleId);
    if (!mod) return true;
    var key = roleModuleKey_(role, moduleId);
    var raw = ConfigService.getSetting(key, null);
    if (raw === null || raw === '') return defaultModuleEnabled_(role, mod);
    return parseBool_(raw, defaultModuleEnabled_(role, mod));
  }

  function isNavAllowedForRole_(role, navItemId) {
    role = String(role || '').toUpperCase();
    if (role === 'OWNER') return true;
    var navId = String(navItemId || '');
    for (var i = 0; i < ROLE_MODULE_ITEMS_.length; i++) {
      var m = ROLE_MODULE_ITEMS_[i];
      if (m.navIds.indexOf(navId) >= 0) return isModuleEnabledForRole_(role, m.id);
    }
    return true;
  }

  function isActionAllowedForRole_(role, action) {
    role = String(role || '').toUpperCase();
    if (role === 'OWNER') return true;
    var mod = ACTION_MODULE_MAP_[action];
    if (!mod) return true;
    return isModuleEnabledForRole_(role, mod);
  }

  function readRoleModuleMatrix_() {
    var matrix = [];
    ROLE_MODULE_ROLES_.forEach(function (role) {
      var row = { role: role, modules: {} };
      ROLE_MODULE_ITEMS_.forEach(function (mod) {
        row.modules[mod.id] = isModuleEnabledForRole_(role, mod.id);
      });
      matrix.push(row);
    });
    return {
      roles: ROLE_MODULE_ROLES_,
      modules: ROLE_MODULE_ITEMS_.map(function (m) { return { id: m.id, label: m.label }; }),
      matrix: matrix
    };
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
      ensureDefaultSettingsSeeded_();
      ensureRoleModuleSettingsSeeded_();
      row = DbService.findOne(HRMS.SHEETS.SETTINGS, { setting_key: settingKey });
    }
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
    roleAccessRoles_().forEach(function (role) {
      var row = { role: role, flags: {} };
      ROLE_ACCESS_FEATURES_.forEach(function (feat) {
        var key = roleAccessKey_(role, feat.id);
        row.flags[feat.id] = parseBool_(ConfigService.getSetting(key, true), true);
      });
      matrix.push(row);
    });
    return {
      roles: roleAccessRoles_(),
      features: ROLE_ACCESS_FEATURES_,
      matrix: matrix
    };
  }

  function getSettings(session) {
    PermissionService.require(HRMS.ACTIONS.ADMIN_SETTINGS, {}, session);
    ensureDefaultSettingsSeeded_();
    ensureRoleModuleSettingsSeeded_();
    var welcome = (typeof EmployeeWelcomeService !== 'undefined' && EmployeeWelcomeService.statusForClient)
      ? EmployeeWelcomeService.statusForClient()
      : {};
    if (typeof HrmsContentTemplateService !== 'undefined' && HrmsContentTemplateService.seedMissingTemplateSettings) {
      HrmsContentTemplateService.seedMissingTemplateSettings();
    }
    var contentTemplates = (typeof HrmsContentTemplateService !== 'undefined' && HrmsContentTemplateService.listForClient)
      ? HrmsContentTemplateService.listForClient()
      : [];
    return {
      email: readEmailSettings_(),
      role_modules: readRoleModuleMatrix_(),
      role_access: readRoleAccessMatrix_(),
      welcome: welcome,
      content_templates: contentTemplates
    };
  }

  function saveSettings(session, payload) {
    PermissionService.require(HRMS.ACTIONS.ADMIN_SETTINGS, {}, session);
    ensureDefaultSettingsSeeded_();
    ensureRoleModuleSettingsSeeded_();
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
    var roleModules = payload.role_modules || {};
    ROLE_MODULE_ROLES_.forEach(function (role) {
      var patch = roleModules[role] || roleModules[String(role).toUpperCase()];
      if (!patch) return;
      ROLE_MODULE_ITEMS_.forEach(function (mod) {
        if (!patch.hasOwnProperty(mod.id)) return;
        var key = roleModuleKey_(role, mod.id);
        upsertSettingValue_(key, parseBool_(patch[mod.id], false) ? 'true' : 'false', session);
      });
    });
    var roleAccess = payload.role_access || {};
    roleAccessRoles_().forEach(function (role) {
      var patch = roleAccess[role] || roleAccess[String(role).toUpperCase()];
      if (!patch) return;
      ROLE_ACCESS_FEATURES_.forEach(function (feat) {
        if (!patch.hasOwnProperty(feat.id)) return;
        var key = roleAccessKey_(role, feat.id);
        upsertSettingValue_(key, parseBool_(patch[feat.id], true) ? 'true' : 'false', session);
      });
    });
    if (payload.content_templates && typeof HrmsContentTemplateService !== 'undefined' &&
        HrmsContentTemplateService.saveTemplates) {
      HrmsContentTemplateService.saveTemplates(session, payload.content_templates);
    }
    AuditService.log('ADMIN_SETTINGS_SAVE', 'Settings', 'org', 'Updated organisation settings', session.employee_id || '');
    return getSettings(session);
  }

  function roleAccessDefaultsForRole_(role) {
    role = String(role || 'EMPLOYEE').toUpperCase();
    if (roleAccessRoles_().indexOf(role) < 0) {
      return UserAccessService.defaultFlags();
    }
    return {
      access_documents: parseBool_(ConfigService.getSetting(roleAccessKey_(role, 'documents'), true), true),
      access_upload_documents: parseBool_(ConfigService.getSetting(roleAccessKey_(role, 'upload_documents'), true), true),
      access_payslips: parseBool_(ConfigService.getSetting(roleAccessKey_(role, 'payslips'), true), true),
      access_leave: parseBool_(ConfigService.getSetting(roleAccessKey_(role, 'leave'), true), true)
    };
  }

  return {
    getSettings: getSettings,
    saveSettings: saveSettings,
    roleAccessDefaultsForRole: roleAccessDefaultsForRole_,
    isModuleEnabledForRole: isModuleEnabledForRole_,
    isNavAllowedForRole: isNavAllowedForRole_,
    isActionAllowedForRole: isActionAllowedForRole_,
    ensureRoleModuleSettingsSeeded: ensureRoleModuleSettingsSeeded_
  };
})();
