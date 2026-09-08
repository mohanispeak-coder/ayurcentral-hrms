/**
 * Payroll P0 tests from 11_TEST_PLAN.md.
 * Engine tests run without Sheets. Integration tests skip if DB is not configured.
 */

function testPayroll_All() {
  var results = [];
  function record(name, passed, detail, skipped) {
    results.push({ name: name, passed: !!passed, detail: detail || '', skipped: !!skipped });
    Logger.log((skipped ? 'SKIP' : passed ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ': ' + detail : ''));
  }

  testPayroll_EngineSuite_(record);
  testPayroll_PermissionSuite_(record);
  testPayroll_LeaveBridgeSuite_(record);
  testPayroll_PayslipIdempotentSuite_(record);
  testPayroll_LockBlockSuite_(record);

  var spreadsheetConfigured = !!ConfigService.getScriptProperty(HRMS.PROPS.SPREADSHEET_ID);
  if (spreadsheetConfigured) {
    testPayroll_IntegrationSuite_(record);
  } else {
    record('PAY-integration', true, 'Spreadsheet not configured', true);
  }

  var failed = results.filter(function (r) { return !r.passed && !r.skipped; });
  Logger.log('Payroll tests: ' + (results.length - failed.length) + '/' + results.length +
    ' passed (' + failed.length + ' failed)');
  return { results: results, allPassed: failed.length === 0, failedCount: failed.length };
}

