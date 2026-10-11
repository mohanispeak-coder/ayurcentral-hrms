/**
 * SalaryComponentExpandService — BP from CTC, HRA from BP, SA balance.
 * Run: node tests/salary-component-expand.test.js
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
vm.runInContext(fs.readFileSync(path.join(src, 'payroll', 'SalaryComponentExpandService.gs'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(src, 'payroll', 'PayrollEngine.gs'), 'utf8'), context);

const Expand = context.SalaryComponentExpandService;
const Engine = context.PayrollEngine;
const failures = [];

function check(name, cond, detail) {
  if (cond) console.log('PASS ' + name + (detail ? ' — ' + detail : ''));
  else {
    failures.push(name);
    console.log('FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}

var template = [
  { component_code: 'BP', component_name: 'Basic Pay', component_kind: 'EARNING', calc_method: 'PERCENT_OF_CTC', percent: 50, sort_order: 1 },
  { component_code: 'HRA', component_name: 'HRA', component_kind: 'EARNING', calc_method: 'PERCENT_OF_BASIC', percent: 20, sort_order: 2 },
  { component_code: 'SA', component_name: 'Special Allowance', component_kind: 'EARNING', calc_method: 'BALANCE_OF_CTC', sort_order: 3 },
  { component_code: 'PF', component_name: 'PF', component_kind: 'DEDUCTION', calc_method: 'PERCENT_OF_BASIC', percent: 12, sort_order: 4 }
];

var expanded = Expand.expandTemplateComponents(template, 50000);
var basic = expanded.filter(function (c) { return c.component_code === 'BASIC'; })[0];
var hra = expanded.filter(function (c) { return c.component_code === 'HRA'; })[0];
var sa = expanded.filter(function (c) { return c.component_code === 'SA'; })[0];

check('bp from ctc', basic && basic.amount === 25000);
check('hra stays percent of basic', hra && hra.calc_method === 'PERCENT_OF_BASIC' && hra.percent === 20);
check('sa balance', sa && sa.amount === 20000);

var basicAmt = basic.amount;
var earnSum = expanded.filter(function (c) { return c.component_kind === 'EARNING'; }).reduce(function (s, c) {
  if (c.calc_method === 'FIXED') return s + c.amount;
  if (c.calc_method === 'PERCENT_OF_BASIC') return s + basicAmt * c.percent / 100;
  return s;
}, 0);
check('earnings equal ctc', earnSum === 50000);

var payroll = Engine.calculateEmployee({
  structure: { salary_structure_id: 'SS-001' },
  components: expanded,
  inputs: { working_days: 30, paid_days: 30 },
  settings: {},
  employee: { employee_id: 'E1' }
});
check('payroll gross', payroll.gross_earnings === 50000);

var warn = Expand.earningsReconcileWarning(template, 50000);
check('no reconcile warning', !warn, warn || '');

if (failures.length) {
  console.error('\n' + failures.length + ' failed');
  process.exit(1);
}
console.log('\nAll SalaryComponentExpandService checks passed');
