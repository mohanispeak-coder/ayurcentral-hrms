/**
 * AttendancePayrollExtras — sheet parse and payroll line build.
 * Run: node tests/attendance-payroll-extras.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = path.join(__dirname, '..', 'apps-script', 'src');
const context = {
  HRMS: {},
  validationError_: function (m) { var e = new Error(m); e.hrmsCode = true; throw e; }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(src, 'foundation', 'Constants.gs'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(src, 'payroll', 'AttendancePayrollExtras.gs'), 'utf8'), context);

const Extras = context.AttendancePayrollExtras;
const failures = [];

function check(name, cond, detail) {
  if (cond) console.log('PASS ' + name);
  else failures.push(name + (detail ? ': ' + detail : ''));
}

var headers = ['employee_id', 'TDS', 'Advance', 'LCD', 'LWF', 'Arrears'];
var parsed = Extras.parseFromSheetRow(['E1', '100', '50', '', '25', '500'], headers);
check('parse sheet row', parsed.tds_amount === 100 && parsed.deduction_advance === 50 &&
  parsed.deduction_lwf === 25 && parsed.arrears_amount === 500);
check('sync other_deductions', parsed.other_deductions === 75);

var lines = Extras.buildManualDeductionLines(parsed);
check('deduction lines', lines.total === 175 && lines.lines.length === 3);

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('\nAll AttendancePayrollExtras checks passed');