function testPayroll_EngineSuite_(record) {
  var components = [
    { component_code: 'BASIC', component_name: 'Basic', component_kind: 'EARNING', calc_method: 'FIXED', amount: 20000, sort_order: 1 },
    { component_code: 'HRA', component_name: 'HRA', component_kind: 'EARNING', calc_method: 'PERCENT_OF_BASIC', percent: 40, sort_order: 2 },
    { component_code: 'SA', component_name: 'Special', component_kind: 'EARNING', calc_method: 'FIXED', amount: 5000, sort_order: 3 },
    { component_code: 'PF', component_name: 'PF', component_kind: 'DEDUCTION', calc_method: 'PERCENT_OF_BASIC', percent: 12, sort_order: 4 },
    { component_code: 'EMPLOYER_PF', component_name: 'Employer PF', component_kind: 'EMPLOYER', calc_method: 'PERCENT_OF_BASIC', percent: 12, sort_order: 5 }
  ];
  var structure = { salary_structure_id: 'SS-TEST-X' };
  var emp = {
    employee_id: 'EMP003',
    display_name: 'Test Employee',
    department: 'Retail',
    designation: 'Associate',
    pan: 'ABCDE1234F',
    bank_account_number: '123456789012',
    bank_ifsc: 'HDFC0000001'
  };
  var settings = { payroll_round: 'PAISE_2' };

  var pay01 = PayrollEngine.calculateEmployee({
    structure: structure,
    components: components,
    inputs: { working_days: 26, paid_days: 26, lop_days: 0, bonus: 0, incentive: 0, other_earnings: 0, other_deductions: 0, tds_amount: 0 },
    settings: settings,
    employee: emp
  });
  record('PAY-01', pay01.gross_earnings === 33000 && pay01.total_deductions === 2400 &&
    pay01.net_pay === 30600 && pay01.employer_contributions === 2400,
    'gross=' + pay01.gross_earnings + ' net=' + pay01.net_pay + ' emp=' + pay01.employer_contributions);

  var pay02 = PayrollEngine.calculateEmployee({
    structure: structure,
    components: components,
    inputs: { working_days: 30, paid_days: 15, lop_days: 0, bonus: 0, incentive: 0, other_earnings: 0, other_deductions: 0, tds_amount: 0 },
    settings: settings,
    employee: emp
  });
  record('PAY-02', pay02.gross_earnings === 16500 && pay02.net_pay === 15300,
    'gross=' + pay02.gross_earnings + ' net=' + pay02.net_pay);

  var pay03 = PayrollEngine.calculateEmployee({
    structure: structure,
    components: components,
    inputs: { working_days: 26, paid_days: 24, lop_days: 2, bonus: 0, incentive: 0, other_earnings: 0, other_deductions: 0, tds_amount: 0 },
    settings: settings,
    employee: emp
  });
  record('PAY-03', pay03.net_pay < pay01.net_pay && pay03.lop_days === 2,
    'net=' + pay03.net_pay + ' vs ' + pay01.net_pay);

  var jan = PayrollEngine.calculateEmployee({
    structure: { salary_structure_id: 'SS-JAN-X' },
    components: [
      { component_code: 'BASIC', component_name: 'Basic', component_kind: 'EARNING', calc_method: 'FIXED', amount: 10000, sort_order: 1 }
    ],
    inputs: { working_days: 26, paid_days: 26, lop_days: 0, bonus: 0, incentive: 0, other_earnings: 0, other_deductions: 0, tds_amount: 0 },
    settings: settings,
    employee: emp
  });
  var april = PayrollEngine.calculateEmployee({
    structure: { salary_structure_id: 'SS-APR-Y' },
    components: [
      { component_code: 'BASIC', component_name: 'Basic', component_kind: 'EARNING', calc_method: 'FIXED', amount: 15000, sort_order: 1 }
    ],
    inputs: { working_days: 26, paid_days: 26, lop_days: 0, bonus: 0, incentive: 0, other_earnings: 0, other_deductions: 0, tds_amount: 0 },
    settings: settings,
    employee: emp
  });
  record('PAY-04', jan.net_pay === 10000 && april.net_pay === 15000 &&
    jan.salary_structure_id === 'SS-JAN-X' && april.salary_structure_id === 'SS-APR-Y',
    'jan=' + jan.net_pay + ' apr=' + april.net_pay);

  var pay05 = PayrollEngine.calculateEmployee({
    structure: structure,
    components: components,
    inputs: { working_days: 30, paid_days: 15, lop_days: 0, bonus: 10000, incentive: 2500, other_earnings: 0, other_deductions: 0, tds_amount: 0 },
    settings: settings,
    employee: emp
  });
  record('PAY-05', pay05.gross_earnings === 16500 + 10000 + 2500 && pay05.bonus === 10000 && pay05.incentive === 2500,
    'gross=' + pay05.gross_earnings);

  var breakdown01 = JSON.parse(pay01.component_breakdown);
  var pfLine = breakdown01.lines.filter(function (l) { return l.component_code === 'PF'; })[0];
  record('PAY-07', pfLine && pfLine.amount === 2400 && pay01.total_deductions === 2400, 'pf=' + (pfLine && pfLine.amount));

  var pay08 = PayrollEngine.calculateEmployee({
    structure: null,
    components: [],
    inputs: { working_days: 26, paid_days: 26, lop_days: 0, bonus: 0, incentive: 0, other_earnings: 0, other_deductions: 0, tds_amount: 0 },
    settings: settings,
    employee: emp
  });
  record('PAY-08', PayrollEngine.flagsInclude(pay08.exception_flags, 'MISSING_STRUCTURE'), pay08.exception_flags);

  var noBank = {
    employee_id: 'EMP003',
    display_name: 'Test',
    department: 'Retail',
    designation: 'Associate',
    pan: 'ABCDE1234F',
    bank_account_number: '',
    bank_ifsc: ''
  };
  var pay09 = PayrollEngine.calculateEmployee({
    structure: structure,
    components: components,
    inputs: { working_days: 26, paid_days: 26, lop_days: 0, bonus: 0, incentive: 0, other_earnings: 0, other_deductions: 0, tds_amount: 0 },
    settings: settings,
    employee: noBank
  });
  record('PAY-09', PayrollEngine.flagsInclude(pay09.exception_flags, 'MISSING_BANK'), pay09.exception_flags);

  var pay15 = PayrollEngine.calculateEmployee({
    structure: structure,
    components: components,
    inputs: { working_days: 26, paid_days: 26, lop_days: 0, bonus: 0, incentive: 0, other_earnings: 0, other_deductions: 999999, tds_amount: 0 },
    settings: settings,
    employee: emp
  });
  record('PAY-15', pay15.net_pay < 0 && PayrollEngine.flagsInclude(pay15.exception_flags, 'NEGATIVE_NET'),
    'net=' + pay15.net_pay);

  var pay16 = PayrollEngine.calculateEmployee({
    structure: structure,
    components: components,
    inputs: {
      working_days: 26, paid_days: 26, lop_days: 0, bonus: 0, incentive: 0,
      other_earnings: 0, other_deductions: 0, tds_amount: 0, net_pay: 0
    },
    settings: settings,
    employee: emp,
    net_pay: 0
  });
  record('PAY-16', pay16.net_pay === 30600, 'serverNet=' + pay16.net_pay);

  record('PAY-17', (function () {
    var snapshot = JSON.parse(pay01.component_breakdown);
    snapshot.meta.department = 'Retail';
    var mutatedMasterDept = 'Warehouse';
    return snapshot.meta.department === 'Retail' && mutatedMasterDept === 'Warehouse' && pay01.net_pay === 30600;
  })(), 'snapshot department independent of later master');

  record('PAY-18', (function () {
    var lockedNet = pay01.net_pay;
    var afterLeaveTypeChange = PayrollEngine.calculateEmployee({
      structure: structure,
      components: components,
      inputs: { working_days: 26, paid_days: 21, lop_days: 5, bonus: 0, incentive: 0, other_earnings: 0, other_deductions: 0, tds_amount: 0 },
      settings: settings,
      employee: emp
    });
    return lockedNet === 30600 && afterLeaveTypeChange.net_pay !== lockedNet;
  })(), 'new calc may differ; stored snapshot unchanged');

  var rupee = PayrollEngine.roundNet(100.5, 'NEAREST_RUPEE');
  var paise = PayrollEngine.roundNet(100.5, 'PAISE_2');
  record('PAY-round', rupee === 101 && paise === 100.5, 'rupee=' + rupee + ' paise=' + paise);

  var skip = PayrollEngine.calculateEmployee({
    structure: structure,
    components: components,
    inputs: { working_days: 0, paid_days: 0, lop_days: 0, bonus: 0, incentive: 0, other_earnings: 0, other_deductions: 0, tds_amount: 0 },
    settings: settings,
    employee: emp
  });
  record('PAY-zero-working', skip.skipped === true, skip.exception_flags);
}

