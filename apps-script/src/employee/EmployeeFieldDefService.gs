/**
 * Organization-wide custom employee fields (labels + keys). Values live in Employees.custom_fields_json.
 */
var HRMS = HRMS || {};

var EmployeeFieldDefService = (function () {
  var KEY_PATTERN_ = /^[a-z][a-z0-9_]{1,39}$/;

  function requireManage_() {
    PermissionService.require(HRMS.ACTIONS.EMPLOYEE_UPDATE);
  }

  function trim_(v) {
    return v == null ? '' : String(v).trim();
  }

  function normalizeKey_(key) {
    return trim_(key).toLowerCase().replace(/\s+/g, '_');
  }

  function reservedKeys_() {
    return {
      employee_id: true,
      first_name: true,
      last_name: true,
      display_name: true,
      father_husband_name: true,
      uan_no: true,
      esi_no: true,
      pf_no: true,
      date_of_birth: true,
      gender: true,
      phone: true,
      address: true,
      work_email: true,
      department: true,
      designation: true,
      vertical_name: true,
      manager_employee_id: true,
      joining_date: true,
      employment_type: true,
      location: true,
      status: true,
      salary_structure_id: true,
      ctc_monthly: true,
      pan: true,
      bank_account_name: true,
      bank_account_number: true,
      bank_ifsc: true,
      bank_name: true,
      notes: true,
      custom_fields_json: true,
      create_login: true,
      google_login_email: true
    };
  }

  function serialize_(row) {
    return {
      field_def_id: String(row.field_def_id || ''),
      field_key: String(row.field_key || ''),
      field_label: String(row.field_label || ''),
      sort_order: Number(row.sort_order || 0),
      status: String(row.status || 'ACTIVE').toUpperCase()
    };
  }

  function listFieldDefs(activeOnly) {
    SchemaService.ensureSheetHeaders(HRMS.SHEETS.EMPLOYEE_FIELD_DEFS);
    var rows = DbService.getAllRecords(HRMS.SHEETS.EMPLOYEE_FIELD_DEFS);
    if (activeOnly) {
      rows = rows.filter(function (r) {
        return String(r.status || '').toUpperCase() === 'ACTIVE';
      });
    }
    rows.sort(function (a, b) {
      var sa = Number(a.sort_order || 0);
      var sb = Number(b.sort_order || 0);
      if (sa !== sb) return sa - sb;
      return String(a.field_label).localeCompare(String(b.field_label));
    });
    return rows.map(serialize_);
  }

  function listActiveFieldKeys() {
    return listFieldDefs(true).map(function (d) { return d.field_key; });
  }

  function normalizeDefs_(list) {
    if (!list || !list.length) {
      throw validationError_('Add at least one custom field.');
    }
    var reserved = reservedKeys_();
    var seen = {};
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var item = list[i] || {};
      var key = normalizeKey_(item.field_key);
      var label = trim_(item.field_label);
      if (!key || !label) {
        throw validationError_('Each field needs a key and a label.');
      }
      if (!KEY_PATTERN_.test(key)) {
        throw validationError_('Field key "' + key + '" must be lowercase letters, numbers, underscores (2–40 chars, start with a letter).');
      }
      if (reserved[key]) {
        throw validationError_('Field key "' + key + '" is reserved.');
      }
      if (seen[key]) {
        throw validationError_('Duplicate field key: ' + key + '.');
      }
      seen[key] = true;
      out.push({
        field_key: key,
        field_label: label,
        sort_order: Number(item.sort_order != null ? item.sort_order : i + 1),
        status: String(item.status || 'ACTIVE').toUpperCase() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE'
      });
    }
    return out;
  }

  function saveFieldDefs(payload) {
    requireManage_();
    payload = payload || {};
    var raw = payload.fields || payload.defs || [];
    SchemaService.ensureSheetHeaders(HRMS.SHEETS.EMPLOYEE_FIELD_DEFS);
    if (!raw.length) {
      DbService.replaceRecords(HRMS.SHEETS.EMPLOYEE_FIELD_DEFS, {}, []);
      AuditService.log('EMPLOYEE_FIELD_DEFS_SAVE', HRMS.SHEETS.EMPLOYEE_FIELD_DEFS, 'ALL', 'Cleared custom employee fields', '');
      return [];
    }
    var defs = normalizeDefs_(raw);
    var now = new Date();
    var rows = defs.map(function (d) {
      return {
        field_def_id: DbService.generateId('EF'),
        field_key: d.field_key,
        field_label: d.field_label,
        sort_order: d.sort_order,
        status: d.status,
        created_at: now,
        updated_at: now
      };
    });
    DbService.replaceRecords(HRMS.SHEETS.EMPLOYEE_FIELD_DEFS, {}, rows);
    AuditService.log('EMPLOYEE_FIELD_DEFS_SAVE', HRMS.SHEETS.EMPLOYEE_FIELD_DEFS, 'ALL',
      'Saved ' + rows.length + ' custom employee field definition(s)', '');
    return listFieldDefs(false);
  }

  function parseCustomFieldsJson_(text) {
    if (!text) return {};
    try {
      var parsed = JSON.parse(String(text));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return parsed;
    } catch (ignore) {
      return {};
    }
  }

  function mergeCustomFieldsFromPayload_(payload, existingJson) {
    var base = parseCustomFieldsJson_(existingJson);
    var incoming = payload.custom_fields;
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      return JSON.stringify(base);
    }
    var allowed = {};
    listFieldDefs(true).forEach(function (d) { allowed[d.field_key] = true; });
    Object.keys(incoming).forEach(function (k) {
      var key = normalizeKey_(k);
      if (!allowed[key]) return;
      base[key] = trim_(incoming[k]);
    });
    return JSON.stringify(base);
  }

  function applyBulkCustomFields_(payload, row) {
    var custom = {};
    listFieldDefs(true).forEach(function (d) {
      if (row.hasOwnProperty(d.field_key)) {
        custom[d.field_key] = trim_(row[d.field_key]);
      }
    });
    if (Object.keys(custom).length) {
      payload.custom_fields = custom;
    }
    return payload;
  }

  return {
    listFieldDefs: listFieldDefs,
    listActiveFieldKeys: listActiveFieldKeys,
    saveFieldDefs: saveFieldDefs,
    parseCustomFieldsJson_: parseCustomFieldsJson_,
    mergeCustomFieldsFromPayload_: mergeCustomFieldsFromPayload_,
    applyBulkCustomFields_: applyBulkCustomFields_
  };
})();
