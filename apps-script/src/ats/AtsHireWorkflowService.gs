/**
 * Post-HIRED recruitment workflow: compensation, letters, employee creation.
 * Isolated from payroll/employee modules except explicit service calls.
 */
var ATS = ATS || {};

var AtsHireWorkflowService = (function () {
  function trim_(v) {
    return v == null ? '' : String(v).trim();
  }

  function company_() {
    try {
      return ConfigService.getCompanyName();
    } catch (e) {
      return 'AyurCentral HRMS';
    }
  }

  function companyAddress_() {
    try {
      return trim_(ConfigService.getSetting('company_address', ''));
    } catch (e) {
      return '';
    }
  }

  function isTypeStructureRow_(row) {
    return !!row && trim_(row.structure_name) !== '' && trim_(row.employee_id) === '';
  }

  function listSalaryStructureOptions_(session) {
    AtsPermissionService.requireManage(session);
    try {
      if (typeof SalaryStructureTypeService !== 'undefined' &&
        SalaryStructureTypeService.listStructureTypeOptions) {
        return SalaryStructureTypeService.listStructureTypeOptions({ activeOnly: true });
      }
    } catch (ignore) {}
    var rows = (DbService.getAllRecords(HRMS.SHEETS.SALARY_STRUCTURES) || []).filter(isTypeStructureRow_);
    return rows
      .filter(function (r) {
        return String(r.status || '').toUpperCase() === HRMS.STRUCTURE_TYPE_STATUS.ACTIVE;
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

  var HIRE_APP_COLUMNS_ = [
    'hire_salary_structure_id',
    'hire_monthly_salary',
    'offer_letter_sent_at',
    'appointment_letter_sent_at'
  ];

  function ensureHireApplicationColumns_() {
    if (typeof AtsSchemaService === 'undefined' || !AtsSchemaService.ensureSheets) return;
    try {
      AtsSchemaService.ensureSheets();
    } catch (e) {
      Logger.log('ensureHireApplicationColumns_: ' + (e.message || e));
    }
  }

  function applicationHasHireColumns_() {
    try {
      var rows = DbService.getAllRecords(ATS.SHEETS.APPLICATIONS);
      if (!rows || !rows.length) return true;
      var sample = rows[0];
      for (var i = 0; i < HIRE_APP_COLUMNS_.length; i++) {
        if (!sample.hasOwnProperty(HIRE_APP_COLUMNS_[i])) return false;
      }
      return true;
    } catch (ignore) {
      return false;
    }
  }

  function structureLabel_(structureId) {
    structureId = trim_(structureId);
    if (!structureId) return '';
    var row = DbService.findOne(HRMS.SHEETS.SALARY_STRUCTURES, { salary_structure_id: structureId });
    if (!row || !isTypeStructureRow_(row)) return structureId;
    return trim_(row.structure_name) || structureId;
  }

  function loadHireContext_(session, applicationId) {
    AtsPermissionService.requireManage(session);
    ensureHireApplicationColumns_();
    var app = AtsRepository.findApplication(applicationId);
    if (!app) throw notFoundError_('Application not found.');
    var job = AtsRepository.findJob(app.job_id);
    if (!job) throw notFoundError_('Job requisition not found.');
    var interviews = AtsRepository.interviewsForApplication(app.application_id);
    AtsPermissionService.requireJob(session, job, interviews);
    var candidate = AtsRepository.findCandidate(app.candidate_id);
    if (!candidate) throw notFoundError_('Candidate not found.');
    if (AtsEngine.upper(app.stage) !== ATS.STAGE.HIRED) {
      throw validationError_('Hire actions are available only when the application is in HIRED stage.');
    }
    return { application: app, job: job, candidate: candidate };
  }

  function saveHireCompensation_(session, applicationId, payload) {
    payload = payload || {};
    ensureHireApplicationColumns_();
    var ctx = loadHireContext_(session, applicationId);
    var structureId = trim_(payload.salary_structure_id);
    var monthly = trim_(payload.monthly_salary);
    if (!structureId) throw validationError_('Select a salary structure.', { fields: { salary_structure_id: 'Required.' } });
    var row = DbService.findOne(HRMS.SHEETS.SALARY_STRUCTURES, { salary_structure_id: structureId });
    if (!isTypeStructureRow_(row)) {
      throw validationError_('Invalid salary structure.', { fields: { salary_structure_id: 'Not found.' } });
    }
    if (monthly === '') {
      throw validationError_('Enter monthly salary (CTC).', { fields: { monthly_salary: 'Required.' } });
    }
    var monthlyNum = Number(monthly);
    if (!isFinite(monthlyNum) || monthlyNum < 0) {
      throw validationError_('Monthly salary must be a valid number.', { fields: { monthly_salary: 'Invalid.' } });
    }
    var now = new Date();
    AtsRepository.updateApplication(applicationId, {
      hire_salary_structure_id: structureId,
      hire_monthly_salary: monthlyNum,
      updated_at: now
    });
    var saved = AtsRepository.findApplication(applicationId);
    if (!hireCompensationReady_(saved)) {
      if (!applicationHasHireColumns_()) {
        throw configurationError_(
          'Applications sheet is missing hire columns. In the spreadsheet, run menu Ensure ATS schema, or ask an admin to open Recruitment setup once, then save compensation again.');
      }
      throw configurationError_('Compensation could not be saved. Please try Save compensation again.');
    }
    audit_(ATS.AUDIT.HIRE_OFFER, 'Application', applicationId,
      'Hire compensation saved: ' + structureId + ' @ ' + monthlyNum);
    return { application: saved };
  }

  function splitName_(fullName) {
    var parts = trim_(fullName).split(/\s+/).filter(Boolean);
    if (!parts.length) return { first_name: 'New', last_name: 'Hire' };
    if (parts.length === 1) return { first_name: parts[0], last_name: '-' };
    return { first_name: parts[0], last_name: parts.slice(1).join(' ') };
  }

  function hireCompensationReady_(app) {
    if (!app) return false;
    if (!trim_(app.hire_salary_structure_id)) return false;
    var sal = app.hire_monthly_salary;
    if (sal === '' || sal == null) return false;
    var n = Number(sal);
    return isFinite(n) && n >= 0;
  }

  function assertHireCompensationReady_(app) {
    if (hireCompensationReady_(app)) return;
    if (!applicationHasHireColumns_()) {
      throw configurationError_(
        'Applications sheet is missing hire columns. Run Ensure ATS schema from the spreadsheet menu, then save compensation again before sending letters.');
    }
    throw validationError_('Save salary structure and monthly salary before sending letters or creating the employee.');
  }

  function createEmployeeFromHire_(session, applicationId, employeeId) {
    var ctx = loadHireContext_(session, applicationId);
    var app = ctx.application;
    var job = ctx.job;
    var candidate = ctx.candidate;
    if (trim_(candidate.hired_employee_id)) {
      throw conflictError_('Employee already linked: ' + candidate.hired_employee_id);
    }
    assertHireCompensationReady_(app);
    employeeId = trim_(employeeId).toUpperCase();
    if (!employeeId) {
      throw validationError_('Employee ID is required.', { fields: { employee_id: 'Required.' } });
    }
    var names = splitName_(candidate.full_name);
    var vertical = employeeId.split('-')[0] || '';
    var joining = Utilities.formatDate(new Date(), ConfigService.getTimezone(), 'yyyy-MM-dd');
    var payload = {
      employee_id: employeeId,
      first_name: names.first_name,
      last_name: names.last_name,
      display_name: trim_(candidate.full_name) || employeeId,
      work_email: trim_(candidate.email),
      phone: trim_(candidate.phone),
      location: trim_(candidate.location) || trim_(job.location),
      department: trim_(job.department),
      designation: trim_(job.title),
      vertical_name: vertical,
      manager_employee_id: trim_(job.hiring_manager_employee_id),
      joining_date: joining,
      employment_type: trim_(job.employment_type) || 'PERMANENT',
      salary_structure_id: trim_(app.hire_salary_structure_id),
      ctc_monthly: app.hire_monthly_salary,
      create_user: false,
      notes: 'Created from ATS application ' + app.application_id
    };
    var created;
    if (typeof EmployeeService !== 'undefined' && EmployeeService.createEmployee) {
      created = EmployeeService.createEmployee(session, payload, {});
    } else {
      throw configurationError_('Employee module is not available.');
    }
    var now = new Date();
    AtsRepository.updateCandidate(candidate.candidate_id, {
      hired_employee_id: employeeId,
      updated_at: now
    });
    audit_(ATS.AUDIT.HIRE_EMPLOYEE, 'Application', applicationId, 'Employee created: ' + employeeId);
    return {
      employee_id: employeeId,
      employee: created && created.employee ? created.employee : { employee_id: employeeId }
    };
  }

  function audit_(action, entityType, entityId, summary) {
    try {
      AuditService.log(action, entityType, entityId, summary, '');
    } catch (ignore) {}
  }

  function enrichApplicationHireFields_(view, row) {
    if (!view || !row) return view;
    view.hire_salary_structure_id = trim_(row.hire_salary_structure_id);
    view.hire_monthly_salary = row.hire_monthly_salary === '' || row.hire_monthly_salary == null
      ? ''
      : Number(row.hire_monthly_salary);
    view.offer_letter_sent_at = row.offer_letter_sent_at ? String(row.offer_letter_sent_at) : '';
    view.appointment_letter_sent_at = row.appointment_letter_sent_at ? String(row.appointment_letter_sent_at) : '';
    view.hire_salary_structure_name = structureLabel_(view.hire_salary_structure_id);
    return view;
  }

  return {
    listSalaryStructureOptions: listSalaryStructureOptions_,
    saveHireCompensation: saveHireCompensation_,
    createEmployeeFromHire: createEmployeeFromHire_,
    enrichApplicationHireFields: enrichApplicationHireFields_,
    loadHireContext: loadHireContext_,
    structureLabel: structureLabel_,
    hireCompensationReady: hireCompensationReady_,
    assertHireCompensationReady: assertHireCompensationReady_,
    ensureHireApplicationColumns: ensureHireApplicationColumns_
  };
})();
