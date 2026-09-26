/**
 * Salary structures and components (compensation history on SalaryStructures).
 */
var CompensationService = (function () {
  /** Default salary lines - all required on save/bulk; empty numeric cells become 0. */
  var REQUIRED_COMPONENT_SPECS_ = [
    { component_code: 'BASIC', component_name: 'Basic', component_kind: 'EARNING', calc_method: 'FIXED', sort_order: 1 },
    { component_code: 'HRA', component_name: 'HRA', component_kind: 'EARNING', calc_method: 'PERCENT_OF_BASIC', sort_order: 2 },
    { component_code: 'SA', component_name: 'Special allowance', component_kind: 'EARNING', calc_method: 'FIXED', sort_order: 3 },
    { component_code: 'PF', component_name: 'PF', component_kind: 'DEDUCTION', calc_method: 'PERCENT_OF_BASIC', sort_order: 4 },
    { component_code: 'ESI', component_name: 'ESI', component_kind: 'DEDUCTION', calc_method: 'FIXED', sort_order: 5 },
    { component_code: 'PT', component_name: 'Professional tax', component_kind: 'DEDUCTION', calc_method: 'FIXED', sort_order: 6 },
    { component_code: 'EMPLOYER_PF', component_name: 'Employer PF', component_kind: 'EMPLOYER', calc_method: 'PERCENT_OF_BASIC', sort_order: 7 }
  ];

  function requirePayrollAdmin_() {
    return PermissionService.require(HRMS.ACTIONS.PAYROLL_RUN);
  }

  function toDate_(v) {
    if (!v && v !== 0) return null;
    if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
      return new Date(v.getFullYear(), v.getMonth(), v.getDate());
    }
    var s = String(v).substring(0, 10);
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    var d = new Date(v);
    if (isNaN(d.getTime())) return null;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function dateKey_(d) {
    if (!d) return '';
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1);
    var day = String(d.getDate());
    if (m.length < 2) m = '0' + m;
    if (day.length < 2) day = '0' + day;
    return y + '-' + m + '-' + day;
  }

  function addDays_(d, n) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  }

  function normalizeEmployeeId_(employeeId) {
    return String(employeeId || '').trim().toUpperCase();
  }

  function employeeIdsMatch_(a, b) {
    return normalizeEmployeeId_(a) === normalizeEmployeeId_(b);
  }

  function getEmployee_(employeeId) {
    var emp = null;
    try {
      if (typeof EmployeeService !== 'undefined' && EmployeeService &&
          typeof EmployeeService.getMasterRecord === 'function') {
        emp = EmployeeService.getMasterRecord(employeeId);
      }
    } catch (ignore) {}
    if (!emp && typeof EmployeeRepository !== 'undefined' && EmployeeRepository.findById) {
      try {
        emp = EmployeeRepository.findById(employeeId);
      } catch (ignoreRepo) {}
    }
    if (emp) return emp;
    emp = DbService.findOne(HRMS.SHEETS.EMPLOYEES, { employee_id: employeeId });
    if (emp) return emp;
    var norm = normalizeEmployeeId_(employeeId);
    if (!norm) return null;
    var all = DbService.getAllRecords(HRMS.SHEETS.EMPLOYEES) || [];
    for (var i = 0; i < all.length; i++) {
      if (normalizeEmployeeId_(all[i].employee_id) === norm) return all[i];
    }
    return null;
  }

  function isUsablePayrollBundle_(bundle) {
    if (!bundle || !bundle.components || !bundle.components.length) return false;
    for (var i = 0; i < bundle.components.length; i++) {
      var c = bundle.components[i];
      if (String(c.component_kind || '').toUpperCase() !== HRMS.COMPONENT_KIND.EARNING) continue;
      var method = String(c.calc_method || '').toUpperCase();
      if (method === HRMS.CALC_METHOD.PERCENT_OF_BASIC && Number(c.percent) > 0) return true;
      if (Number(c.amount) > 0) return true;
    }
    return false;
  }

  function serializeClientValue_(value) {
    if (value == null || value === '') return value === 0 ? 0 : '';
    if (Object.prototype.toString.call(value) === '[object Date]') {
      if (isNaN(value.getTime())) return '';
      try {
        return Utilities.formatDate(value, Session.getScriptTimeZone() || 'Asia/Kolkata', 'yyyy-MM-dd');
      } catch (ignore) {
        return String(value);
      }
    }
    if (typeof value === 'object') return String(value);
    return value;
  }

  function serializeClientRow_(row) {
    if (!row) return row;
    var out = {};
    Object.keys(row).forEach(function (key) {
      out[key] = serializeClientValue_(row[key]);
    });
    return out;
  }

  function serializeEditorBundle_(bundle) {
    var current = null;
    if (bundle.current) {
      current = {
        can_edit_in_place: bundle.current.can_edit_in_place !== false,
        structure: serializeClientRow_(bundle.current.structure),
        components: (bundle.current.components || []).map(serializeClientRow_)
      };
    }
    return {
      employee_id: String(bundle.employee_id || ''),
      employee: serializeClientRow_(bundle.employee),
      current: current,
      history: (bundle.history || []).map(serializeClientRow_)
    };
  }

  function listStructures(employeeId) {
    requirePayrollAdmin_();
    employeeId = String(employeeId || '').trim();
    if (!employeeId) throw validationError_('employee_id is required.');
    var rows = DbService.findRecords(HRMS.SHEETS.SALARY_STRUCTURES, { employee_id: employeeId });
    rows.sort(function (a, b) {
      return String(b.effective_from).localeCompare(String(a.effective_from));
    });
    return rows;
  }

  function getStructure(structureId) {
    requirePayrollAdmin_();
    return loadStructureBundle_(structureId, true);
  }

  function getCurrentForEmployee(employeeId) {
    requirePayrollAdmin_();
    employeeId = String(employeeId || '').trim();
    if (!employeeId) throw validationError_('employee_id is required.');
    var bundle = getCurrentBundle_(employeeId, true);
    if (!bundle) return null;
    bundle.can_edit_in_place = !isReferencedInLockedPayroll_(bundle.structure.salary_structure_id);
    return bundle;
  }

  function getEditorBundle(employeeId) {
    requirePayrollAdmin_();
    employeeId = String(employeeId || '').trim();
    if (!employeeId) throw validationError_('employee_id is required.');
    try {
      var emp = getEmployee_(employeeId);
      if (!emp) throw notFoundError_('Employee not found: ' + employeeId);
      var current = getCurrentBundle_(employeeId, false);
      if (current) {
        delete current.employee;
        current.can_edit_in_place = !isReferencedInLockedPayroll_(current.structure.salary_structure_id);
      }
      var history = DbService.findRecords(HRMS.SHEETS.SALARY_STRUCTURES, { employee_id: employeeId });
      history.sort(function (a, b) {
        return String(b.effective_from).localeCompare(String(a.effective_from));
      });
      return serializeEditorBundle_({
        employee_id: employeeId,
        current: current,
        history: history,
        employee: publicEmployee_(emp, false)
      });
    } catch (e) {
      if (e.hrmsCode) throw e;
      Logger.log('getEditorBundle failed for ' + employeeId + ': ' + (e.message || e) + '\n' + (e.stack || ''));
      throw systemError_('Could not load salary structure. ' + (e.message || 'Please try again.'));
    }
  }

  function getOwnCurrentStructure() {
    var session = PermissionService.require(HRMS.ACTIONS.VIEW_OWN_PAYSLIP);
    var employeeId = String(session.employee_id || '').trim();
    if (!employeeId) return null;
    var bundle = getCurrentBundle_(employeeId, false);
    if (!bundle) return null;
    return sanitizeOwnStructure_(bundle);
  }

  function isTypeStructureRow_(row) {
    return !!row && String(row.employee_id || '').trim() === '' &&
      String(row.structure_name || '').trim() !== '';
  }

  function findTypeStructureByRef_(ref) {
    ref = String(ref || '').trim();
    if (!ref) return null;
    var row = DbService.findOne(HRMS.SHEETS.SALARY_STRUCTURES, { salary_structure_id: ref });
    if (row && isTypeStructureRow_(row)) return row;
    var norm = ref.toUpperCase();
    var types = (DbService.getAllRecords(HRMS.SHEETS.SALARY_STRUCTURES) || []).filter(isTypeStructureRow_);
    for (var i = 0; i < types.length; i++) {
      var t = types[i];
      if (String(t.salary_structure_id || '').toUpperCase() === norm) return t;
      if (String(t.structure_name || '').toUpperCase() === norm) return t;
    }
    return null;
  }

  function componentAmountFromCtc_(component, ctcMonthly) {
    var method = String(component.calc_method || '').toUpperCase();
    var ctc = Number(ctcMonthly) || 0;
    if (method === HRMS.CALC_METHOD.PERCENT_OF_CTC) {
      return Math.round(ctc * (Number(component.percent) || 0) / 100 * 100) / 100;
    }
    return Number(component.amount) || 0;
  }

  function componentsFromTypeTemplate_(typeStructureId, ctcMonthly) {
    var raw = DbService.findRecords(HRMS.SHEETS.SALARY_COMPONENTS, { salary_structure_id: typeStructureId }) || [];
    if (!raw.length) return [];
    return raw.map(function (c) {
      var method = String(c.calc_method || '').toUpperCase();
      var code = String(c.component_code || '').toUpperCase();
      if (code === 'BP') code = 'BASIC';
      var out = {
        component_code: code,
        component_name: c.component_name,
        component_kind: c.component_kind,
        calc_method: c.calc_method,
        amount: c.amount,
        percent: c.percent,
        sort_order: c.sort_order
      };
      if (method === HRMS.CALC_METHOD.PERCENT_OF_CTC) {
        out.calc_method = HRMS.CALC_METHOD.FIXED;
        out.amount = componentAmountFromCtc_(c, ctcMonthly);
        out.percent = '';
      }
      return out;
    });
  }

  function getStructureFromEmployeeTemplate_(employeeId) {
    var emp = getEmployee_(employeeId);
    if (!emp) return null;
    var typeRow = findTypeStructureByRef_(emp.salary_structure_id);
    var ctc = Number(emp.ctc_monthly);
    if (!typeRow || !isFinite(ctc) || ctc <= 0) return null;
    var components = componentsFromTypeTemplate_(typeRow.salary_structure_id, ctc);
    if (!components.length) return null;
    return {
      structure: {
        salary_structure_id: typeRow.salary_structure_id,
        employee_id: employeeId,
        structure_name: typeRow.structure_name,
        status: HRMS.STRUCTURE_STATUS.CURRENT,
        ctc_monthly: ctc,
        effective_from: '',
        effective_to: ''
      },
      components: components,
      from_type_template: true
    };
  }

  function getStructureInForceFromHistory_(employeeId, periodEndDate) {
    var end = toDate_(periodEndDate);
    var rows = (DbService.getAllRecords(HRMS.SHEETS.SALARY_STRUCTURES) || []).filter(function (row) {
      if (isTypeStructureRow_(row)) return false;
      return employeeIdsMatch_(row.employee_id, employeeId);
    });
    var matches = [];
    (rows || []).forEach(function (row) {
      var from = toDate_(row.effective_from);
      if (!from) {
        from = new Date(2000, 0, 1);
      }
      var to = toDate_(row.effective_to);
      if (!end) return;
      if (from > end) return;
      if (to && to < end) return;
      matches.push(row);
    });
    matches.sort(function (a, b) {
      return toDate_(b.effective_from) - toDate_(a.effective_from);
    });
    if (!matches.length) return null;
    var components = DbService.findRecords(HRMS.SHEETS.SALARY_COMPONENTS, {
      salary_structure_id: matches[0].salary_structure_id
    });
    if (!components.length) return null;
    return {
      structure: matches[0],
      components: components
    };
  }

  function getStructureInForce(employeeId, periodEndDate) {
    employeeId = String(employeeId || '').trim();
    var ids = [employeeId];
    var norm = normalizeEmployeeId_(employeeId);
    if (norm && ids.indexOf(norm) < 0) ids.push(norm);

    var historyBundle = null;
    var templateBundle = null;
    ids.forEach(function (id) {
      if (!historyBundle) historyBundle = getStructureInForceFromHistory_(id, periodEndDate);
      if (!templateBundle) templateBundle = getStructureFromEmployeeTemplate_(id);
    });

    if (historyBundle && isUsablePayrollBundle_(historyBundle)) return historyBundle;
    if (templateBundle && isUsablePayrollBundle_(templateBundle)) return templateBundle;
    return historyBundle || templateBundle;
  }

  /**
   * Human hint when payroll cannot find a structure for the month (saved but wrong dates, etc.).
   */
  function explainStructureGap(employeeId, periodEndDate) {
    employeeId = String(employeeId || '').trim();
    if (!employeeId) return '';
    var end = toDate_(periodEndDate);
    if (!end) return '';
    if (getStructureInForce(employeeId, periodEndDate)) return '';

    var rows = DbService.findRecords(HRMS.SHEETS.SALARY_STRUCTURES, { employee_id: employeeId });
    if (!rows.length) {
      if (getStructureFromEmployeeTemplate_(employeeId)) return '';
      var emp = getEmployee_(employeeId);
      if (emp && String(emp.salary_structure_id || '').trim() && Number(emp.ctc_monthly) > 0) {
        return 'Salary structure template is set but components could not be loaded. Check the template in Salary structures.';
      }
      return 'Assign a salary structure template and monthly CTC on the employee, or use Set up salary with a BASIC line.';
    }

    var current = DbService.findOne(HRMS.SHEETS.SALARY_STRUCTURES, {
      employee_id: employeeId,
      status: HRMS.STRUCTURE_STATUS.CURRENT
    });
    if (current) {
      var comps = DbService.findRecords(HRMS.SHEETS.SALARY_COMPONENTS, {
        salary_structure_id: current.salary_structure_id
      });
      if (!comps.length) {
        return 'A structure exists but has no salary components. Add BASIC and save again.';
      }
      var from = toDate_(current.effective_from);
      if (from && from > end) {
        return 'Structure effective from ' + dateKey_(from) +
          ' is after this payroll month (ends ' + dateKey_(end) + '). Set an earlier effective date.';
      }
    }

    var latest = rows.slice().sort(function (a, b) {
      return String(b.effective_from).localeCompare(String(a.effective_from));
    })[0];
    if (latest) {
      var latestFrom = toDate_(latest.effective_from);
      if (latestFrom && latestFrom > end) {
        return 'Latest structure starts ' + dateKey_(latestFrom) +
          ', after this payroll month (ends ' + dateKey_(end) + ').';
      }
    }
    return 'No structure covers this payroll month. Check effective dates and click Recalculate payroll.';
  }

  function saveStructure(payload) {
    var session = requirePayrollAdmin_();
    payload = payload || {};
    var employeeId = String(payload.employee_id || '').trim();
    if (!employeeId) throw validationError_('employee_id is required.');
    var emp = getEmployee_(employeeId);
    if (!emp) throw notFoundError_('Employee not found: ' + employeeId);

    return withScriptLock_(function () {
      var current = DbService.findOne(HRMS.SHEETS.SALARY_STRUCTURES, {
        employee_id: employeeId,
        status: HRMS.STRUCTURE_STATUS.CURRENT
      });

      if (!toDate_(payload.effective_from)) {
        throw validationError_('effective_from is required.');
      }
      var components = normalizeComponents_(payload.components);
      var effectiveFrom = toDate_(payload.effective_from);
      var ctc = parseCtc_(payload.ctc_monthly, true);
      var now = new Date();

      if (current) {
        if (isReferencedInLockedPayroll_(current.salary_structure_id)) {
          throw conflictError_('This structure is used in a LOCKED payroll run. Create a revision instead.');
        }
        replaceComponents_(current.salary_structure_id, components);
        var updates = {
          approved_by_email: session.email
        };
        if (payload.ctc_monthly !== undefined) updates.ctc_monthly = ctc;
        if (payload.effective_from) updates.effective_from = effectiveFrom;
        DbService.updateRecord(HRMS.SHEETS.SALARY_STRUCTURES, 'salary_structure_id', current.salary_structure_id, updates);
        AuditService.log(HRMS.AUDIT_ACTIONS.SALARY_SAVE, 'SalaryStructures', current.salary_structure_id,
          'Updated CURRENT structure for ' + employeeId, employeeId);
        return loadStructureBundle_(current.salary_structure_id, true);
      }

      var id = DbService.generateId('SS');
      DbService.insertRecord(HRMS.SHEETS.SALARY_STRUCTURES, {
        salary_structure_id: id,
        employee_id: employeeId,
        effective_from: effectiveFrom,
        effective_to: '',
        status: HRMS.STRUCTURE_STATUS.CURRENT,
        ctc_monthly: ctc,
        currency: 'INR',
        previous_structure_id: '',
        revision_reason: '',
        approved_by_email: session.email,
        created_at: now,
        created_by_email: session.email
      });
      insertComponents_(id, components);
      AuditService.log(HRMS.AUDIT_ACTIONS.SALARY_SAVE, 'SalaryStructures', id,
        'Created CURRENT structure for ' + employeeId, employeeId);
      return loadStructureBundle_(id, true);
    });
  }

  function reviseStructure(payload) {
    var session = requirePayrollAdmin_();
    payload = payload || {};
    var employeeId = String(payload.employee_id || '').trim();
    var reason = String(payload.revision_reason || '').trim();
    if (!employeeId) throw validationError_('employee_id is required.');
    if (!reason) throw validationError_('revision_reason is required.');
    var emp = getEmployee_(employeeId);
    if (!emp) throw notFoundError_('Employee not found: ' + employeeId);

    return withScriptLock_(function () {
      var current = DbService.findOne(HRMS.SHEETS.SALARY_STRUCTURES, {
        employee_id: employeeId,
        status: HRMS.STRUCTURE_STATUS.CURRENT
      });
      if (!current) {
        throw validationError_('No CURRENT structure to revise. Save a structure first.');
      }

      var newFrom = toDate_(payload.effective_from);
      if (!newFrom) throw validationError_('effective_from is required for a revision.');
      var oldFrom = toDate_(current.effective_from);
      if (oldFrom && newFrom <= oldFrom) {
        throw validationError_('Revision effective_from must be after the current structure start.');
      }

      var components = normalizeComponents_(payload.components);
      var ctc = parseCtc_(payload.ctc_monthly, true);
      var now = new Date();
      var newId = DbService.generateId('SS');
      var oldTo = addDays_(newFrom, -1);

      DbService.updateRecord(HRMS.SHEETS.SALARY_STRUCTURES, 'salary_structure_id', current.salary_structure_id, {
        status: HRMS.STRUCTURE_STATUS.SUPERSEDED,
        effective_to: oldTo
      });

      DbService.insertRecord(HRMS.SHEETS.SALARY_STRUCTURES, {
        salary_structure_id: newId,
        employee_id: employeeId,
        effective_from: newFrom,
        effective_to: '',
        status: HRMS.STRUCTURE_STATUS.CURRENT,
        ctc_monthly: ctc === '' ? (current.ctc_monthly || '') : ctc,
        currency: 'INR',
        previous_structure_id: current.salary_structure_id,
        revision_reason: reason,
        approved_by_email: session.email,
        created_at: now,
        created_by_email: session.email
      });
      insertComponents_(newId, components);
      AuditService.log(HRMS.AUDIT_ACTIONS.SALARY_REVISE, 'SalaryStructures', newId,
        'Revised structure for ' + employeeId + ' (previous ' + current.salary_structure_id + ')', employeeId);
      return loadStructureBundle_(newId, true);
    });
  }

  function listEmployeeOptions() {
    requirePayrollAdmin_();
    var currentByEmp = {};
    DbService.getAllRecords(HRMS.SHEETS.SALARY_STRUCTURES).forEach(function (s) {
      if (String(s.status || '').toUpperCase() === HRMS.STRUCTURE_STATUS.CURRENT) {
        currentByEmp[s.employee_id] = true;
      }
    });
    var rows = typeof EmployeeRepository !== 'undefined' && EmployeeRepository.listAll
      ? EmployeeRepository.listAll()
      : DbService.getAllRecords(HRMS.SHEETS.EMPLOYEES);
    return (rows || []).map(function (e) {
      return {
        employee_id: e.employee_id,
        display_name: e.display_name || ((e.first_name || '') + ' ' + (e.last_name || '')).trim(),
        first_name: e.first_name || '',
        last_name: e.last_name || '',
        work_email: e.work_email || '',
        department: e.department || '',
        designation: e.designation || '',
        status: e.status || '',
        has_current_structure: !!currentByEmp[e.employee_id]
      };
    });
  }

  function loadStructureBundle_(structureId, includeSensitive) {
    var structure = DbService.findOne(HRMS.SHEETS.SALARY_STRUCTURES, { salary_structure_id: structureId });
    if (!structure) throw notFoundError_('Salary structure not found.');
    var components = DbService.findRecords(HRMS.SHEETS.SALARY_COMPONENTS, { salary_structure_id: structureId });
    components.sort(function (a, b) {
      return Number(a.sort_order || 0) - Number(b.sort_order || 0);
    });
    var emp = getEmployee_(structure.employee_id);
    return {
      structure: structure,
      components: components,
      employee: emp ? publicEmployee_(emp, includeSensitive) : { employee_id: structure.employee_id }
    };
  }

  function getCurrentBundle_(employeeId, includeSensitive) {
    var current = DbService.findOne(HRMS.SHEETS.SALARY_STRUCTURES, {
      employee_id: employeeId,
      status: HRMS.STRUCTURE_STATUS.CURRENT
    });
    if (!current) return null;
    return loadStructureBundle_(current.salary_structure_id, includeSensitive);
  }

  function publicEmployee_(emp, includeSensitive) {
    var out = {
      employee_id: emp.employee_id,
      display_name: emp.display_name || ((emp.first_name || '') + ' ' + (emp.last_name || '')).trim(),
      department: emp.department || '',
      designation: emp.designation || '',
      status: emp.status || '',
      joining_date: emp.joining_date || ''
    };
    if (includeSensitive) {
      out.has_bank = PayrollEngine.hasBank(emp);
      out.has_pan = !!String(emp.pan || '').trim();
    }
    return out;
  }

  function sanitizeOwnStructure_(bundle) {
    return {
      structure: {
        salary_structure_id: String(bundle.structure.salary_structure_id || ''),
        employee_id: String(bundle.structure.employee_id || ''),
        effective_from: serializeClientValue_(bundle.structure.effective_from),
        status: String(bundle.structure.status || ''),
        currency: String(bundle.structure.currency || ''),
        ctc_monthly: bundle.structure.ctc_monthly == null || bundle.structure.ctc_monthly === ''
          ? null
          : Number(bundle.structure.ctc_monthly)
      },
      components: (bundle.components || []).map(function (c) {
        return {
          component_code: String(c.component_code || ''),
          component_name: String(c.component_name || ''),
          component_kind: String(c.component_kind || ''),
          calc_method: String(c.calc_method || ''),
          amount: c.amount == null || c.amount === '' ? null : Number(c.amount),
          percent: c.percent == null || c.percent === '' ? null : Number(c.percent),
          sort_order: Number(c.sort_order || 0)
        };
      })
    };
  }

  function parseCtc_(value, required) {
    if (value === '' || value == null) {
      if (required) return 0;
      return '';
    }
    var n = Number(value);
    if (!isFinite(n)) throw validationError_('ctc_monthly must be a number.');
    if (n < 0) throw validationError_('ctc_monthly cannot be negative.');
    return n;
  }

  function parseNumericOrZero_(value, field) {
    if (value === '' || value == null) return 0;
    var n = Number(value);
    if (!isFinite(n)) throw validationError_(field + ' must be a valid number.');
    if (n < 0) throw validationError_(field + ' cannot be negative.');
    return n;
  }

  function buildComponentsFromBulkRow_(row) {
    row = row || {};
    return REQUIRED_COMPONENT_SPECS_.map(function (spec) {
      var code = spec.component_code;
      var bulkKey = {
        BASIC: 'basic',
        HRA: 'hra_percent',
        SA: 'sa',
        PF: 'pf_percent',
        ESI: 'esi',
        PT: 'pt',
        EMPLOYER_PF: 'employer_pf_percent'
      }[code];
      var out = {
        component_code: code,
        component_name: spec.component_name,
        component_kind: spec.component_kind,
        calc_method: spec.calc_method,
        sort_order: spec.sort_order
      };
      if (spec.calc_method === HRMS.CALC_METHOD.FIXED) {
        out.amount = parseNumericOrZero_(row[bulkKey], bulkKey);
        out.percent = '';
      } else {
        out.amount = '';
        out.percent = parseNumericOrZero_(row[bulkKey], bulkKey);
      }
      return out;
    });
  }

  function ensureRequiredComponents_(list) {
    var byCode = {};
    (list || []).forEach(function (c) {
      var code = String(c.component_code || '').trim().toUpperCase();
      if (code) byCode[code] = c;
    });
    return REQUIRED_COMPONENT_SPECS_.map(function (spec) {
      var existing = byCode[spec.component_code];
      if (existing) return existing;
      return {
        component_code: spec.component_code,
        component_name: spec.component_name,
        component_kind: spec.component_kind,
        calc_method: spec.calc_method,
        amount: spec.calc_method === HRMS.CALC_METHOD.FIXED ? 0 : '',
        percent: spec.calc_method === HRMS.CALC_METHOD.PERCENT_OF_BASIC ? 0 : '',
        sort_order: spec.sort_order
      };
    });
  }

  function normalizeComponents_(list) {
    list = ensureRequiredComponents_(list);
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      var code = String(c.component_code || '').trim().toUpperCase();
      var name = String(c.component_name || '').trim();
      var kind = String(c.component_kind || '').trim().toUpperCase();
      var method = String(c.calc_method || '').trim().toUpperCase();
      if (!code || !name) throw validationError_('Each component needs component_code and component_name.');
      if (kind !== 'EARNING' && kind !== 'DEDUCTION' && kind !== 'EMPLOYER') {
        throw validationError_('component_kind must be EARNING, DEDUCTION, or EMPLOYER.');
      }
      if (method !== HRMS.CALC_METHOD.FIXED && method !== HRMS.CALC_METHOD.PERCENT_OF_BASIC) {
        throw validationError_('calc_method must be FIXED or PERCENT_OF_BASIC.');
      }
      out.push({
        component_code: code,
        component_name: name,
        component_kind: kind,
        calc_method: method,
        amount: method === HRMS.CALC_METHOD.FIXED ? parseNumericOrZero_(c.amount, code + ' amount') : '',
        percent: method === HRMS.CALC_METHOD.PERCENT_OF_BASIC ? parseNumericOrZero_(c.percent, code + ' percent') : '',
        sort_order: Number(c.sort_order != null ? c.sort_order : i + 1)
      });
    }
    return out;
  }

  function insertComponents_(structureId, components) {
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
    DbService.insertRecords(HRMS.SHEETS.SALARY_COMPONENTS, rows);
  }

  function replaceComponents_(structureId, components) {
    var rows = (components || []).map(function (c) {
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

  function isReferencedInLockedPayroll_(structureId) {
    var records = DbService.findRecords(HRMS.SHEETS.PAYROLL_RECORDS, { salary_structure_id: structureId });
    if (!records.length) return false;
    var locked = {};
    DbService.findRecords(HRMS.SHEETS.PAYROLL_RUNS, { status: HRMS.PAYROLL_STATUS.LOCKED }).forEach(function (r) {
      locked[r.payroll_run_id] = true;
    });
    return records.some(function (rec) { return locked[rec.payroll_run_id]; });
  }

  return {
    expandTypeTemplateComponents: componentsFromTypeTemplate_,
    listStructures: listStructures,
    listEmployeeOptions: listEmployeeOptions,
    getStructure: getStructure,
    getCurrentForEmployee: getCurrentForEmployee,
    getEditorBundle: getEditorBundle,
    getOwnCurrentStructure: getOwnCurrentStructure,
    getStructureInForce: getStructureInForce,
    isPayrollStructureReady: isUsablePayrollBundle_,
    explainStructureGap: explainStructureGap,
    saveStructure: saveStructure,
    reviseStructure: reviseStructure,
    getEmployee: getEmployee_,
    REQUIRED_COMPONENT_SPECS: REQUIRED_COMPONENT_SPECS_,
    buildComponentsFromBulkRow: buildComponentsFromBulkRow_,
    ensureRequiredComponents: ensureRequiredComponents_,
    parseNumericOrZero: parseNumericOrZero_
  };
})();
