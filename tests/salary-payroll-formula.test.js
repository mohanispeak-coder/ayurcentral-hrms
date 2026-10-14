/**
 * SalaryPayrollFormulaService — template sections (rate, earned ROUND_LINE, PF/ESIC/PT).
 * Run: node tests/salary-payroll-formula.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = path.join(__dirname, '..', 'apps-script', 'src');
const context = {
  HRMS: {},
  Logger: { log: function () {} },
  validationError_: function (m) { var e = new Error(m); e.hrmsCode = true; return e; }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(src, 'foundation', 'Constants.gs'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(src, 'payroll', 'PayrollEngine.gs'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(src, 'payroll', 'SalaryComponentExpandService.gs'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(src, 'payroll', 'SalaryPayrollFormulaService.gs'), 'utf8'), context);

const Expand = context.SalaryComponentExpandService;
const Engine = context.PayrollEngine;
const Formula = context.SalaryPayrollFormulaService;
const failures = [];

function check(name, cond, detail) {
  if (cond) console.log('PASS ' + name + (detail ? ' — ' + detail : ''));
  else {
    failures.push(name);
    console.log('FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}

var template = [
  { structure_section: 'RATE_OF_PAY', component_code: 'BP', component_name: 'Basic', component_kind: 'EARNING',
    calc_method: 'PERCENT', percent_base: 'CTC', percent: 60, sort_order: 1 },
  { structure_section: 'RATE_OF_PAY', component_code: 'HRA', component_name: 'HRA', component_kind: 'EARNING',
    calc_method: 'PERCENT', percent_base: 'BP', percent: 40, sort_order: 2 },
  { structure_section: 'RATE_OF_PAY', component_code: 'CONV', component_name: 'Conv', component_kind: 'EARNING',
    calc_method: 'FIXED', amount: 1600, sort_order: 3 },
  { structure_section: 'RATE_OF_PAY', component_code: 'MED', component_name: 'Med', component_kind: 'EARNING',
    calc_method: 'FIXED', amount: 1250, sort_order: 4 },
  { structure_section: 'RATE_OF_PAY', component_code: 'SA', component_name: 'SA', component_kind: 'EARNING',
    calc_method: 'BALANCE_OF_CTC', sort_order: 5 },
  { structure_section: 'EARNED_PAY', component_code: '*', component_name: 'All', component_kind: 'EARNING',
    calc_method: 'PRORATE_ROUND_LINE', round_mode: 'ROUND', sort_order: 6 },
  { structure_section: 'DEDUCTION', component_code: 'PF', component_name: 'PF', component_kind: 'DEDUCTION',
    calc_method: 'PERCENT_CAPPED', percent_base: 'BP', percent: 12, cap_amount: 25000, round_mode: 'ROUND', sort_order: 10 },
  { structure_section: 'DEDUCTION', component_code: 'ESIC', component_name: 'ESIC', component_kind: 'DEDUCTION',
    calc_method: 'PERCENT_IF', cond_ref: 'RATE_GROSS', cond_op: 'LT', cond_value: 21001,
    percent_base: 'EARNED_GROSS', percent: 0.75, round_mode: 'ROUNDUP', sort_order: 11 },
  { structure_section: 'DEDUCTION', component_code: 'PT', component_name: 'PT', component_kind: 'DEDUCTION',
    calc_method: 'THRESHOLD_FEE', cond_ref: 'EARNED_GROSS', cond_op: 'LTE', cond_value: 25000, amount: 200,
    round_mode: 'ROUND', sort_order: 12 }
];

var ctc = 35000;
var expanded = Expand.expandTemplateComponents(template, ctc);
var pay = Engine.calculateEmployee({
  structure: { salary_structure_id: 'SS-1', ctc_monthly: ctc },
  components: expanded,
  templateComponents: template,
  payroll_rules: { earned_prorate: 'ROUND_LINE' },
  inputs: { working_days: 30, paid_days: 30, tds_amount: 0, other_deductions: 0 },
  settings: { payroll_round: 'NEAREST_RUPEE' },
  employee: { employee_id: 'E1' }
});

check('uses formula engine', pay.gross_earnings === ctc, 'gross=' + pay.gross_earnings);
check('pf on full attendance', pay.total_deductions > 0);

var payHalf = Engine.calculateEmployee({
  structure: { salary_structure_id: 'SS-1', ctc_monthly: ctc },
  components: Expand.expandTemplateComponents(template, ctc),
  templateComponents: template,
  payroll_rules: { earned_prorate: 'ROUND_LINE' },
  inputs: { working_days: 30, paid_days: 15 },
  settings: {},
  employee: { employee_id: 'E1' }
});
check('half month earned gross below full', payHalf.gross_earnings < ctc, 'gross=' + payHalf.gross_earnings);

var templateFactor = JSON.parse(JSON.stringify(template));
templateFactor[5].calc_method = 'PRORATE_FACTOR';
var payFactor = Engine.calculateEmployee({
  structure: { salary_structure_id: 'SS-1', ctc_monthly: ctc },
  components: Expand.expandTemplateComponents(templateFactor, ctc),
  templateComponents: templateFactor,
  payroll_rules: { earned_prorate: 'FACTOR' },
  inputs: { working_days: 30, paid_days: 15 },
  settings: {},
  employee: { employee_id: 'E1' }
});
check('legacy PRORATE_FACTOR matches daily rate', payFactor.gross_earnings === payHalf.gross_earnings,
  'factor gross=' + payFactor.gross_earnings + ' daily=' + payHalf.gross_earnings);

var breakdown = JSON.parse(pay.component_breakdown || '{}');
check('breakdown has four sections', breakdown.sections && breakdown.sections.rate_of_pay &&
  breakdown.sections.earned_pay && breakdown.sections.deduction_formulas && breakdown.sections.manual_deductions);

if (failures.length) {
  console.error('\n' + failures.length + ' failed');
  process.exit(1);
}
console.log('\nAll SalaryPayrollFormulaService checks passed');
