/**
 * Payroll run workflow, inputs, calculate, lock, correction.
 * All math via PayrollEngine. LOCKED rows are never rewritten after status is set.
 */
var PayrollService = (function () {
  function requireHr_(session) {
    return PermissionService.require(HRMS.ACTIONS.PAYROLL_RUN, {}, session);
  }

  function firePayrollNotify_(fn) {
    try {
      if (typeof NotificationPayrollAdapter === 'undefined') return;
      fn();
    } catch (e) {
      Logger.log('Payroll notify: ' + (e.message || e));
    }
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

  function periodEnd_(year, month) {
    return new Date(Number(year), Number(month), 0);
  }

  function padMonth_(month) {
    var m = String(Number(month));
    if (m.length < 2) m = '0' + m;
    return m;
  }

  function num_(v) {
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }

  function hasCompleteAttendance_(inp) {
    if (!inp) return false;
    var w = num_(inp.working_days);
    var p = num_(inp.paid_days);
    var l = num_(inp.lop_days);
    return w > 0 && p >= 0 && l >= 0 && Math.abs(p + l - w) < 0.001;
  }

  function assertAttendanceComplete_(inputs) {
    inputs = inputs || [];
    if (!inputs.length) {
      throw validationError_('No employees in this payroll run. Sync eligible employees first.');
    }
    var incomplete = inputs.filter(function (inp) { return !hasCompleteAttendance_(inp); });
    if (incomplete.length) {
      throw validationError_('Attendance is incomplete for ' + incomplete.length +
        ' of ' + inputs.length + ' employees. Upload or save working days, paid days, and LOP before calculating.');
    }
  }

  function parseRequiredNumber_(value, field, employeeId) {
    var n = Number(value);
    if (value === '' || value == null || !isFinite(n)) {
      throw validationError_(field + ' must be a number for ' + employeeId + '.');
    }
    return n;
  }

  function parseOptionalAmount_(value, field, employeeId) {
    if (value === '' || value == null) return 0;
    var n = Number(value);
    if (!isFinite(n)) {
      throw validationError_(field + ' must be a number for ' + employeeId + '.');
    }
    return n;
  }

  function serializeDateTime_(value) {
    if (value === null || value === undefined || value === '') return '';
    if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
      return value.toISOString();
    }
    return String(value);
  }

  var PAYROLL_RUN_DATE_FIELDS_ = ['calculated_at', 'approved_at', 'locked_at', 'created_at'];
  var PAYROLL_RECORD_DATE_FIELDS_ = ['calculated_at'];

  function serializeSheetRow_(row, dateFields) {
    if (!row) return row;
    var out = {};
    Object.keys(row).forEach(function (k) {
      out[k] = dateFields.indexOf(k) >= 0 ? serializeDateTime_(row[k]) : row[k];
    });
    return out;
  }

  function serializeRun_(run) {
    return serializeSheetRow_(run, PAYROLL_RUN_DATE_FIELDS_);
  }

  function humanizeExceptionFlag_(flag) {
    var key = String(flag || '').toUpperCase();
    var map = {
      MISSING_STRUCTURE: 'Salary structure is not configured.',
      MISSING_BANK: 'Bank account is missing.',
      MISSING_PAN: 'PAN number is missing.',
      NEGATIVE_NET: 'Net pay is negative.',
      WORKING_DAYS_ZERO: 'Working days must be greater than zero.'
    };
    return map[key] || String(flag || '');
  }

  function humanizeLockBlock_(block) {
    var text = String(block || '');
    var codeMatch = text.match(/^(MISSING_STRUCTURE|MISSING_BANK|MISSING_PAN|NEGATIVE_NET|WORKING_DAYS_ZERO)/);
    if (codeMatch) {
      var base = humanizeExceptionFlag_(codeMatch[1]);
      var countMatch = text.match(/\((\d+)\)/);
      return countMatch ? base + ' (' + countMatch[1] + ' employee' + (Number(countMatch[1]) === 1 ? '' : 's') + ')' : base;
    }
    if (text === 'No calculated records') return 'Payroll has not been calculated yet.';
    return text;
  }

  function uiPhaseForStatus_(status) {
    var st = String(status || '').toUpperCase();
    if (st === HRMS.PAYROLL_STATUS.LOCKED) return 'FINALIZED';
    if (st === HRMS.PAYROLL_STATUS.APPROVED) return 'REVIEW';
    if (st === HRMS.PAYROLL_STATUS.UNDER_REVIEW) return 'REVIEW';
    if (st === HRMS.PAYROLL_STATUS.CALCULATED) return 'REVIEW';
    return 'PREPARE';
  }

  function uiPhaseLabel_(phase) {
    if (phase === 'FINALIZED') return 'Finalized';
    if (phase === 'REVIEW') return 'Review';
    if (phase === 'CALCULATE') return 'Calculate';
    return 'Prepare';
  }

  function enrichExceptionMessage_(flag, employeeId, employees, periodEnd) {
    var emp = employees[employeeId] || {};
    var base = humanizeExceptionFlag_(flag);
    if (flag === HRMS.PAYROLL_EXCEPTION.MISSING_STRUCTURE && typeof CompensationService !== 'undefined' &&
        CompensationService.explainStructureGap) {
      var hint = CompensationService.explainStructureGap(employeeId, periodEnd);
      return hint ? base + ' ' + hint : base;
    }
    if (flag === HRMS.PAYROLL_EXCEPTION.MISSING_BANK) {
      var acc = String(emp.bank_account_number || '').trim();
      var ifsc = String(emp.bank_ifsc || '').trim();
      if (!acc && !ifsc) return base + ' Add bank account number and IFSC on the employee profile.';
      if (!acc) return base + ' Bank account number is missing.';
      if (!ifsc) return base + ' IFSC is missing.';
    }
    if (flag === HRMS.PAYROLL_EXCEPTION.MISSING_PAN) {
      return base + ' Add PAN on the employee profile (Personal or Payroll tab).';
    }
    return base;
  }

  function collectExceptionsHuman_(records, employees, periodEnd) {
    var list = [];
    (records || []).forEach(function (r) {
      if (!r.exception_flags) return;
      var flags = String(r.exception_flags).split(';').filter(Boolean);
      var emp = employees[r.employee_id] || {};
      list.push({
        employee_id: r.employee_id,
        display_name: emp.display_name || r.employee_id,
        flags: flags,
        messages: flags.map(function (flag) {
          return enrichExceptionMessage_(flag, r.employee_id, employees, periodEnd);
        })
      });
    });
    return list;
  }

  function buildFinalizeBlockers_(records, employees) {
    var groups = {};
    (records || []).forEach(function (r) {
      if (!r || !r.exception_flags) return;
      var emp = employees[r.employee_id] || {};
      var item = {
        employee_id: r.employee_id,
        display_name: emp.display_name || r.employee_id
      };
      String(r.exception_flags).split(';').filter(Boolean).forEach(function (flag) {
        var key = String(flag || '').toUpperCase();
        if (key !== HRMS.PAYROLL_EXCEPTION.MISSING_STRUCTURE &&
            key !== HRMS.PAYROLL_EXCEPTION.MISSING_BANK &&
            key !== HRMS.PAYROLL_EXCEPTION.MISSING_PAN &&
            key !== HRMS.PAYROLL_EXCEPTION.NEGATIVE_NET &&
            key !== HRMS.PAYROLL_EXCEPTION.WORKING_DAYS_ZERO) {
          return;
        }
        if (!groups[key]) groups[key] = [];
        if (!groups[key].some(function (x) { return x.employee_id === item.employee_id; })) {
          groups[key].push(item);
        }
      });
    });
    var blockStructure = ConfigService.getSetting('block_lock_missing_structure', true);
    var blockBank = ConfigService.getSetting('block_lock_missing_bank', true);
    var allowNeg = ConfigService.getSetting('allow_lock_negative_net', false);
    var out = [];
    function push(code, employeesList, blocked) {
      if (!blocked || !employeesList.length) return;
      out.push({
        code: code,
        message: humanizeExceptionFlag_(code),
        employees: employeesList
      });
    }
    push(HRMS.PAYROLL_EXCEPTION.MISSING_STRUCTURE, groups[HRMS.PAYROLL_EXCEPTION.MISSING_STRUCTURE] || [], blockStructure);
    push(HRMS.PAYROLL_EXCEPTION.MISSING_BANK, groups[HRMS.PAYROLL_EXCEPTION.MISSING_BANK] || [], blockBank);
    push(HRMS.PAYROLL_EXCEPTION.MISSING_PAN, groups[HRMS.PAYROLL_EXCEPTION.MISSING_PAN] || [], true);
    push(HRMS.PAYROLL_EXCEPTION.NEGATIVE_NET, groups[HRMS.PAYROLL_EXCEPTION.NEGATIVE_NET] || [], !allowNeg);
    push(HRMS.PAYROLL_EXCEPTION.WORKING_DAYS_ZERO, groups[HRMS.PAYROLL_EXCEPTION.WORKING_DAYS_ZERO] || [], true);
    return out;
  }

  function buildExceptionSummary_(records, employees) {
    var exceptions = collectExceptionsHuman_(records, employees);
    var ready = 0;
    (records || []).forEach(function (r) {
      if (r && !r.exception_flags) ready++;
    });
    return {
      total_employees: (records || []).length,
      ready_count: ready,
      attention_count: exceptions.length,
      exceptions: exceptions
    };
  }

  function assertMutableInputs_(run) {
    var st = String(run.status).toUpperCase();
    if (st === HRMS.PAYROLL_STATUS.LOCKED) {
      throw conflictError_('LOCKED payroll cannot be changed. Create a correction run.');
    }
    if (st !== HRMS.PAYROLL_STATUS.DRAFT && st !== HRMS.PAYROLL_STATUS.CALCULATED) {
      throw conflictError_('Inputs can only be edited in DRAFT or CALCULATED. Return to DRAFT first.');
    }
  }

  function listRuns(session) {
    requireHr_(session);
    var runs = DbService.getAllRecords(HRMS.SHEETS.PAYROLL_RUNS);
    runs.sort(function (a, b) {
      var ya = Number(a.period_year) - Number(b.period_year);
      if (ya !== 0) return ya > 0 ? -1 : 1;
      var ma = Number(a.period_month) - Number(b.period_month);
      if (ma !== 0) return ma > 0 ? -1 : 1;
      return serializeDateTime_(b.created_at).localeCompare(serializeDateTime_(a.created_at));
    });
    return runs.map(serializeRun_);
  }

  function getRunDetail(runId) {
    requireHr_();
    var run = getRun_(runId);
    var st = String(run.status).toUpperCase();
    if (st === HRMS.PAYROLL_STATUS.DRAFT || st === HRMS.PAYROLL_STATUS.CALCULATED) {
      syncEligibleEmployees(runId);
    }
    var inputs = DbService.findRecords(HRMS.SHEETS.PAYROLL_INPUTS, { payroll_run_id: runId });
    var records = DbService.findRecords(HRMS.SHEETS.PAYROLL_RECORDS, { payroll_run_id: runId });
    var employees = indexEmployees_();
    var rows = mergeRows_(inputs, records, employees).map(function (row) {
      var rec = row.record ? serializeSheetRow_(row.record, PAYROLL_RECORD_DATE_FIELDS_) : null;
      return {
        input: row.input,
        record: rec,
        employee: row.employee,
        amounts: rowAmounts_(rec),
        warnings: rowWarnings_(row.input, rec)
      };
    });
    var uiPhase = uiPhaseForStatus_(run.status);
    return {
      run: serializeRun_(run),
      rows: rows,
      summary: buildSummary_(rows),
      exceptions: collectExceptionsHuman_(records, employees, periodEnd_(run.period_year, run.period_month)),
      exceptionSummary: buildExceptionSummary_(records, employees),
      departmentTotals: departmentTotals_(records, employees),
      lockBlocks: evaluateLockBlocks_(run, records, true).map(humanizeLockBlock_),
      finalizeBlockers: buildFinalizeBlockers_(records, employees),
      payslipStatus: payslipStatus_(records),
      uiPhase: uiPhase,
      uiPhaseLabel: uiPhaseLabel_(uiPhase)
    };
  }

  function getRun_(runId) {
    var run = DbService.findOne(HRMS.SHEETS.PAYROLL_RUNS, { payroll_run_id: runId });
    if (!run) throw notFoundError_('Payroll run not found.');
    return run;
  }

  function createRun(periodYear, periodMonth, notes) {
    var session = requireHr_();
    var year = Number(periodYear);
    var month = Number(periodMonth);
    if (!year || month < 1 || month > 12) {
      throw validationError_('Valid period_year and period_month (1–12) are required.');
    }
    return withScriptLock_(function () {
      var open = findOpenRun_(year, month);
      if (open) {
        throw conflictError_('A non-LOCKED run already exists for this month: ' + open.payroll_run_id);
      }
      var runId = 'PR-' + year + '-' + padMonth_(month);
      if (DbService.findOne(HRMS.SHEETS.PAYROLL_RUNS, { payroll_run_id: runId })) {
        throw conflictError_('Run ID ' + runId + ' already exists. Use a correction run after lock.');
      }
      var workingDefault = Number(ConfigService.getSetting('default_working_days', 26)) || 26;
      var now = new Date();
      var run = {
        payroll_run_id: runId,
        period_year: year,
        period_month: month,
        status: HRMS.PAYROLL_STATUS.DRAFT,
        working_days_default: workingDefault,
        currency: 'INR',
        calculated_at: '',
        approved_at: '',
        approved_by_email: '',
        locked_at: '',
        locked_by_email: '',
        correction_of_run_id: '',
        notes: notes || '',
        created_at: now,
        created_by_email: session.email
      };
      DbService.insertRecord(HRMS.SHEETS.PAYROLL_RUNS, run);
      seedInputs_(run);
      AuditService.log(HRMS.AUDIT_ACTIONS.PAYROLL_CREATE, 'PayrollRuns', runId,
        'Created payroll run ' + runId, session.employee_id);
      return getRunDetail(runId);
    });
  }

  function createCorrectionRun(sourceRunId, notes) {
    var session = requireHr_();
    return withScriptLock_(function () {
      var source = getRun_(sourceRunId);
      if (String(source.status).toUpperCase() !== HRMS.PAYROLL_STATUS.LOCKED) {
        throw validationError_('Correction runs can only be created from a LOCKED run.');
      }
      var year = Number(source.period_year);
      var month = Number(source.period_month);
      var open = findOpenRun_(year, month);
      if (open) {
        throw conflictError_('A non-LOCKED run already exists for this month: ' + open.payroll_run_id);
      }
      var runId = nextCorrectionId_(year, month);
      var now = new Date();
      var run = {
        payroll_run_id: runId,
        period_year: year,
        period_month: month,
        status: HRMS.PAYROLL_STATUS.DRAFT,
        working_days_default: source.working_days_default,
        currency: 'INR',
        calculated_at: '',
        approved_at: '',
        approved_by_email: '',
        locked_at: '',
        locked_by_email: '',
        correction_of_run_id: source.payroll_run_id,
        notes: notes || ('Correction of ' + source.payroll_run_id),
        created_at: now,
        created_by_email: session.email
      };
      DbService.insertRecord(HRMS.SHEETS.PAYROLL_RUNS, run);
      seedInputsFromSource_(run, source);
      AuditService.log(HRMS.AUDIT_ACTIONS.PAYROLL_CORRECT, 'PayrollRuns', runId,
        'Correction run of ' + source.payroll_run_id, session.employee_id);
      return getRunDetail(runId);
    });
  }

  function saveInputs(runId, inputRows) {
    requireHr_();
    return withScriptLock_(function () {
      var run = getRun_(runId);
      assertMutableInputs_(run);
      (inputRows || []).forEach(function (row) {
        var existing = DbService.findOne(HRMS.SHEETS.PAYROLL_INPUTS, { payroll_input_id: row.payroll_input_id });
        if (!existing || existing.payroll_run_id !== runId) {
          throw validationError_('Invalid payroll_input_id for this run.');
        }
        var working = parseRequiredNumber_(row.working_days, 'working_days', existing.employee_id);
        var paid = parseRequiredNumber_(row.paid_days, 'paid_days', existing.employee_id);
        var lop = parseRequiredNumber_(row.lop_days, 'lop_days', existing.employee_id);
        if (working <= 0) throw validationError_('working_days must be greater than 0 for ' + existing.employee_id);
        if (paid < 0 || lop < 0) throw validationError_('paid_days and lop_days cannot be negative.');
        DbService.updateRecord(HRMS.SHEETS.PAYROLL_INPUTS, 'payroll_input_id', row.payroll_input_id, {
          working_days: working,
          paid_days: paid,
          lop_days: lop,
          bonus: Math.max(0, parseOptionalAmount_(row.bonus, 'bonus', existing.employee_id)),
          incentive: Math.max(0, parseOptionalAmount_(row.incentive, 'incentive', existing.employee_id)),
          other_earnings: Math.max(0, parseOptionalAmount_(row.other_earnings, 'other_earnings', existing.employee_id)),
          other_deductions: Math.max(0, parseOptionalAmount_(row.other_deductions, 'other_deductions', existing.employee_id)),
          tds_amount: Math.max(0, parseOptionalAmount_(row.tds_amount, 'tds_amount', existing.employee_id)),
          remarks: row.remarks != null ? String(row.remarks) : existing.remarks
        });
      });
      return getRunDetail(runId);
    });
  }

  function refreshLopFromLeave(runId) {
    requireHr_();
    return withScriptLock_(function () {
      var run = getRun_(runId);
      assertMutableInputs_(run);
      var inputs = DbService.findRecords(HRMS.SHEETS.PAYROLL_INPUTS, { payroll_run_id: runId });
      inputs.forEach(function (inp) {
        var lopLeave = PayrollLeaveBridge.getApprovedLopForPayroll(
          inp.employee_id, run.period_year, run.period_month);
        DbService.updateRecord(HRMS.SHEETS.PAYROLL_INPUTS, 'payroll_input_id', inp.payroll_input_id, {
          lop_from_leave: lopLeave
        });
      });
      return getRunDetail(runId);
    });
  }

  /**
   * Opt-in: copy leave LOP into lop_days and recompute paid_days = working − LOP.
   * Does not change LOCKED runs. HR can still edit days afterwards.
   */
  function applyLeaveLopToDays(runId) {
    requireHr_();
    return withScriptLock_(function () {
      var run = getRun_(runId);
      assertMutableInputs_(run);
      var inputs = DbService.findRecords(HRMS.SHEETS.PAYROLL_INPUTS, { payroll_run_id: runId });
      inputs.forEach(function (inp) {
        var lopLeave = PayrollLeaveBridge.getApprovedLopForPayroll(
          inp.employee_id, run.period_year, run.period_month);
        var working = num_(inp.working_days);
        var lopDays = lopLeave;
        var paid = Math.max(0, working - lopDays);
        DbService.updateRecord(HRMS.SHEETS.PAYROLL_INPUTS, 'payroll_input_id', inp.payroll_input_id, {
          lop_from_leave: lopLeave,
          lop_days: lopDays,
          paid_days: paid
        });
      });
      return getRunDetail(runId);
    });
  }

  function calculate(runId, ignoredClientPayload) {
    var session = requireHr_();
    if (ignoredClientPayload && ignoredClientPayload.net_pay != null) {
      Logger.log('PAYROLL_CALCULATE ignored client net_pay for run ' + runId);
    }
    return withScriptLock_(function () {
      var run = getRun_(runId);
      var st = String(run.status).toUpperCase();
      if (st !== HRMS.PAYROLL_STATUS.DRAFT && st !== HRMS.PAYROLL_STATUS.CALCULATED) {
        throw conflictError_('Calculate is only allowed from DRAFT or CALCULATED.');
      }
      var inputs = DbService.findRecords(HRMS.SHEETS.PAYROLL_INPUTS, { payroll_run_id: runId });
      assertAttendanceComplete_(inputs);
      var employees = indexEmployees_();
      var settings = {
        payroll_round: ConfigService.getSetting('payroll_round', 'NEAREST_RUPEE')
      };
      var periodEnd = periodEnd_(run.period_year, run.period_month);
      var now = new Date();
      var newRecords = [];

      inputs.forEach(function (inp) {
        var emp = employees[inp.employee_id] || { employee_id: inp.employee_id };
        var bundle = CompensationService.getStructureInForce(inp.employee_id, periodEnd);
        var result = PayrollEngine.calculateEmployee({
          structure: bundle ? bundle.structure : null,
          components: bundle ? bundle.components : [],
          inputs: inp,
          settings: settings,
          employee: emp
        });
        if (result.skipped) {
          return;
        }
        newRecords.push({
          payroll_record_id: DbService.generateId('PRC'),
          payroll_run_id: runId,
          employee_id: inp.employee_id,
          salary_structure_id: result.salary_structure_id,
          working_days: result.working_days,
          paid_days: result.paid_days,
          lop_days: result.lop_days,
          bonus: result.bonus,
          incentive: result.incentive,
          other_earnings: result.other_earnings,
          other_deductions: result.other_deductions,
          tds_amount: result.tds_amount,
          gross_earnings: result.gross_earnings,
          total_deductions: result.total_deductions,
          net_pay: result.net_pay,
          employer_contributions: result.employer_contributions,
          component_breakdown: result.component_breakdown,
          exception_flags: result.exception_flags,
          payslip_document_id: '',
          calculated_at: now
        });
      });

      DbService.deleteRecords(HRMS.SHEETS.PAYROLL_RECORDS, { payroll_run_id: runId });
      DbService.insertRecords(HRMS.SHEETS.PAYROLL_RECORDS, newRecords);
      DbService.updateRecord(HRMS.SHEETS.PAYROLL_RUNS, 'payroll_run_id', runId, {
        status: HRMS.PAYROLL_STATUS.CALCULATED,
        calculated_at: now
      });
      AuditService.log(HRMS.AUDIT_ACTIONS.PAYROLL_CALCULATE, 'PayrollRuns', runId,
        'Calculated ' + newRecords.length + ' records', session.employee_id);
      return getRunDetail(runId);
    });
  }

  function submitForReview(runId) {
    var session = requireHr_();
    var detail = withScriptLock_(function () {
      var run = getRun_(runId);
      if (String(run.status).toUpperCase() !== HRMS.PAYROLL_STATUS.CALCULATED) {
        throw conflictError_('Submit for review is only allowed from CALCULATED.');
      }
      DbService.updateRecord(HRMS.SHEETS.PAYROLL_RUNS, 'payroll_run_id', runId, {
        status: HRMS.PAYROLL_STATUS.UNDER_REVIEW
      });
      AuditService.log(HRMS.AUDIT_ACTIONS.PAYROLL_REVIEW, 'PayrollRuns', runId,
        'Moved to UNDER_REVIEW', session.employee_id);
      return getRunDetail(runId);
    });
    firePayrollNotify_(function () {
      NotificationPayrollAdapter.notifyReadyForReview(detail.run);
    });
    return detail;
  }

  function returnToDraft(runId) {
    var session = requireHr_();
    return withScriptLock_(function () {
      var run = getRun_(runId);
      var st = String(run.status).toUpperCase();
      if (st === HRMS.PAYROLL_STATUS.LOCKED) {
        throw conflictError_('LOCKED payroll cannot return to DRAFT.');
      }
      if (st === HRMS.PAYROLL_STATUS.APPROVED && !PermissionService.isAdmin(session)) {
        throw authorizationError_('Only Admin can return an APPROVED run to DRAFT.');
      }
      if (st !== HRMS.PAYROLL_STATUS.UNDER_REVIEW && st !== HRMS.PAYROLL_STATUS.APPROVED &&
          st !== HRMS.PAYROLL_STATUS.CALCULATED) {
        throw conflictError_('Return to DRAFT is not allowed from ' + st + '.');
      }
      DbService.updateRecord(HRMS.SHEETS.PAYROLL_RUNS, 'payroll_run_id', runId, {
        status: HRMS.PAYROLL_STATUS.DRAFT,
        approved_at: '',
        approved_by_email: ''
      });
      AuditService.log(HRMS.AUDIT_ACTIONS.PAYROLL_RETURN_DRAFT, 'PayrollRuns', runId,
        'Returned to DRAFT from ' + st, session.employee_id);
      return getRunDetail(runId);
    });
  }

  function approve(runId) {
    var session = requireHr_();
    var detail = withScriptLock_(function () {
      var run = getRun_(runId);
      if (String(run.status).toUpperCase() !== HRMS.PAYROLL_STATUS.UNDER_REVIEW) {
        throw conflictError_('Approve is only allowed from UNDER_REVIEW.');
      }
      var records = DbService.findRecords(HRMS.SHEETS.PAYROLL_RECORDS, { payroll_run_id: runId });
      var blocks = evaluateLockBlocks_(run, records, true);
      if (blocks.length) {
        throw conflictError_('Cannot approve: ' + blocks.join('; '));
      }
      var now = new Date();
      DbService.updateRecord(HRMS.SHEETS.PAYROLL_RUNS, 'payroll_run_id', runId, {
        status: HRMS.PAYROLL_STATUS.APPROVED,
        approved_at: now,
        approved_by_email: session.email
      });
      AuditService.log(HRMS.AUDIT_ACTIONS.PAYROLL_APPROVE, 'PayrollRuns', runId,
        'Approved payroll run', session.employee_id);
      return getRunDetail(runId);
    });
    firePayrollNotify_(function () {
      NotificationPayrollAdapter.notifyApproved(detail.run);
    });
    return detail;
  }

  function lock(runId, clientPayload) {
    var session = requireHr_();
    clientPayload = clientPayload || {};
    if (clientPayload.net_pay != null) {
      Logger.log('PAYROLL_LOCK ignored client net_pay for run ' + runId);
    }
    var generatePayslips = clientPayload.generatePayslips !== false;
    // Hold script lock only for validation + status flip. Drive payslip I/O runs after
    // release so concurrent leave/employee/payroll ops are not blocked for minutes.
    var snapshot = withScriptLock_(function () {
      var run = getRun_(runId);
      var st = String(run.status).toUpperCase();
      var records = DbService.findRecords(HRMS.SHEETS.PAYROLL_RECORDS, { payroll_run_id: runId });
      var employees = indexEmployees_();

      // Idempotent retry: already LOCKED (e.g. prior payslip generation failed).
      if (st === HRMS.PAYROLL_STATUS.LOCKED) {
        return {
          run: run,
          records: records,
          employees: employees,
          alreadyLocked: true
        };
      }

      if (st !== HRMS.PAYROLL_STATUS.APPROVED) {
        throw conflictError_('Lock is only allowed from APPROVED.');
      }
      var blocks = evaluateLockBlocks_(run, records, true);
      if (blocks.length) {
        throw conflictError_('Cannot lock: ' + blocks.join('; '));
      }
      var now = new Date();
      DbService.updateRecord(HRMS.SHEETS.PAYROLL_RUNS, 'payroll_run_id', runId, {
        status: HRMS.PAYROLL_STATUS.LOCKED,
        locked_at: now,
        locked_by_email: session.email
      });
      AuditService.log(HRMS.AUDIT_ACTIONS.PAYROLL_LOCK, 'PayrollRuns', runId,
        'Locked payroll run; generating payslips', session.employee_id);
      return {
        run: getRun_(runId),
        records: records,
        employees: employees,
        alreadyLocked: false
      };
    });

    try {
      if (generatePayslips) {
        PayslipService.generateForRun(snapshot.run, snapshot.records, snapshot.employees, session);
      }
    } catch (e) {
      // Run is already LOCKED; payslip generation is idempotent on retry (trashes same file names).
      Logger.log('PAYROLL_LOCK payslip generation failed for ' + runId + ': ' + (e.message || e));
      if (generatePayslips) {
        throw systemError_('Payroll run was locked, but payslip generation failed. Use Generate payslips to retry. Amounts stay frozen.');
      }
    }
    firePayrollNotify_(function () {
      if (!snapshot.alreadyLocked) {
        NotificationPayrollAdapter.notifyLocked(snapshot.run);
      }
      if (generatePayslips) {
        NotificationPayrollAdapter.notifyPayslipsAvailable(snapshot.run, snapshot.records, snapshot.employees);
      }
    });
    return getRunDetail(runId);
  }

  /**
   * HR-facing finalize: submit for review → approve → lock without generating payslips.
   * Idempotent when already LOCKED.
   */
  function finalizePayroll(runId) {
    requireHr_();
    var detail = getRunDetail(runId);
    var st = String(detail.run.status).toUpperCase();
    if (st === HRMS.PAYROLL_STATUS.LOCKED) {
      return detail;
    }
    if (st === HRMS.PAYROLL_STATUS.DRAFT) {
      throw conflictError_('Calculate payroll before finalizing.');
    }
    if (detail.lockBlocks && detail.lockBlocks.length) {
      throw conflictError_('Resolve these issues before finalizing: ' + detail.lockBlocks.join('; '));
    }
    if (st === HRMS.PAYROLL_STATUS.CALCULATED) {
      detail = submitForReview(runId);
      st = String(detail.run.status).toUpperCase();
    }
    if (st === HRMS.PAYROLL_STATUS.UNDER_REVIEW) {
      detail = approve(runId);
      st = String(detail.run.status).toUpperCase();
    }
    if (st === HRMS.PAYROLL_STATUS.APPROVED) {
      detail = lock(runId, { generatePayslips: false });
    }
    return detail;
  }

  /**
   * Idempotent payslip file regeneration for a LOCKED run.
   * Does not change payroll amounts, inputs, or status.
   */
  function regeneratePayslips(runId) {
    var session = requireHr_();
    var snapshot = withScriptLock_(function () {
      var run = getRun_(runId);
      if (String(run.status).toUpperCase() !== HRMS.PAYROLL_STATUS.LOCKED) {
        throw conflictError_('Payslips can only be regenerated after payroll is LOCKED.');
      }
      return {
        run: run,
        records: DbService.findRecords(HRMS.SHEETS.PAYROLL_RECORDS, { payroll_run_id: runId }),
        employees: indexEmployees_()
      };
    });
    try {
      PayslipService.generateForRun(snapshot.run, snapshot.records, snapshot.employees, session);
    } catch (e) {
      Logger.log('PAYROLL_REGENERATE payslip generation failed for ' + runId + ': ' + (e.message || e));
      throw systemError_('Payslip generation failed. Amounts are unchanged. Retry generate payslips.');
    }
    firePayrollNotify_(function () {
      NotificationPayrollAdapter.notifyPayslipsAvailable(snapshot.run, snapshot.records, snapshot.employees);
    });
    return getRunDetail(runId);
  }

  /**
   * Generate or replace one employee payslip for a LOCKED run.
   */
  function regeneratePayslipForEmployee(runId, employeeId) {
    var session = requireHr_();
    employeeId = String(employeeId || '').trim();
    if (!employeeId) throw validationError_('employee_id is required.');
    var snapshot = withScriptLock_(function () {
      var run = getRun_(runId);
      if (String(run.status).toUpperCase() !== HRMS.PAYROLL_STATUS.LOCKED) {
        throw conflictError_('Payslips can only be generated after payroll is LOCKED.');
      }
      var rec = DbService.findOne(HRMS.SHEETS.PAYROLL_RECORDS, {
        payroll_run_id: runId,
        employee_id: employeeId
      });
      if (!rec) throw notFoundError_('No payroll record for ' + employeeId + ' in this run.');
      return {
        run: run,
        record: rec,
        employees: indexEmployees_()
      };
    });
    try {
      PayslipService.generateForEmployee(
        snapshot.run,
        snapshot.record,
        snapshot.employees[snapshot.record.employee_id] || {},
        session
      );
    } catch (e) {
      Logger.log('PAYROLL_REGENERATE_ONE payslip failed for ' + runId + '/' + employeeId + ': ' + (e.message || e));
      throw systemError_('Payslip generation failed for ' + employeeId + '. Amounts are unchanged.');
    }
    firePayrollNotify_(function () {
      NotificationPayrollAdapter.notifyPayslipsAvailable(
        snapshot.run,
        [snapshot.record],
        snapshot.employees
      );
    });
    return getRunDetail(runId);
  }

  function findOpenRun_(year, month) {
    var runs = DbService.getAllRecords(HRMS.SHEETS.PAYROLL_RUNS);
    for (var i = 0; i < runs.length; i++) {
      if (Number(runs[i].period_year) === Number(year) &&
          Number(runs[i].period_month) === Number(month) &&
          String(runs[i].status).toUpperCase() !== HRMS.PAYROLL_STATUS.LOCKED) {
        return runs[i];
      }
    }
    return null;
  }

  function nextCorrectionId_(year, month) {
    var prefix = 'PR-' + year + '-' + padMonth_(month) + '-C';
    var max = 0;
    DbService.getAllRecords(HRMS.SHEETS.PAYROLL_RUNS).forEach(function (r) {
      if (String(r.payroll_run_id).indexOf(prefix) === 0) {
        var n = Number(String(r.payroll_run_id).substring(prefix.length));
        if (n > max) max = n;
      }
    });
    return prefix + (max + 1);
  }

  function buildInputRowForEmployee_(run, emp) {
    var lopLeave = PayrollLeaveBridge.getApprovedLopForPayroll(
      emp.employee_id, run.period_year, run.period_month);
    return {
      payroll_input_id: DbService.generateId('PI'),
      payroll_run_id: run.payroll_run_id,
      employee_id: emp.employee_id,
      working_days: 0,
      paid_days: 0,
      lop_days: 0,
      bonus: 0,
      incentive: 0,
      other_earnings: 0,
      other_deductions: 0,
      tds_amount: 0,
      lop_from_leave: lopLeave,
      remarks: ''
    };
  }

  function syncEligibleEmployees(runId) {
    requireHr_();
    return withScriptLock_(function () {
      var run = getRun_(runId);
      var st = String(run.status).toUpperCase();
      if (st !== HRMS.PAYROLL_STATUS.DRAFT && st !== HRMS.PAYROLL_STATUS.CALCULATED) {
        return { added: 0, total: DbService.findRecords(HRMS.SHEETS.PAYROLL_INPUTS, { payroll_run_id: runId }).length };
      }
      var eligible = eligibleEmployees_(run.period_year, run.period_month);
      var existing = DbService.findRecords(HRMS.SHEETS.PAYROLL_INPUTS, { payroll_run_id: runId });
      var existingIds = {};
      existing.forEach(function (inp) { existingIds[inp.employee_id] = true; });
      var toAdd = eligible.filter(function (e) { return !existingIds[e.employee_id]; });
      if (toAdd.length) {
        DbService.insertRecords(HRMS.SHEETS.PAYROLL_INPUTS,
          toAdd.map(function (emp) { return buildInputRowForEmployee_(run, emp); }));
      }
      return { added: toAdd.length, total: existing.length + toAdd.length };
    });
  }

  function isEmployeeEligibleForPeriod(employeeId, periodYear, periodMonth) {
    requireHr_();
    var emp = null;
    try {
      if (typeof EmployeeService !== 'undefined' && EmployeeService.getMasterRecord) {
        emp = EmployeeService.getMasterRecord(employeeId);
      }
    } catch (ignore) {}
    if (!emp) {
      emp = DbService.findOne(HRMS.SHEETS.EMPLOYEES, { employee_id: employeeId });
    }
    if (!emp) return false;
    return eligibleEmployees_(periodYear, periodMonth).some(function (e) {
      return e.employee_id === employeeId;
    });
  }

  function seedInputs_(run) {
    var employees = eligibleEmployees_(run.period_year, run.period_month);
    var rows = employees.map(function (emp) {
      return buildInputRowForEmployee_(run, emp);
    });
    DbService.insertRecords(HRMS.SHEETS.PAYROLL_INPUTS, rows);
  }

  function seedInputsFromSource_(run, source) {
    var sourceInputs = DbService.findRecords(HRMS.SHEETS.PAYROLL_INPUTS, {
      payroll_run_id: source.payroll_run_id
    });
    var rows = sourceInputs.map(function (inp) {
      var lopLeave = PayrollLeaveBridge.getApprovedLopForPayroll(
        inp.employee_id, run.period_year, run.period_month);
      return {
        payroll_input_id: DbService.generateId('PI'),
        payroll_run_id: run.payroll_run_id,
        employee_id: inp.employee_id,
        working_days: inp.working_days,
        paid_days: inp.paid_days,
        lop_days: inp.lop_days,
        bonus: inp.bonus,
        incentive: inp.incentive,
        other_earnings: inp.other_earnings,
        other_deductions: inp.other_deductions,
        tds_amount: inp.tds_amount,
        lop_from_leave: lopLeave,
        remarks: inp.remarks || ''
      };
    });
    DbService.insertRecords(HRMS.SHEETS.PAYROLL_INPUTS, rows);
  }

  function eligibleEmployees_(year, month) {
    var end = periodEnd_(year, month);
    var all = null;
    try {
      if (typeof EmployeeService !== 'undefined' && EmployeeService &&
          typeof EmployeeService.listActiveEmployees === 'function') {
        all = EmployeeService.listActiveEmployees();
      }
    } catch (ignore) {
      all = null;
    }
    if (!all) {
      all = DbService.getAllRecords(HRMS.SHEETS.EMPLOYEES);
    }
    return (all || []).filter(function (e) {
      if (String(e.status || '').toUpperCase() !== 'ACTIVE') return false;
      var join = toDate_(e.joining_date);
      if (join && join > end) return false;
      return true;
    });
  }

  function indexEmployees_() {
    var map = {};
    DbService.getAllRecords(HRMS.SHEETS.EMPLOYEES).forEach(function (e) {
      e.display_name = e.display_name || ((e.first_name || '') + ' ' + (e.last_name || '')).trim();
      map[e.employee_id] = e;
    });
    return map;
  }

  function employeeDisplayName_(emp) {
    if (!emp) return '';
    var dn = String(emp.display_name || '').trim();
    if (dn) return dn;
    return String((emp.first_name || '') + ' ' + (emp.last_name || '')).trim();
  }

  function mergeRows_(inputs, records, employees) {
    var recMap = {};
    (records || []).forEach(function (r) { recMap[r.employee_id] = r; });
    return (inputs || []).map(function (inp) {
      var emp = employees[inp.employee_id] || {};
      var rec = recMap[inp.employee_id] || null;
      return {
        input: inp,
        record: rec,
        employee: {
          employee_id: inp.employee_id,
          display_name: employeeDisplayName_(emp) || inp.employee_id,
          first_name: emp.first_name || '',
          last_name: emp.last_name || '',
          work_email: emp.work_email || '',
          department: emp.department || '',
          designation: emp.designation || ''
        }
      };
    });
  }

  function collectExceptions_(records) {
    var list = [];
    (records || []).forEach(function (r) {
      if (r.exception_flags) {
        list.push({
          employee_id: r.employee_id,
          flags: String(r.exception_flags).split(';').filter(Boolean)
        });
      }
    });
    return list;
  }

  function departmentTotals_(records, employees) {
    var totals = {};
    (records || []).forEach(function (r) {
      var dept = 'Unknown';
      try {
        var bd = JSON.parse(r.component_breakdown || '{}');
        dept = (bd.meta && bd.meta.department) || (employees[r.employee_id] && employees[r.employee_id].department) || 'Unknown';
      } catch (ignore) {}
      if (!totals[dept]) {
        totals[dept] = { department: dept, count: 0, gross_earnings: 0, total_deductions: 0, net_pay: 0 };
      }
      totals[dept].count++;
      totals[dept].gross_earnings = PayrollEngine.round2(totals[dept].gross_earnings + num_(r.gross_earnings));
      totals[dept].total_deductions = PayrollEngine.round2(totals[dept].total_deductions + num_(r.total_deductions));
      totals[dept].net_pay = PayrollEngine.round2(totals[dept].net_pay + num_(r.net_pay));
    });
    return Object.keys(totals).map(function (k) { return totals[k]; });
  }

  function evaluateLockBlocks_(run, records, forApproveOrLock) {
    var blocks = [];
    if (!records || !records.length) {
      blocks.push('No calculated records');
      return blocks;
    }
    var blockStructure = ConfigService.getSetting('block_lock_missing_structure', true);
    var blockBank = ConfigService.getSetting('block_lock_missing_bank', true);
    var allowNeg = ConfigService.getSetting('allow_lock_negative_net', false);
    var missingS = 0;
    var missingB = 0;
    var missingP = 0;
    var neg = 0;
    records.forEach(function (r) {
      var flags = String(r.exception_flags || '');
      if (PayrollEngine.flagsInclude(flags, HRMS.PAYROLL_EXCEPTION.MISSING_STRUCTURE)) missingS++;
      if (PayrollEngine.flagsInclude(flags, HRMS.PAYROLL_EXCEPTION.MISSING_BANK)) missingB++;
      if (PayrollEngine.flagsInclude(flags, HRMS.PAYROLL_EXCEPTION.MISSING_PAN)) missingP++;
      if (PayrollEngine.flagsInclude(flags, HRMS.PAYROLL_EXCEPTION.NEGATIVE_NET)) neg++;
    });
    if (forApproveOrLock) {
      if (blockStructure && missingS) blocks.push('MISSING_STRUCTURE (' + missingS + ')');
      if (blockBank && missingB) blocks.push('MISSING_BANK (' + missingB + ')');
      if (missingP) blocks.push('MISSING_PAN (' + missingP + ')');
      if (!allowNeg && neg) blocks.push('NEGATIVE_NET (' + neg + ')');
    }
    return blocks;
  }

  function rowAmounts_(record) {
    var out = { basic: null, allowances: null, deductions: null, net: null };
    if (!record) return out;
    out.deductions = num_(record.total_deductions);
    out.net = num_(record.net_pay);
    var basic = 0;
    var allowances = 0;
    try {
      var bd = JSON.parse(record.component_breakdown || '{}');
      (bd.lines || []).forEach(function (line) {
        if (String(line.component_kind || '').toUpperCase() !== 'EARNING') return;
        if (String(line.component_code || '').toUpperCase() === 'BASIC') {
          basic += num_(line.amount);
        } else {
          allowances += num_(line.amount);
        }
      });
      allowances += num_(bd.bonus) + num_(bd.incentive) + num_(bd.other_earnings);
    } catch (ignore) {}
    out.basic = PayrollEngine.round2(basic);
    out.allowances = PayrollEngine.round2(allowances);
    return out;
  }

  function rowWarnings_(inp, rec) {
    var w = [];
    if (!inp) return w;
    if (Math.abs(num_(inp.lop_days) - num_(inp.lop_from_leave)) > 0.001) {
      w.push('LOP_MISMATCH');
    }
    if (Math.abs(num_(inp.paid_days) + num_(inp.lop_days) - num_(inp.working_days)) > 0.001) {
      w.push('DAYS_INCONSISTENT');
    }
    if (rec && rec.exception_flags) w.push('EXCEPTION');
    return w;
  }

  function buildSummary_(rows) {
    rows = rows || [];
    var employeeCount = rows.length;
    var calculatedCount = 0;
    var gross = 0;
    var deductions = 0;
    var net = 0;
    var lopDays = 0;
    var lopEmployees = 0;
    var lopMismatch = 0;
    var exceptionCount = 0;
    rows.forEach(function (row) {
      var inp = row.input || {};
      lopDays += num_(inp.lop_days);
      if (num_(inp.lop_days) > 0) lopEmployees++;
      if ((row.warnings || []).indexOf('LOP_MISMATCH') >= 0) lopMismatch++;
      if (row.record) {
        calculatedCount++;
        gross += num_(row.record.gross_earnings);
        deductions += num_(row.record.total_deductions);
        net += num_(row.record.net_pay);
        if (row.record.exception_flags) exceptionCount++;
      }
    });
    return {
      employee_count: employeeCount,
      calculated_count: calculatedCount,
      skipped_count: Math.max(0, employeeCount - calculatedCount),
      gross_earnings: PayrollEngine.round2(gross),
      total_deductions: PayrollEngine.round2(deductions),
      net_pay: PayrollEngine.round2(net),
      lop_days: PayrollEngine.round2(lopDays),
      lop_employees: lopEmployees,
      lop_mismatch_count: lopMismatch,
      exception_count: exceptionCount,
      has_totals: calculatedCount > 0
    };
  }

  function payslipStatus_(records) {
    var expected = (records || []).length;
    var generated = 0;
    (records || []).forEach(function (r) {
      if (String(r.payslip_document_id || '').trim()) generated++;
    });
    return {
      expected: expected,
      generated: generated,
      complete: expected > 0 && generated === expected
    };
  }

  return {
    listRuns: listRuns,
    getRunDetail: getRunDetail,
    createRun: createRun,
    createCorrectionRun: createCorrectionRun,
    saveInputs: saveInputs,
    syncEligibleEmployees: syncEligibleEmployees,
    isEmployeeEligibleForPeriod: isEmployeeEligibleForPeriod,
    refreshLopFromLeave: refreshLopFromLeave,
    applyLeaveLopToDays: applyLeaveLopToDays,
    calculate: calculate,
    submitForReview: submitForReview,
    returnToDraft: returnToDraft,
    approve: approve,
    lock: lock,
    finalizePayroll: finalizePayroll,
    regeneratePayslips: regeneratePayslips,
    regeneratePayslipForEmployee: regeneratePayslipForEmployee,
    evaluateLockBlocks: evaluateLockBlocks_,
    humanizeExceptionFlag: humanizeExceptionFlag_
  };
})();
