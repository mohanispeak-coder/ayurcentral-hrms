/**
 * Local PayrollEngine + payslip helper tests (11_TEST_PLAN.md P0 math).
 * Run: node tests/payroll-engine.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = path.join(__dirname, '..', 'apps-script', 'src');
const context = {
  HRMS: {},
  Logger: { log: function () {} },
  DriveService: {},
  DbService: {},
  PermissionService: {},
  ConfigService: {},
  Utilities: {},
  DriveApp: {}
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(src, 'foundation', 'Constants.gs'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(src, 'payroll', 'PayrollEngine.gs'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(src, 'payroll', 'PayslipService.gs'), 'utf8'), context);

const PayrollEngine = context.PayrollEngine;
const PayslipService = context.PayslipService;
const failures = [];

function check(name, cond, detail) {
  if (cond) {
    console.log('PASS ' + name + (detail ? ' — ' + detail : ''));
  } else {
    failures.push(name + (detail ? ': ' + detail : ''));
    console.log('FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}

const components = [
  { component_code: 'BASIC', component_name: 'Basic', component_kind: 'EARNING', calc_method: 'FIXED', amount: 20000, sort_order: 1 },
  { component_code: 'HRA', component_name: 'HRA', component_kind: 'EARNING', calc_method: 'PERCENT_OF_BASIC', percent: 40, sort_order: 2 },
  { component_code: 'SA', component_name: 'Special', component_kind: 'EARNING', calc_method: 'FIXED', amount: 5000, sort_order: 3 },
  { component_code: 'PF', component_name: 'PF', component_kind: 'DEDUCTION', calc_method: 'PERCENT_OF_BASIC', percent: 12, sort_order: 4 },
  { component_code: 'EMPLOYER_PF', component_name: 'Employer PF', component_kind: 'EMPLOYER', calc_method: 'PERCENT_OF_BASIC', percent: 12, sort_order: 5 }
];
const structure = { salary_structure_id: 'SS-TEST-X' };
const emp = {
  employee_id: 'EMP003',
  display_name: 'Test Employee',
  department: 'Retail',
  designation: 'Associate',
  pan: 'ABCDE1234F',
  bank_account_number: '123456789012',
  bank_ifsc: 'HDFC0000001'
};
const settings = { payroll_round: 'PAISE_2' };

const pay01 = PayrollEngine.calculateEmployee({
  structure: structure,
  components: components,
  inputs: { working_days: 26, paid_days: 26, lop_days: 0, bonus: 0, incentive: 0, other_earnings: 0, other_deductions: 0, tds_amount: 0 },
  settings: settings,
  employee: emp
});
check('PAY-01', pay01.gross_earnings === 33000 && pay01.total_deductions === 2400 &&
  pay01.net_pay === 30600 && pay01.employer_contributions === 2400,
  'gross=' + pay01.gross_earnings + ' net=' + pay01.net_pay);

const pay02 = PayrollEngine.calculateEmployee({
  structure: structure,
  components: components,
  inputs: { working_days: 30, paid_days: 15, lop_days: 0, bonus: 0, incentive: 0, other_earnings: 0, other_deductions: 0, tds_amount: 0 },
  settings: settings,
  employee: emp
});
check('PAY-02', pay02.gross_earnings === 16500 && pay02.net_pay === 15300, 'gross=' + pay02.gross_earnings);

const pay03 = PayrollEngine.calculateEmployee({
  structure: structure,
  components: components,
  inputs: { working_days: 26, paid_days: 24, lop_days: 2, bonus: 0, incentive: 0, other_earnings: 0, other_deductions: 0, tds_amount: 0 },
  settings: settings,
  employee: emp
});
check('PAY-03', pay03.net_pay < pay01.net_pay && pay03.lop_days === 2, 'net=' + pay03.net_pay);

const jan = PayrollEngine.calculateEmployee({
  structure: { salary_structure_id: 'SS-JAN-X' },
  components: [{ component_code: 'BASIC', component_name: 'Basic', component_kind: 'EARNING', calc_method: 'FIXED', amount: 10000, sort_order: 1 }],
  inputs: { working_days: 26, paid_days: 26, lop_days: 0, bonus: 0, incentive: 0, other_earnings: 0, other_deductions: 0, tds_amount: 0 },
  settings: settings,
  employee: emp
});
const april = PayrollEngine.calculateEmployee({
  structure: { salary_structure_id: 'SS-APR-Y' },
  components: [{ component_code: 'BASIC', component_name: 'Basic', component_kind: 'EARNING', calc_method: 'FIXED', amount: 15000, sort_order: 1 }],
  inputs: { working_days: 26, paid_days: 26, lop_days: 0, bonus: 0, incentive: 0, other_earnings: 0, other_deductions: 0, tds_amount: 0 },
  settings: settings,
  employee: emp
});
check('PAY-04', jan.net_pay === 10000 && april.net_pay === 15000 &&
  jan.salary_structure_id === 'SS-JAN-X' && april.salary_structure_id === 'SS-APR-Y');

const pay05 = PayrollEngine.calculateEmployee({
  structure: structure,
  components: components,
  inputs: { working_days: 30, paid_days: 15, lop_days: 0, bonus: 10000, incentive: 2500, other_earnings: 0, other_deductions: 0, tds_amount: 0 },
  settings: settings,
  employee: emp
});
check('PAY-05', pay05.gross_earnings === 16500 + 10000 + 2500 && pay05.bonus === 10000 && pay05.incentive === 2500);

const breakdown01 = JSON.parse(pay01.component_breakdown);
const pfLine = breakdown01.lines.filter(function (l) { return l.component_code === 'PF'; })[0];
check('PAY-07', pfLine && pfLine.amount === 2400 && pay01.total_deductions === 2400);

const pay08 = PayrollEngine.calculateEmployee({
  structure: null,
  components: [],
  inputs: { working_days: 26, paid_days: 26, lop_days: 0, bonus: 0, incentive: 0, other_earnings: 0, other_deductions: 0, tds_amount: 0 },
  settings: settings,
  employee: emp
});
check('PAY-08', PayrollEngine.flagsInclude(pay08.exception_flags, 'MISSING_STRUCTURE'), pay08.exception_flags);

const pay09 = PayrollEngine.calculateEmployee({
  structure: structure,
  components: components,
  inputs: { working_days: 26, paid_days: 26, lop_days: 0, bonus: 0, incentive: 0, other_earnings: 0, other_deductions: 0, tds_amount: 0 },
  settings: settings,
  employee: {
    employee_id: 'EMP003', display_name: 'Test', department: 'Retail', designation: 'Associate',
    pan: 'ABCDE1234F', bank_account_number: '', bank_ifsc: ''
  }
});
check('PAY-09', PayrollEngine.flagsInclude(pay09.exception_flags, 'MISSING_BANK'), pay09.exception_flags);

const pay15 = PayrollEngine.calculateEmployee({
  structure: structure,
  components: components,
  inputs: { working_days: 26, paid_days: 26, lop_days: 0, bonus: 0, incentive: 0, other_earnings: 0, other_deductions: 999999, tds_amount: 0 },
  settings: settings,
  employee: emp
});
check('PAY-15', pay15.net_pay < 0 && PayrollEngine.flagsInclude(pay15.exception_flags, 'NEGATIVE_NET'), 'net=' + pay15.net_pay);

const pay16 = PayrollEngine.calculateEmployee({
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
check('PAY-16', pay16.net_pay === 30600, 'serverNet=' + pay16.net_pay);

check('PAY-round', PayrollEngine.roundNet(100.5, 'NEAREST_RUPEE') === 101 &&
  PayrollEngine.roundNet(100.5, 'PAISE_2') === 100.5);

const skip = PayrollEngine.calculateEmployee({
  structure: structure,
  components: components,
  inputs: { working_days: 0, paid_days: 0, lop_days: 0, bonus: 0, incentive: 0, other_earnings: 0, other_deductions: 0, tds_amount: 0 },
  settings: settings,
  employee: emp
});
check('PAY-zero-working', skip.skipped === true, skip.exception_flags);

const reuse = PayslipService.findReusableDocument([
  { document_id: 'DOC-2', uploaded_at: '2026-04-02' },
  { document_id: 'DOC-1', uploaded_at: '2026-04-01' }
], { payslip_document_id: 'DOC-1' });
check('PAY-payslip-reuse-id', reuse && reuse.document_id === 'DOC-1');

const latest = PayslipService.findReusableDocument([
  { document_id: 'DOC-2', uploaded_at: '2026-04-02' },
  { document_id: 'DOC-1', uploaded_at: '2026-04-01' }
], { payslip_document_id: '' });
check('PAY-payslip-reuse-latest', latest && latest.document_id === 'DOC-2');

const deduped = PayslipService.dedupePayslipsByRun([
  { document_id: 'A', payroll_run_id: 'PR-1', uploaded_at: '2026-01-01' },
  { document_id: 'B', payroll_run_id: 'PR-1', uploaded_at: '2026-02-01' },
  { document_id: 'C', payroll_run_id: 'PR-2', uploaded_at: '2026-03-01' }
]);
check('PAY-payslip-dedupe', deduped.length === 2 &&
  deduped.some(function (d) { return d.document_id === 'B'; }) &&
  deduped.some(function (d) { return d.document_id === 'C'; }) &&
  !deduped.some(function (d) { return d.document_id === 'A'; }));

if (failures.length) {
  console.error('\n' + failures.length + ' failed');
  process.exit(1);
}
console.log('\nAll payroll engine checks passed');
