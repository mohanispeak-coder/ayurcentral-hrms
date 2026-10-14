/**
 * Salary structure *types* - reusable, shared templates (like Leave Types).
 *
 * A structure type lives in the SalaryStructures sheet with a structure_name,
 * a vertical_name (label only), status ACTIVE/INACTIVE, and an empty employee_id
 * (that empty employee_id is how a template row is told apart from any legacy
 * per-employee structure row, which carries an employee_id and CURRENT/SUPERSEDED
 * status). Component lines live in SalaryComponents, keyed by salary_structure_id,
 * calc_method PERCENT_OF_CTC (e.g. BP), PERCENT_OF_BASIC (e.g. HRA % of BP), FIXED,
 * or BALANCE_OF_CTC (remainder earning, e.g. SA). Employees reference a type via
 * Employees.salary_structure_id;
 * payroll consumption is wired in a later step.
 */
var SalaryStructureTypeService = (function () {
  var VALID_KINDS_ = [HRMS.COMPONENT_KIND.EARNING, HRMS.COMPONENT_KIND.DEDUCTION, HRMS.COMPONENT_KIND.EMPLOYER];
  var VALID_METHODS_ = [
    HRMS.CALC_METHOD.PERCENT,
    HRMS.CALC_METHOD.PERCENT_OF_CTC,
    HRMS.CALC_METHOD.PERCENT_OF_BASIC,
    HRMS.CALC_METHOD.FIXED,
    HRMS.CALC_METHOD.BALANCE_OF_CTC,
    HRMS.CALC_METHOD.PERCENT_CAPPED,
    HRMS.CALC_METHOD.PERCENT_IF,
    HRMS.CALC_METHOD.THRESHOLD_FEE,
    HRMS.CALC_METHOD.MANUAL,
    HRMS.CALC_METHOD.PRORATE_ROUND_LINE,
    HRMS.CALC_METHOD.PRORATE_FACTOR
  ];

  function defaultPayrollRules_() {
    return JSON.stringify({
      execution_sections: HRMS.SALARY_EXECUTION_SECTIONS,
      earned_prorate: 'ROUND_LINE',
      arrears_add_codes: ['ARREARS']
    });
  }

  function defaultTemplateComponents_() {
    return [
      { structure_section: HRMS.STRUCTURE_SECTION.RATE_OF_PAY, component_code: 'BP', component_name: 'Basic + DA',
        component_kind: HRMS.COMPONENT_KIND.EARNING, calc_method: HRMS.CALC_METHOD.PERCENT,
        percent_base: HRMS.PERCENT_BASE_CTC, percent: 60, sort_order: 1 },
      { structure_section: HRMS.STRUCTURE_SECTION.RATE_OF_PAY, component_code: 'HRA', component_name: 'HRA',
        component_kind: HRMS.COMPONENT_KIND.EARNING, calc_method: HRMS.CALC_METHOD.PERCENT,
        percent_base: 'BP', percent: 40, sort_order: 2 },
      { structure_section: HRMS.STRUCTURE_SECTION.RATE_OF_PAY, component_code: 'CONV', component_name: 'Conveyance',
        component_kind: HRMS.COMPONENT_KIND.EARNING, calc_method: HRMS.CALC_METHOD.FIXED, amount: 1600, sort_order: 3 },
      { structure_section: HRMS.STRUCTURE_SECTION.RATE_OF_PAY, component_code: 'MED', component_name: 'Medical',
        component_kind: HRMS.COMPONENT_KIND.EARNING, calc_method: HRMS.CALC_METHOD.FIXED, amount: 1250, sort_order: 4 },
      { structure_section: HRMS.STRUCTURE_SECTION.RATE_OF_PAY, component_code: 'SA', component_name: 'Special allowance',
        component_kind: HRMS.COMPONENT_KIND.EARNING, calc_method: HRMS.CALC_METHOD.BALANCE_OF_CTC, sort_order: 5 },
      { structure_section: HRMS.STRUCTURE_SECTION.EARNED_PAY, component_code: '*', component_name: 'All rate lines',
        component_kind: HRMS.COMPONENT_KIND.EARNING, calc_method: HRMS.CALC_METHOD.PRORATE_ROUND_LINE,
        round_mode: HRMS.FORMULA_ROUND.ROUND, sort_order: 6 },
      { structure_section: HRMS.STRUCTURE_SECTION.DEDUCTION, component_code: 'PF', component_name: 'PF',
        component_kind: HRMS.COMPONENT_KIND.DEDUCTION, calc_method: HRMS.CALC_METHOD.PERCENT_CAPPED,
        percent_base: 'BP', percent: 12, cap_amount: 25000, round_mode: HRMS.FORMULA_ROUND.ROUND, sort_order: 10 },
      { structure_section: HRMS.STRUCTURE_SECTION.DEDUCTION, component_code: 'ESIC', component_name: 'ESIC',
        component_kind: HRMS.COMPONENT_KIND.DEDUCTION, calc_method: HRMS.CALC_METHOD.PERCENT_IF,
        cond_ref: HRMS.FORMULA_REF.RATE_GROSS, cond_op: 'LT', cond_value: 21001,
        percent_base: HRMS.FORMULA_REF.EARNED_GROSS, percent: 0.75, round_mode: HRMS.FORMULA_ROUND.ROUNDUP, sort_order: 11 },
      { structure_section: HRMS.STRUCTURE_SECTION.DEDUCTION, component_code: 'PT', component_name: 'Professional tax',
        component_kind: HRMS.COMPONENT_KIND.DEDUCTION, calc_method: HRMS.CALC_METHOD.THRESHOLD_FEE,
        cond_ref: HRMS.FORMULA_REF.EARNED_GROSS, cond_op: 'LTE', cond_value: 25000, amount: 200,
        round_mode: HRMS.FORMULA_ROUND.ROUND, sort_order: 12 },
      { structure_section: HRMS.STRUCTURE_SECTION.MANUAL_DEDUCTION, component_code: 'ADVANCE', component_name: 'Advance',
        component_kind: HRMS.COMPONENT_KIND.DEDUCTION, calc_method: HRMS.CALC_METHOD.MANUAL, sort_order: 20 },
      { structure_section: HRMS.STRUCTURE_SECTION.MANUAL_DEDUCTION, component_code: 'TDS', component_name: 'TDS',
        component_kind: HRMS.COMPONENT_KIND.DEDUCTION, calc_method: HRMS.CALC_METHOD.MANUAL, sort_order: 21 },
      { structure_section: HRMS.STRUCTURE_SECTION.MANUAL_DEDUCTION, component_code: 'LCD', component_name: 'LCD',
        component_kind: HRMS.COMPONENT_KIND.DEDUCTION, calc_method: HRMS.CALC_METHOD.MANUAL, sort_order: 22 },
      { structure_section: HRMS.STRUCTURE_SECTION.MANUAL_DEDUCTION, component_code: 'LWF', component_name: 'LWF',
        component_kind: HRMS.COMPONENT_KIND.DEDUCTION, calc_method: HRMS.CALC_METHOD.MANUAL, sort_order: 23 }
    ];
  }

  function inferSection_(c, kind, method) {
    var sec = trim_(c.structure_section).toUpperCase();
    if (sec) return sec;
    if (method === HRMS.CALC_METHOD.MANUAL) return HRMS.STRUCTURE_SECTION.MANUAL_DEDUCTION;
    if (method === HRMS.CALC_METHOD.PRORATE_ROUND_LINE ||
        method === HRMS.CALC_METHOD.PRORATE_FACTOR) {
      return HRMS.STRUCTURE_SECTION.EARNED_PAY;
    }
    if (kind === HRMS.COMPONENT_KIND.DEDUCTION || kind === HRMS.COMPONENT_KIND.EMPLOYER) {
      return HRMS.STRUCTURE_SECTION.DEDUCTION;
    }
    return HRMS.STRUCTURE_SECTION.RATE_OF_PAY;
  }

  function rateOnly_(components) {
    return (components || []).filter(function (c) {
      return inferSection_(c, trim_(c.component_kind).toUpperCase(), trim_(c.calc_method).toUpperCase()) ===
        HRMS.STRUCTURE_SECTION.RATE_OF_PAY;
    });
  }

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
    var codesSoFar = {};
    for (var i = 0; i < list.length; i++) {
      var c = list[i] || {};
      var code = trim_(c.component_code).toUpperCase();
      var name = trim_(c.component_name);
      var kind = trim_(c.component_kind).toUpperCase();
      var method = trim_(c.calc_method).toUpperCase();
      var percentBase = trim_(c.percent_base).toUpperCase();
      if (!code || !name) {
        throw validationError_('Each component needs a code and a name.');
      }
      if (VALID_KINDS_.indexOf(kind) < 0) {
        throw validationError_('component_kind must be EARNING, DEDUCTION, or EMPLOYER.');
      }
      if (VALID_METHODS_.indexOf(method) < 0) {
        throw validationError_('calc_method is not valid for structure templates.');
      }
      if (method === HRMS.CALC_METHOD.PERCENT_OF_CTC) {
        method = HRMS.CALC_METHOD.PERCENT;
        percentBase = HRMS.PERCENT_BASE_CTC;
      } else if (method === HRMS.CALC_METHOD.PERCENT_OF_BASIC) {
        method = HRMS.CALC_METHOD.PERCENT;
        if (!percentBase) percentBase = 'BP';
      }
      var structureSection = inferSection_(c, kind, method);
      var seenKey = structureSection + '::' + code;
      if (seen[seenKey]) {
        throw validationError_('Duplicate component code in section ' + structureSection + ': ' + code + '.');
      }
      seen[seenKey] = true;
      if (structureSection === HRMS.STRUCTURE_SECTION.EARNED_PAY) {
        if (method !== HRMS.CALC_METHOD.PRORATE_ROUND_LINE &&
            method !== HRMS.CALC_METHOD.PRORATE_FACTOR) {
          throw validationError_(code + ': earned pay lines must use PRORATE_ROUND_LINE or PRORATE_FACTOR.');
        }
        if (method === HRMS.CALC_METHOD.PRORATE_FACTOR) {
          method = HRMS.CALC_METHOD.PRORATE_ROUND_LINE;
        }
        kind = HRMS.COMPONENT_KIND.EARNING;
      }
      if (method === HRMS.CALC_METHOD.BALANCE_OF_CTC && kind !== HRMS.COMPONENT_KIND.EARNING) {
        throw validationError_(code + ': Remainder of CTC is only for EARNING lines.');
      }
      var percent = '';
      var amount = '';
      var capAmount = '';
      var condRef = trim_(c.cond_ref).toUpperCase();
      var condOp = trim_(c.cond_op).toUpperCase();
      var condValue = c.cond_value === '' || c.cond_value == null ? '' : Number(c.cond_value);
      var roundMode = trim_(c.round_mode).toUpperCase() || HRMS.FORMULA_ROUND.ROUND;
      if (method === HRMS.CALC_METHOD.BALANCE_OF_CTC) {
        percent = '';
        amount = '';
        percentBase = '';
      } else if (method === HRMS.CALC_METHOD.MANUAL) {
        percent = '';
        amount = '';
        percentBase = '';
      } else if (method === HRMS.CALC_METHOD.PRORATE_ROUND_LINE ||
                 method === HRMS.CALC_METHOD.PRORATE_FACTOR) {
        percent = '';
        amount = '';
        percentBase = '';
      } else if (method === HRMS.CALC_METHOD.PERCENT || method === HRMS.CALC_METHOD.PERCENT_CAPPED) {
        percent = parseNonNegative_(c.percent, code + ' percent');
        if (!percentBase) percentBase = HRMS.PERCENT_BASE_CTC;
        if (method === HRMS.CALC_METHOD.PERCENT && percentBase === HRMS.PERCENT_BASE_CTC && percent > 100) {
          throw validationError_(code + ': percent of CTC cannot exceed 100.');
        }
        if (percentBase !== HRMS.PERCENT_BASE_CTC &&
            percentBase !== HRMS.FORMULA_REF.RATE_GROSS &&
            percentBase !== HRMS.FORMULA_REF.EARNED_GROSS &&
            !codesSoFar[percentBase]) {
          throw validationError_(code + ': base "' + percentBase + '" must be defined above or be a formula ref.');
        }
        if (method === HRMS.CALC_METHOD.PERCENT_CAPPED) {
          capAmount = parseNonNegative_(c.cap_amount, code + ' cap');
        }
      } else if (method === HRMS.CALC_METHOD.PERCENT_IF) {
        percent = parseNonNegative_(c.percent, code + ' percent');
        if (!condRef) throw validationError_(code + ': condition reference is required.');
        if (!condOp) condOp = 'LT';
        condValue = parseNonNegative_(c.cond_value, code + ' condition value');
        if (!percentBase) percentBase = HRMS.FORMULA_REF.EARNED_GROSS;
      } else if (method === HRMS.CALC_METHOD.THRESHOLD_FEE) {
        amount = parseNonNegative_(c.amount, code + ' fee amount');
        if (!condRef) condRef = HRMS.FORMULA_REF.EARNED_GROSS;
        if (!condOp) condOp = 'LTE';
        condValue = parseNonNegative_(c.cond_value, code + ' threshold');
      } else if (method === HRMS.CALC_METHOD.FIXED) {
        amount = parseNonNegative_(c.amount, code + ' amount');
        percentBase = '';
      } else {
        throw validationError_(code + ': unsupported calc_method.');
      }
      out.push({
        component_code: code,
        component_name: name,
        component_kind: kind,
        structure_section: structureSection,
        calc_method: method,
        percent: percent,
        amount: amount,
        percent_base: percentBase,
        cap_amount: capAmount,
        cond_ref: condRef,
        cond_op: condOp,
        cond_value: condValue,
        round_mode: roundMode,
        sort_order: Number(c.sort_order != null ? c.sort_order : i + 1)
      });
      if (structureSection === HRMS.STRUCTURE_SECTION.RATE_OF_PAY) {
        codesSoFar[code] = true;
      }
      if (structureSection === HRMS.STRUCTURE_SECTION.EARNED_PAY && code !== '*' && code !== 'ALL') {
        /* per-line earned rules validated at payroll if rate code missing */
      }
    }
    var balanceCount = 0;
    rateOnly_(out).forEach(function (c) {
      if (c.calc_method === HRMS.CALC_METHOD.BALANCE_OF_CTC) balanceCount += 1;
    });
    if (balanceCount > 1) {
      throw validationError_('Only one EARNING component can use Remainder of CTC (balance).');
    }
    return out;
  }

  /** Non-blocking warning when expanded earnings do not match sample monthly CTC. */
  function earningsPercentWarning_(components) {
    if (typeof SalaryComponentExpandService !== 'undefined' &&
        SalaryComponentExpandService.earningsReconcileWarning) {
      return SalaryComponentExpandService.earningsReconcileWarning(rateOnly_(components), 50000);
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
      percent_base: String(c.percent_base || ''),
      structure_section: String(c.structure_section || ''),
      cap_amount: c.cap_amount === '' || c.cap_amount == null ? null : Number(c.cap_amount),
      cond_ref: String(c.cond_ref || ''),
      cond_op: String(c.cond_op || ''),
      cond_value: c.cond_value === '' || c.cond_value == null ? null : Number(c.cond_value),
      round_mode: String(c.round_mode || ''),
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
      currency: String(row.currency || 'INR'),
      payroll_rules_json: String(row.payroll_rules_json || defaultPayrollRules_())
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
        structure_section: c.structure_section || '',
        calc_method: c.calc_method,
        amount: c.amount,
        percent: c.percent,
        percent_base: c.percent_base || '',
        cap_amount: c.cap_amount,
        cond_ref: c.cond_ref || '',
        cond_op: c.cond_op || '',
        cond_value: c.cond_value,
        round_mode: c.round_mode || '',
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
    var payrollRules = trim_(payload.payroll_rules_json) || defaultPayrollRules_();
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
          payroll_rules_json: payrollRules,
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
          payroll_rules_json: payrollRules,
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

  /** Resolve a structure by its (case-insensitive) name - used by bulk upload. */
  function findTypeByName(name) {
    name = trim_(name).toUpperCase();
    if (!name) return null;
    var rows = DbService.getAllRecords(HRMS.SHEETS.SALARY_STRUCTURES).filter(isTypeRow_);
    return rows.filter(function (r) {
      return String(r.structure_name).trim().toUpperCase() === name;
    })[0] || null;
  }

  function getStructureTypeDefaults() {
    requireManage_();
    return {
      components: defaultTemplateComponents_(),
      payroll_rules_json: defaultPayrollRules_()
    };
  }

  return {
    listStructureTypes: listStructureTypes,
    getStructureType: getStructureType,
    getStructureTypeDefaults: getStructureTypeDefaults,
    listStructureTypeOptions: listStructureTypeOptions,
    saveStructureType: saveStructureType,
    setStructureTypeStatus: setStructureTypeStatus,
    findTypeById: findTypeById,
    findTypeByName: findTypeByName,
    isTypeRow: isTypeRow_
  };
})();
