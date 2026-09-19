/**
 * Salary structure *types* — reusable, shared templates (like Leave Types).
 *
 * A structure type lives in the SalaryStructures sheet with a structure_name,
 * a vertical_name (label only), status ACTIVE/INACTIVE, and an empty employee_id
 * (that empty employee_id is how a template row is told apart from any legacy
 * per-employee structure row, which carries an employee_id and CURRENT/SUPERSEDED
 * status). Component lines live in SalaryComponents, keyed by salary_structure_id,
 * and hold percentages of the employee's CTC (calc_method PERCENT_OF_CTC) or a
 * flat amount (FIXED). Employees reference a type via Employees.salary_structure_id;
 * payroll consumption is wired in a later step.
 */
var SalaryStructureTypeService = (function () {
  var VALID_KINDS_ = [HRMS.COMPONENT_KIND.EARNING, HRMS.COMPONENT_KIND.DEDUCTION, HRMS.COMPONENT_KIND.EMPLOYER];
  var VALID_METHODS_ = [HRMS.CALC_METHOD.PERCENT_OF_CTC, HRMS.CALC_METHOD.FIXED];

  function requireManage_() {
    return PermissionService.require(HRMS.ACTIONS.COMPENSATION_MANAGE);
  }

  function trim_(v) {
    return v == null ? '' : String(v).trim();
  }

  function isTypeRow_(row) {
    return !!row && trim_(row.structure_name) !== '' && trim_(row.employee_id) === '';
  }

  /** Short, readable, sequential id (SS-001, SS-002, ...). Caller holds the script lock. */
  function nextStructureId_() {
    var seq = DbService.nextSequenceAssumingLocked
      ? DbService.nextSequenceAssumingLocked('seq_salary_structure')
      : DbService.nextSequence('seq_salary_structure');
    var n = String(seq);
    while (n.length < 3) n = '0' + n;
    return 'SS-' + n;
  }

  function parseNonNegative_(value, label) {
    if (value === '' || value == null) return 0;
    var n = Number(value);
    if (!isFinite(n)) throw validationError_(label + ' must be a valid number.');
    if (n < 0) throw validationError_(label + ' cannot be negative.');
    return n;
  }

  function allowedVerticals_() {
    try {
      if (typeof EmployeeRepository !== 'undefined' && EmployeeRepository.listVerticals) {
        var list = EmployeeRepository.listVerticals();
        if (list && list.length) return list;
      }
    } catch (ignore) {}
    return (HRMS.VERTICALS || []).slice();
  }

  function normalizeComponents_(list) {
    if (!list || !list.length) {
      throw validationError_('Add at least one salary component.');
    }
    var seen = {};
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i] || {};
      var code = trim_(c.component_code).toUpperCase();
      var name = trim_(c.component_name);
      var kind = trim_(c.component_kind).toUpperCase();
      var method = trim_(c.calc_method).toUpperCase();
      if (!code || !name) {
        throw validationError_('Each component needs a code and a name.');
      }
      if (seen[code]) {
        throw validationError_('Duplicate component code: ' + code + '.');
      }
      seen[code] = true;
      if (VALID_KINDS_.indexOf(kind) < 0) {
        throw validationError_('component_kind must be EARNING, DEDUCTION, or EMPLOYER.');
      }
      if (VALID_METHODS_.indexOf(method) < 0) {
        throw validationError_('calc_method must be PERCENT_OF_CTC or FIXED.');
      }
      var percent = '';
      var amount = '';
      if (method === HRMS.CALC_METHOD.PERCENT_OF_CTC) {
        percent = parseNonNegative_(c.percent, code + ' percent');
        if (percent > 100) throw validationError_(code + ' percent cannot exceed 100.');
      } else {
        amount = parseNonNegative_(c.amount, code + ' amount');
      }
      out.push({
        component_code: code,
        component_name: name,
        component_kind: kind,
        calc_method: method,
        percent: percent,
        amount: amount,
        sort_order: Number(c.sort_order != null ? c.sort_order : i + 1)
      });
    }
    return out;
  }

  /** Non-blocking warning when EARNING percentages don't add up to 100% of CTC. */
  function earningsPercentWarning_(components) {
    var sum = 0;
    var hasPercentEarning = false;
    components.forEach(function (c) {
      if (c.component_kind === HRMS.COMPONENT_KIND.EARNING &&
          c.calc_method === HRMS.CALC_METHOD.PERCENT_OF_CTC) {
        hasPercentEarning = true;
        sum += Number(c.percent) || 0;
      }
    });
    if (hasPercentEarning && Math.round(sum * 100) / 100 !== 100) {
      return 'Earning percentages add up to ' + (Math.round(sum * 100) / 100) +
        '% of CTC (usually should total 100%).';
    }
    return '';
  }

  function serializeComponent_(c) {
    return {
      salary_component_id: String(c.salary_component_id || ''),
      component_code: String(c.component_code || ''),
      component_name: String(c.component_name || ''),
      component_kind: String(c.component_kind || ''),
      calc_method: String(c.calc_method || ''),
      percent: c.percent === '' || c.percent == null ? null : Number(c.percent),
      amount: c.amount === '' || c.amount == null ? null : Number(c.amount),
      sort_order: Number(c.sort_order || 0)
    };
  }

  function loadComponents_(structureId) {
    var rows = DbService.findRecords(HRMS.SHEETS.SALARY_COMPONENTS, { salary_structure_id: structureId });
    rows.sort(function (a, b) { return Number(a.sort_order || 0) - Number(b.sort_order || 0); });
    return rows;
  }

  function serializeType_(row, includeComponents) {
    var out = {
      salary_structure_id: String(row.salary_structure_id || ''),
      structure_name: String(row.structure_name || ''),
      vertical_name: String(row.vertical_name || ''),
      status: String(row.status || HRMS.STRUCTURE_TYPE_STATUS.ACTIVE).toUpperCase(),
      currency: String(row.currency || 'INR')
    };
    if (includeComponents) {
      out.components = loadComponents_(row.salary_structure_id).map(serializeComponent_);
    }
    return out;
  }

  function writeComponents_(structureId, components) {
    var rows = components.map(function (c) {
      return {
        salary_component_id: DbService.generateId('SC'),
        salary_structure_id: structureId,
        component_code: c.component_code,
        component_name: c.component_name,
        component_kind: c.component_kind,
        calc_method: c.calc_method,
        amount: c.amount,
        percent: c.percent,
        sort_order: c.sort_order
      };
    });
    DbService.replaceRecords(HRMS.SHEETS.SALARY_COMPONENTS, { salary_structure_id: structureId }, rows);
  }

  function listStructureTypes(activeOnly) {
    requireManage_();
    var rows = DbService.getAllRecords(HRMS.SHEETS.SALARY_STRUCTURES).filter(isTypeRow_);
    if (activeOnly) {
      rows = rows.filter(function (r) {
        return String(r.status || '').toUpperCase() === HRMS.STRUCTURE_TYPE_STATUS.ACTIVE;
      });
    }
    rows.sort(function (a, b) {
      return String(a.structure_name).localeCompare(String(b.structure_name));
    });
    return rows.map(function (r) { return serializeType_(r, true); });
  }

  function getStructureType(structureId) {
    requireManage_();
    structureId = trim_(structureId);
    if (!structureId) throw validationError_('salary_structure_id is required.');
    var row = DbService.findOne(HRMS.SHEETS.SALARY_STRUCTURES, { salary_structure_id: structureId });
    if (!isTypeRow_(row)) throw notFoundError_('Salary structure not found.');
    return serializeType_(row, true);
  }

  /** Lightweight options for employee create/edit + bulk mapping. */
  function listStructureTypeOptions(filter) {
    requireManage_();
    filter = filter || {};
    var wantVertical = trim_(filter.vertical_name || filter.vertical).toUpperCase();
    var activeOnly = filter.activeOnly !== false;
    var rows = DbService.getAllRecords(HRMS.SHEETS.SALARY_STRUCTURES).filter(isTypeRow_);
    return rows
      .filter(function (r) {
        if (activeOnly && String(r.status || '').toUpperCase() !== HRMS.STRUCTURE_TYPE_STATUS.ACTIVE) {
          return false;
        }
        if (wantVertical && String(r.vertical_name || '').toUpperCase() !== wantVertical) return false;
        return true;
      })
      .sort(function (a, b) { return String(a.structure_name).localeCompare(String(b.structure_name)); })
      .map(function (r) {
        return {
          salary_structure_id: String(r.salary_structure_id || ''),
          structure_name: String(r.structure_name || ''),
          vertical_name: String(r.vertical_name || '')
        };
      });
  }

  function saveStructureType(payload) {
    var session = requireManage_();
    payload = payload || {};
    var name = trim_(payload.structure_name);
    if (!name) throw validationError_('Structure name is required.');
    var vertical = trim_(payload.vertical_name).toUpperCase();
    if (!vertical) throw validationError_('Vertical is required.');
    if (allowedVerticals_().indexOf(vertical) < 0) {
      throw validationError_('Select a valid vertical.');
    }
    var status = trim_(payload.status).toUpperCase() === HRMS.STRUCTURE_TYPE_STATUS.INACTIVE
      ? HRMS.STRUCTURE_TYPE_STATUS.INACTIVE
      : HRMS.STRUCTURE_TYPE_STATUS.ACTIVE;
    var components = normalizeComponents_(payload.components);
    var warning = earningsPercentWarning_(components);
    var structureId = trim_(payload.salary_structure_id);

    return withScriptLock_(function () {
      var all = DbService.getAllRecords(HRMS.SHEETS.SALARY_STRUCTURES).filter(isTypeRow_);
      var duplicate = all.filter(function (r) {
        return String(r.structure_name).trim().toUpperCase() === name.toUpperCase() &&
          String(r.salary_structure_id) !== structureId;
      })[0];
      if (duplicate) throw validationError_('A structure with this name already exists.');

      var now = new Date();
      var savedId;
      if (structureId) {
        var existing = DbService.findOne(HRMS.SHEETS.SALARY_STRUCTURES, { salary_structure_id: structureId });
        if (!isTypeRow_(existing)) throw notFoundError_('Salary structure not found.');
        DbService.updateRecord(HRMS.SHEETS.SALARY_STRUCTURES, 'salary_structure_id', structureId, {
          structure_name: name,
          vertical_name: vertical,
          status: status,
          currency: 'INR',
          updated_at: now,
          updated_by_email: session.email
        });
        savedId = structureId;
      } else {
        savedId = nextStructureId_();
        DbService.insertRecord(HRMS.SHEETS.SALARY_STRUCTURES, {
          salary_structure_id: savedId,
          structure_name: name,
          vertical_name: vertical,
          status: status,
          currency: 'INR',
          employee_id: '',
          created_at: now,
          created_by_email: session.email,
          updated_at: now,
          updated_by_email: session.email
        });
      }
      writeComponents_(savedId, components);
      AuditService.log(HRMS.AUDIT_ACTIONS.STRUCTURE_TYPE_SAVE, 'SalaryStructures', savedId,
        'Saved salary structure "' + name + '" (' + vertical + ')', '');
      var result = getStructureType(savedId);
      if (warning) result.warning = warning;
      return result;
    });
  }

  function setStructureTypeStatus(structureId, status) {
    var session = requireManage_();
    structureId = trim_(structureId);
    if (!structureId) throw validationError_('salary_structure_id is required.');
    var next = trim_(status).toUpperCase();
    if (next !== HRMS.STRUCTURE_TYPE_STATUS.ACTIVE && next !== HRMS.STRUCTURE_TYPE_STATUS.INACTIVE) {
      throw validationError_('Status must be ACTIVE or INACTIVE.');
    }
    return withScriptLock_(function () {
      var existing = DbService.findOne(HRMS.SHEETS.SALARY_STRUCTURES, { salary_structure_id: structureId });
      if (!isTypeRow_(existing)) throw notFoundError_('Salary structure not found.');
      DbService.updateRecord(HRMS.SHEETS.SALARY_STRUCTURES, 'salary_structure_id', structureId, {
        status: next,
        updated_at: new Date(),
        updated_by_email: session.email
      });
      AuditService.log(HRMS.AUDIT_ACTIONS.STRUCTURE_TYPE_STATUS, 'SalaryStructures', structureId,
        'Set salary structure status to ' + next, '');
      return getStructureType(structureId);
    });
  }

  /** Server-side lookup used by employee create/edit + bulk validation. */
  function findTypeById(structureId) {
    structureId = trim_(structureId);
    if (!structureId) return null;
    var row = DbService.findOne(HRMS.SHEETS.SALARY_STRUCTURES, { salary_structure_id: structureId });
    return isTypeRow_(row) ? row : null;
  }

  /** Resolve a structure by its (case-insensitive) name — used by bulk upload. */
  function findTypeByName(name) {
    name = trim_(name).toUpperCase();
    if (!name) return null;
    var rows = DbService.getAllRecords(HRMS.SHEETS.SALARY_STRUCTURES).filter(isTypeRow_);
    return rows.filter(function (r) {
      return String(r.structure_name).trim().toUpperCase() === name;
    })[0] || null;
  }

  return {
    listStructureTypes: listStructureTypes,
    getStructureType: getStructureType,
    listStructureTypeOptions: listStructureTypeOptions,
    saveStructureType: saveStructureType,
    setStructureTypeStatus: setStructureTypeStatus,
    findTypeById: findTypeById,
    findTypeByName: findTypeByName,
    isTypeRow: isTypeRow_
  };
})();
