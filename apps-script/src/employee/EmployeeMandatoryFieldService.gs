/**
 * Configurable mandatory fields for employee create, edit, and bulk upload.
 * Stored in Settings sheet as JSON (employee_mandatory_fields_json).
 */
var HRMS = HRMS || {};

var EmployeeMandatoryFieldService = (function () {
  var SETTINGS_KEY_ = 'employee_mandatory_fields_json';

  var FIELD_DEFS_ = [
    { id: 'employee_id', label: 'Employee code', group: 'Identity', defaultMandatory: true, locked: true, bulk: true, form: true },
    { id: 'first_name', label: 'First name', group: 'Identity', defaultMandatory: true, bulk: true, form: true },
    { id: 'last_name', label: 'Last name', group: 'Identity', defaultMandatory: true, bulk: true, form: true },
    { id: 'display_name', label: 'Display name', group: 'Identity', defaultMandatory: false, bulk: true, form: true },
    { id: 'father_husband_name', label: 'Father / husband name', group: 'Identity', defaultMandatory: false, bulk: true, form: true },
    { id: 'date_of_birth', label: 'Date of birth', group: 'Identity', defaultMandatory: false, bulk: true, form: true },
    { id: 'gender', label: 'Gender', group: 'Identity', defaultMandatory: false, bulk: true, form: true },
    { id: 'phone', label: 'Phone', group: 'Contact', defaultMandatory: false, bulk: true, form: true },
    { id: 'address', label: 'Address', group: 'Contact', defaultMandatory: false, bulk: true, form: true },
    { id: 'work_email', label: 'Work email', group: 'Work', defaultMandatory: true, bulk: true, form: true },
    { id: 'department', label: 'Department', group: 'Work', defaultMandatory: true, bulk: true, form: true },
    { id: 'designation', label: 'Designation', group: 'Work', defaultMandatory: true, bulk: true, form: true },
    { id: 'vertical_name', label: 'Vertical', group: 'Work', defaultMandatory: true, bulk: true, form: true },
    { id: 'manager_employee_id', label: 'Manager employee ID', group: 'Work', defaultMandatory: false, bulk: true, form: true },
    { id: 'joining_date', label: 'Joining date', group: 'Work', defaultMandatory: true, bulk: true, form: true },
    { id: 'employment_type', label: 'Employment type', group: 'Work', defaultMandatory: true, bulk: true, form: true },
    { id: 'location', label: 'Location', group: 'Work', defaultMandatory: true, bulk: true, form: true },
    { id: 'salary_structure_id', label: 'Salary structure', group: 'Payroll', defaultMandatory: false, bulk: true, form: true },
    { id: 'ctc_monthly', label: 'Monthly CTC', group: 'Payroll', defaultMandatory: false, bulk: true, form: true },
    { id: 'uan_no', label: 'UAN no.', group: 'Payroll', defaultMandatory: false, bulk: true, form: true },
    { id: 'esi_no', label: 'ESI no.', group: 'Payroll', defaultMandatory: false, bulk: true, form: true },
    { id: 'pf_no', label: 'PF no.', group: 'Payroll', defaultMandatory: false, bulk: true, form: true },
    { id: 'pan', label: 'PAN', group: 'Payroll', defaultMandatory: false, bulk: true, form: true },
    { id: 'bank_account_name', label: 'Bank account name', group: 'Bank', defaultMandatory: false, bulk: true, form: true },
    { id: 'bank_account_number', label: 'Bank account number', group: 'Bank', defaultMandatory: false, bulk: true, form: true },
    { id: 'bank_ifsc', label: 'IFSC', group: 'Bank', defaultMandatory: false, bulk: true, form: true },
    { id: 'bank_name', label: 'Bank name', group: 'Bank', defaultMandatory: false, bulk: true, form: true },
    { id: 'notes', label: 'Notes (HR)', group: 'Other', defaultMandatory: false, bulk: true, form: true },
    { id: 'create_login', label: 'create_login (bulk)', group: 'Bulk login', defaultMandatory: true, bulk: true, form: false },
    { id: 'google_login_email', label: 'Google login email', group: 'Bulk login', defaultMandatory: false, bulk: true, form: true }
  ];

  function trim_(v) {
    return v == null ? '' : String(v).trim();
  }

  function defById_(id) {
    for (var i = 0; i < FIELD_DEFS_.length; i++) {
      if (FIELD_DEFS_[i].id === id) return FIELD_DEFS_[i];
    }
    return null;
  }

  function defaultMandatoryMap_() {
    var map = {};
    FIELD_DEFS_.forEach(function (f) {
      map[f.id] = !!f.defaultMandatory;
    });
    return map;
  }

  function readStoredMap_() {
    var raw = ConfigService.getSetting(SETTINGS_KEY_, '');
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return parsed;
    } catch (ignore) {
      return null;
    }
  }

  function mergedMandatoryMap_() {
    var defaults = defaultMandatoryMap_();
    var stored = readStoredMap_() || {};
    var out = {};
    FIELD_DEFS_.forEach(function (f) {
      if (f.locked) {
        out[f.id] = true;
      } else if (stored.hasOwnProperty(f.id)) {
        out[f.id] = !!stored[f.id];
      } else {
        out[f.id] = !!defaults[f.id];
      }
    });
    return out;
  }

  function listConfig() {
    var mandatory = mergedMandatoryMap_();
    var groups = {};
    FIELD_DEFS_.forEach(function (f) {
      if (!groups[f.group]) groups[f.group] = [];
      groups[f.group].push({
        id: f.id,
        label: f.label,
        mandatory: !!mandatory[f.id],
        locked: !!f.locked,
        bulk: !!f.bulk,
        form: !!f.form
      });
    });
    var groupList = Object.keys(groups).map(function (name) {
      return { name: name, fields: groups[name] };
    });
    return { groups: groupList, fields: FIELD_DEFS_.map(function (f) {
      return {
        id: f.id,
        label: f.label,
        group: f.group,
        mandatory: !!mandatory[f.id],
        locked: !!f.locked,
        bulk: !!f.bulk,
        form: !!f.form
      };
    }) };
  }

  function listMandatoryFieldIds(mode) {
    mode = mode === 'bulk' ? 'bulk' : 'form';
    var mandatory = mergedMandatoryMap_();
    return FIELD_DEFS_.filter(function (f) {
      if (mode === 'bulk' && !f.bulk) return false;
      if (mode === 'form' && !f.form) return false;
      return !!mandatory[f.id];
    }).map(function (f) { return f.id; });
  }

  function isMandatory_(fieldId) {
    var map = mergedMandatoryMap_();
    return !!map[fieldId];
  }

  function fieldLabel_(fieldId) {
    var def = defById_(fieldId);
    return def ? def.label : fieldId;
  }

  function requireValue_(payload, fieldId, errors, message) {
    if (!isMandatory_(fieldId)) return;
    var val = payload[fieldId];
    if (trim_(val) === '') {
      errors[fieldId] = message || (fieldLabel_(fieldId) + ' is required.');
    }
  }

  /**
   * Apply mandatory rules to employee payload validation errors object.
   * @param {Object} payload
   * @param {Object} errors mutable map field -> message
   * @param {Object} context { isCreate, isBulk, createUser }
   */
  function applyMandatoryValidation_(payload, errors, context) {
    context = context || {};
    payload = payload || {};
    errors = errors || {};

    var skipCreateOnly = !context.isCreate && !context.isBulk;
    FIELD_DEFS_.forEach(function (f) {
      if (f.id === 'employee_id' && skipCreateOnly) return;
      if (f.id === 'create_login') {
        if (!context.isBulk || !isMandatory_('create_login')) return;
        if (!trim_(payload.create_login) && context.isBulk) {
          errors.create_login = 'create_login is required (YES or NO).';
        }
        return;
      }
      if (f.id === 'google_login_email') {
        var needLogin = false;
        if (context.isBulk && payload.create_user) needLogin = true;
        if (context.isCreate && payload.create_user) needLogin = true;
        if (needLogin || isMandatory_('google_login_email')) {
          var login = trim_(payload.google_login_email) || trim_(payload.work_email);
          if (!login) {
            errors.google_login_email = 'Google login email is required.';
          }
        }
        return;
      }
      if (context.isBulk && !f.bulk) return;
      if (!context.isBulk && !f.form) return;
      if (f.id === 'employee_id' && !context.isCreate && !context.isBulk) return;
      requireValue_(payload, f.id, errors);
    });
  }

  function upsertSettingValue_(value) {
    ConfigService.clearSettingsCache();
    var row = DbService.findOne(HRMS.SHEETS.SETTINGS, { setting_key: SETTINGS_KEY_ });
    if (!row) {
      if (typeof SchemaService !== 'undefined' && SchemaService.seedMissingDefaultSettings) {
        SchemaService.seedMissingDefaultSettings();
      }
      row = DbService.findOne(HRMS.SHEETS.SETTINGS, { setting_key: SETTINGS_KEY_ });
    }
    if (!row) {
      throw configurationError_('Unknown setting key: ' + SETTINGS_KEY_ + '. Re-run database setup to seed Settings.');
    }
    var actor = 'system';
    try {
      if (typeof AuthService !== 'undefined' && AuthService.getSession) {
        var session = AuthService.getSession();
        if (session && session.email) actor = String(session.email).trim().toLowerCase();
      }
    } catch (ignore) {}
    DbService.updateRecord(HRMS.SHEETS.SETTINGS, 'setting_key', SETTINGS_KEY_, {
      setting_value: String(value),
      updated_at: new Date(),
      updated_by_email: actor
    });
    ConfigService.clearSettingsCache();
  }

  function saveConfig(payload) {
    PermissionService.require(HRMS.ACTIONS.EMPLOYEE_CREATE);
    payload = payload || {};
    var incoming = payload.mandatory || payload.fields || payload;
    var stored = {};
    if (Array.isArray(incoming)) {
      incoming.forEach(function (row) {
        if (!row || !row.id) return;
        stored[row.id] = !!row.mandatory;
      });
    } else if (incoming && typeof incoming === 'object') {
      Object.keys(incoming).forEach(function (k) {
        stored[k] = !!incoming[k];
      });
    }
    FIELD_DEFS_.forEach(function (f) {
      if (f.locked) stored[f.id] = true;
    });
    upsertSettingValue_(JSON.stringify(stored));
    return listConfig();
  }

  function applyMandatoryRowValidation_(payload, rowErrors, context) {
    var errors = {};
    applyMandatoryValidation_(payload, errors, context || {});
    Object.keys(errors).forEach(function (field) {
      rowErrors.push({ field: field, message: errors[field] });
    });
  }

  return {
    listConfig: listConfig,
    saveConfig: saveConfig,
    listMandatoryFieldIds: listMandatoryFieldIds,
    isMandatory: isMandatory_,
    applyMandatoryValidation: applyMandatoryValidation_,
    applyMandatoryRowValidation: applyMandatoryRowValidation_,
    fieldLabel: fieldLabel_
  };
})();
