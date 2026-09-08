/**
 * Salary structures and components (compensation history on SalaryStructures).
 */
var CompensationService = (function () {
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

  function getEmployee_(employeeId) {
    var emp = null;
    try {
      if (typeof EmployeeService !== 'undefined' && EmployeeService &&
          typeof EmployeeService.getMasterRecord === 'function') {
        emp = EmployeeService.getMasterRecord(employeeId);
      }
    } catch (ignore) {}
    if (emp) return emp;
    return DbService.findOne(HRMS.SHEETS.EMPLOYEES, { employee_id: employeeId });
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
    var bundle = getCurrentBundle_(session.employee_id, false);
    if (!bundle) return null;
    return sanitizeOwnStructure_(bundle);
  }

  function getStructureInForce(employeeId, periodEndDate) {
    var end = toDate_(periodEndDate);
    var rows = DbService.findRecords(HRMS.SHEETS.SALARY_STRUCTURES, { employee_id: employeeId });
    var matches = [];
    (rows || []).forEach(function (row) {
      var from = toDate_(row.effective_from);
      var to = toDate_(row.effective_to);
      if (!from || !end) return;
      if (from > end) return;
      if (to && to < end) return;
      matches.push(row);
    });
    matches.sort(function (a, b) {
      return toDate_(b.effective_from) - toDate_(a.effective_from);
    });
    if (!matches.length) return null;
    return {
      structure: matches[0],
      components: DbService.findRecords(HRMS.SHEETS.SALARY_COMPONENTS, {
        salary_structure_id: matches[0].salary_structure_id
      })
    };
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

      var components = normalizeComponents_(payload.components);
      var effectiveFrom = toDate_(payload.effective_from) || new Date();
      var ctc = parseCtc_(payload.ctc_monthly);
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
      var ctc = parseCtc_(payload.ctc_monthly);
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
        salary_structure_id: bundle.structure.salary_structure_id,
        employee_id: bundle.structure.employee_id,
        effective_from: bundle.structure.effective_from,
        status: bundle.structure.status,
        currency: bundle.structure.currency,
        ctc_monthly: bundle.structure.ctc_monthly
      },
      components: (bundle.components || []).map(function (c) {
        return {
          component_code: c.component_code,
          component_name: c.component_name,
          component_kind: c.component_kind,
          calc_method: c.calc_method,
          amount: c.amount,
          percent: c.percent,
          sort_order: c.sort_order
        };
      })
    };
  }

  function parseCtc_(value) {
    if (value === '' || value == null) return '';
    var n = Number(value);
    if (!isFinite(n)) throw validationError_('ctc_monthly must be a number.');
    if (n < 0) throw validationError_('ctc_monthly cannot be negative.');
    return n;
  }

  function normalizeComponents_(list) {
    if (!list || !list.length) {
      throw validationError_('At least one salary component is required.');
    }
    var out = [];
    var hasBasic = false;
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
      if (code === 'BASIC') hasBasic = true;
      out.push({
        component_code: code,
        component_name: name,
        component_kind: kind,
        calc_method: method,
        amount: method === HRMS.CALC_METHOD.FIXED ? Number(c.amount) || 0 : '',
        percent: method === HRMS.CALC_METHOD.PERCENT_OF_BASIC ? Number(c.percent) || 0 : '',
        sort_order: Number(c.sort_order != null ? c.sort_order : i + 1)
      });
    }
    if (!hasBasic) {
      throw validationError_('A BASIC earning component is required.');
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
    DbService.deleteRecords(HRMS.SHEETS.SALARY_COMPONENTS, { salary_structure_id: structureId });
    insertComponents_(structureId, components);
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
    listStructures: listStructures,
    listEmployeeOptions: listEmployeeOptions,
    getStructure: getStructure,
    getCurrentForEmployee: getCurrentForEmployee,
    getEditorBundle: getEditorBundle,
    getOwnCurrentStructure: getOwnCurrentStructure,
    getStructureInForce: getStructureInForce,
    saveStructure: saveStructure,
    reviseStructure: reviseStructure,
    getEmployee: getEmployee_
  };
})();