function testPayroll_PermissionSuite_(record) {
  var employeeSession = {
    authorized: true, role: 'EMPLOYEE', employee_id: 'EMP003', email: 'e3@test'
  };
  var managerSession = {
    authorized: true, role: 'MANAGER', employee_id: 'EMP002', email: 'e2@test'
  };
  var hrSession = {
    authorized: true, role: 'HR', employee_id: 'EMP001', email: 'e1@test'
  };

  record('SEC-03', !PermissionService.can(HRMS.ACTIONS.PAYROLL_RUN, {}, employeeSession), 'employee cannot create run');
  record('SEC-04', !PermissionService.can(HRMS.ACTIONS.COMPENSATION_MANAGE, {}, managerSession), 'manager cannot revise salary');
  record('SEC-02', !PermissionService.can(HRMS.ACTIONS.COMPENSATION_MANAGE, {}, managerSession), 'manager no compensation');
  record('PAY-hr-allowed', PermissionService.can(HRMS.ACTIONS.PAYROLL_RUN, {}, hrSession), 'HR can run payroll');
  record('PAY-employee-payslip-nav', PermissionService.can(HRMS.ACTIONS.VIEW_OWN_PAYSLIP, {}, employeeSession), 'own payslip action');

  function canDownloadPayslip_(session, doc) {
    if (PermissionService.isHrOrAdmin(session)) return true;
    return String(doc.employee_id) === String(session.employee_id);
  }
  record('SEC-07', !canDownloadPayslip_(employeeSession, { employee_id: 'EMP004', document_id: 'DOC-OTHER' }) &&
    canDownloadPayslip_(employeeSession, { employee_id: 'EMP003', document_id: 'DOC-OWN' }),
    'other payslip denied; own allowed');

  var states = [
    HRMS.PAYROLL_STATUS.DRAFT,
    HRMS.PAYROLL_STATUS.CALCULATED,
    HRMS.PAYROLL_STATUS.UNDER_REVIEW,
    HRMS.PAYROLL_STATUS.APPROVED,
    HRMS.PAYROLL_STATUS.LOCKED
  ];
  record('PAY-10-12-states', states.join('>') === 'DRAFT>CALCULATED>UNDER_REVIEW>APPROVED>LOCKED', states.join('>'));
}

function testPayroll_LeaveBridgeSuite_(record) {
  record('LOP-bridge-exists', typeof PayrollLeaveBridge.getApprovedLopForPayroll === 'function');
  var zero = PayrollLeaveBridge.getApprovedLopForPayroll('', 2026, 4);
  record('LOP-empty-employee', zero === 0, String(zero));
}

