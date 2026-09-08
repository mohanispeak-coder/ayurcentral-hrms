/**
 * Employee module tests — run `testEmployee_All` from the Apps Script editor.
 * Covers 11_TEST_PLAN.md EMP P0 cases (and EMP-03 P1 search helper).
 */

function testEmployee_All() {
  var results = [];
  function record(name, passed, detail, skipped) {
    results.push({ name: name, passed: passed, detail: detail || '', skipped: !!skipped });
    Logger.log((skipped ? 'SKIP' : passed ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ': ' + detail : ''));
  }

  record('sanitizeManagerNoSalary', (function () {
    var session = { authorized: true, role: 'MANAGER', employee_id: 'EMP002', email: 'mgr@test' };
    var row = {
      employee_id: 'EMP003',
      first_name: 'A',
      last_name: 'B',
      display_name: 'A B',
      manager_employee_id: 'EMP002',
      department: 'Sales',
      designation: 'AE',
      location: 'HQ',
      employment_type: 'PERMANENT',
      status: 'ACTIVE',
      work_email: 'a@test',
      pan: 'ABCDE1234F',
      bank_account_number: '123456',
      bank_ifsc: 'HDFC0000001',
      bank_name: 'HDFC',
      notes: 'secret'
    };
    var view = EmployeeService.sanitizeForViewer(row, session);
    return view.pan === undefined && view.bank_account_number === undefined &&
      view.bank_ifsc === undefined && view.notes === undefined &&
      view.can_view_payroll_ids === false && view.view_mode === 'TEAM_WORK';
  })(), 'EMP-08');

  record('sanitizeEmployeeOtherDenied', (function () {
    var session = { authorized: true, role: 'EMPLOYEE', employee_id: 'EMP003', email: 'e@test' };
    var row = { employee_id: 'EMP004', manager_employee_id: 'EMP002', display_name: 'Other', status: 'ACTIVE' };
    try {
      EmployeeService.sanitizeForViewer(row, session);
      return false;
    } catch (e) {
      return e.hrmsCode === HRMS.ERROR_CODES.AUTHORIZATION;
    }
  })(), 'SEC-01');

  record('searchFilterHelper', (function () {
    var rows = [
      { employee_id: 'EMP001', display_name: 'Hari', first_name: 'Hari', last_name: 'R', status: 'ACTIVE' },
      { employee_id: 'EMP002', display_name: 'Meera', first_name: 'Meera', last_name: 'K', status: 'INACTIVE' },
      { employee_id: 'EMP003', display_name: 'Arun', first_name: 'Arun', last_name: 'S', status: 'ACTIVE' }
    ];
    var byId = EmployeeService.matchesDirectoryFilter(rows, { q: 'EMP002' });
    var byName = EmployeeService.matchesDirectoryFilter(rows, { q: 'arun' });
    var inactive = EmployeeService.matchesDirectoryFilter(rows, { status: 'INACTIVE' });
    return byId.length === 1 && byId[0].employee_id === 'EMP002' &&
      byName.length === 1 && inactive.length === 1 && inactive[0].employee_id === 'EMP002';
  })(), 'EMP-03');

  var session = AuthService.resolveSession();
  var spreadsheetConfigured = !!ConfigService.getScriptProperty(HRMS.PROPS.SPREADSHEET_ID);
  if (!spreadsheetConfigured || !session.authorized) {
    record('liveEmployeeApis', true, 'Requires configured spreadsheet and authorized HR/ADMIN session', true);
    return summarizeEmployeeTests_(results);
  }

  var isHr = PermissionService.isHrOrAdmin(session);
  if (!isHr) {
    record('EMP-01 create', true, 'Skipped — current user is not HR/ADMIN (' + session.role + ')', true);
    try {
      EmployeeService.listDirectory(session, { q: 'zzz-no-match' });
      record('EMPLOYEE_directoryDenied', session.role !== 'EMPLOYEE', 'directory allowed for ' + session.role);
    } catch (e) {
      record('EMPLOYEE_directoryDenied', session.role === 'EMPLOYEE' && e.hrmsCode === HRMS.ERROR_CODES.AUTHORIZATION, e.message);
    }
    return summarizeEmployeeTests_(results);
  }

  var stamp = Utilities.formatDate(new Date(), ConfigService.getTimezone(), 'yyyyMMddHHmmss');
  var email1 = 'hrms.emp.' + stamp + '@example.com';
  var created;
  try {
    created = EmployeeService.createEmployee(session, {
      first_name: 'Test',
      last_name: 'Employee',
      display_name: 'Test Employee ' + stamp,
      work_email: email1,
      department: 'QA',
      designation: 'Tester',
      joining_date: '2026-01-15',
      employment_type: 'PERMANENT',
      location: 'Head Office',
      create_user: true
    });
    record('EMP-01 create', !!(created && created.employee && created.employee.employee_id),
      created && created.employee ? created.employee.employee_id : '');
  } catch (e) {
    record('EMP-01 create', false, e.message);
    return summarizeEmployeeTests_(results);
  }

  var newId = created.employee.employee_id;
  try {
    var audits = AuditService.getRecent(20);
    var found = audits.some(function (a) {
      return a.action === 'EMPLOYEE_CREATE' && String(a.entity_id) === newId;
    });
    record('EMP-01 audit', found, 'EMPLOYEE_CREATE ' + newId);
  } catch (e) {
    record('EMP-01 audit', false, e.message);
  }

  try {
    EmployeeService.createEmployee(session, {
      first_name: 'Dup',
      last_name: 'Mail',
      work_email: email1,
      department: 'QA',
      designation: 'Tester',
      joining_date: '2026-01-15',
      employment_type: 'CONTRACT',
      location: 'Head Office',
      create_user: false
    });
    record('EMP-05 duplicate email', false, 'Create should have been blocked');
  } catch (e) {
    record('EMP-05 duplicate email', e.hrmsCode === HRMS.ERROR_CODES.VALIDATION, e.message);
  }

  try {
    var updated = EmployeeService.updateEmployee(session, newId, { department: 'Operations' });
    record('EMP-02 edit department',
      updated.employee.department === 'Operations' && updated.employee.employee_id === newId,
      updated.employee.department + ' / ' + updated.employee.employee_id);
  } catch (e) {
    record('EMP-02 edit department', false, e.message);
  }

  try {
    EmployeeService.updateEmployee(session, newId, { employee_id: 'HACKED' });
    record('EMP-10 immutable id', false, 'Change should have been rejected');
  } catch (e) {
    record('EMP-10 immutable id', e.hrmsCode === HRMS.ERROR_CODES.VALIDATION, e.message);
  }

  try {
    var after = EmployeeService.setStatus(session, newId, 'INACTIVE');
    var user = EmployeeRepository.findUserByEmployeeId(newId);
    record('EMP-07 deactivate',
      after.status === 'INACTIVE' && user && String(user.status).toUpperCase() === 'DISABLED',
      'employee=' + after.status + ' user=' + (user && user.status));
    record('EMP-07 isActive', EmployeeService.isActive(newId) === false);
  } catch (e) {
    record('EMP-07 deactivate', false, e.message);
  }

  try {
    var dir = EmployeeService.listDirectory(session, { q: newId, status: 'INACTIVE', page: 1, pageSize: 25 });
    record('EMP-03 search inactive', dir.rows.some(function (r) { return r.employee_id === newId; }), 'rows=' + dir.total);
  } catch (e) {
    record('EMP-03 search inactive', false, e.message);
  }

  try {
    var leaked = created.employee;
    record('createResponseNoIssue', leaked.employee_id === newId);
  } catch (e) {
    record('createResponseNoIssue', false, e.message);
  }

  return summarizeEmployeeTests_(results);
}

function summarizeEmployeeTests_(results) {
  var failed = results.filter(function (r) { return !r.passed && !r.skipped; });
  Logger.log('Employee tests: ' + (results.length - failed.length) + '/' + results.length + ' passed (' + failed.length + ' failed)');
  return { results: results, allPassed: failed.length === 0, failedCount: failed.length };
}

function testEmployee_Static() {
  return testEmployee_All();
}