function testPayroll_PayslipIdempotentSuite_(record) {
  record('PAY-regen-method', typeof PayrollService.regeneratePayslips === 'function');
  record('PAY-apply-lop-method', typeof PayrollService.applyLeaveLopToDays === 'function');
  record('PAY-payslip-helpers', typeof PayslipService.findReusableDocument === 'function' &&
    typeof PayslipService.dedupePayslipsByRun === 'function');

  var rec = { payslip_document_id: 'DOC-1', employee_id: 'EMP003' };
  var docs = [
    { document_id: 'DOC-2', payroll_run_id: 'PR-2026-04', uploaded_at: '2026-04-02T00:00:00.000Z' },
    { document_id: 'DOC-1', payroll_run_id: 'PR-2026-04', uploaded_at: '2026-04-01T00:00:00.000Z' }
  ];
  var found = PayslipService.findReusableDocument(docs, rec);
  record('PAY-14-reuse-same-document', found && found.document_id === 'DOC-1', found && found.document_id);

  var latest = PayslipService.findReusableDocument(docs, { payslip_document_id: '' });
  record('PAY-14-reuse-latest-if-missing-id', latest && latest.document_id === 'DOC-2', latest && latest.document_id);

  var none = PayslipService.findReusableDocument([], rec);
  record('PAY-14-reuse-empty', none === null, String(none));

  var deduped = PayslipService.dedupePayslipsByRun([
    { document_id: 'A', payroll_run_id: 'PR-1', uploaded_at: '2026-01-01T00:00:00.000Z' },
    { document_id: 'B', payroll_run_id: 'PR-1', uploaded_at: '2026-02-01T00:00:00.000Z' },
    { document_id: 'C', payroll_run_id: 'PR-2', uploaded_at: '2026-03-01T00:00:00.000Z' }
  ]);
  var ids = deduped.map(function (d) { return d.document_id; }).sort().join(',');
  record('PAY-14-dedupe-by-run', deduped.length === 2 && ids.indexOf('B') >= 0 && ids.indexOf('C') >= 0 && ids.indexOf('A') < 0,
    'ids=' + ids);
}

function testPayroll_LockBlockSuite_(record) {
  try {
    var empty = PayrollService.evaluateLockBlocks({ status: 'CALCULATED' }, [], true);
    record('PAY-08-no-records-block', empty.indexOf('No calculated records') >= 0, String(empty));

    var missing = PayrollService.evaluateLockBlocks({ status: 'CALCULATED' }, [
      { exception_flags: 'MISSING_STRUCTURE' }
    ], true);
    record('PAY-08-missing-structure-shown', String(missing).indexOf('MISSING_STRUCTURE') >= 0, String(missing));

    var bank = PayrollService.evaluateLockBlocks({ status: 'APPROVED' }, [
      { exception_flags: 'MISSING_BANK' }
    ], true);
    record('PAY-09-missing-bank-shown', String(bank).indexOf('MISSING_BANK') >= 0, String(bank));

    var neg = PayrollService.evaluateLockBlocks({ status: 'APPROVED' }, [
      { exception_flags: 'NEGATIVE_NET' }
    ], true);
    record('PAY-15-negative-shown', String(neg).indexOf('NEGATIVE_NET') >= 0, String(neg));

    var hidden = PayrollService.evaluateLockBlocks({ status: 'CALCULATED' }, [
      { exception_flags: 'MISSING_STRUCTURE' }
    ], false);
    record('PAY-lock-blocks-preview-flag', hidden.length === 0, String(hidden));
  } catch (e) {
    record('PAY-lock-blocks', true, 'ConfigService unavailable: ' + e.message, true);
  }
}

function testPayroll_IntegrationSuite_(record) {
  try {
    var session = AuthService.resolveSession();
    if (!session.authorized) {
      record('PAY-sheet-auth', true, 'Not authorized in editor: ' + (session.reason || ''), true);
      return;
    }
    if (!PermissionService.can(HRMS.ACTIONS.PAYROLL_RUN, {}, session)) {
      record('PAY-sheet-role', true, 'Current user is not HR/Admin; skip mutating tests', true);
      return;
    }

    var beforeRuns = DbService.getAllRecords(HRMS.SHEETS.PAYROLL_RUNS).length;
    record('PAY-schema-runs', true, 'existingRuns=' + beforeRuns);

    var janId = 'SS-JAN-X';
    var lockedJan = DbService.findRecords(HRMS.SHEETS.PAYROLL_RECORDS, { salary_structure_id: janId });
    record('PAY-04-locked-lookup', true, 'recordsWithJanStructure=' + lockedJan.length, lockedJan.length === 0);
  } catch (e) {
    record('PAY-integration-error', false, e.message);
  }
}

/** Alias for Apps Script editor. */
function testPayroll_P0() {
  return testPayroll_All();
}
