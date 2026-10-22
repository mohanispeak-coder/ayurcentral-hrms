/**
 * Leave carry-forward must be gated on Settings → Leave policy (vertical).
 * Run: node tests/leave-module-carry.test.js
 */
var fs = require('fs');
var path = require('path');

var root = path.join(__dirname, '..', 'apps-script', 'src');
var failures = [];

function check(name, cond) {
  if (cond) console.log('PASS ' + name);
  else { failures.push(name); console.log('FAIL ' + name); }
}

var policy = fs.readFileSync(path.join(root, 'leave', 'LeavePolicyService.gs'), 'utf8');
var monthly = fs.readFileSync(path.join(root, 'leave', 'MonthlyLeaveService.gs'), 'utf8');
var leaveSvc = fs.readFileSync(path.join(root, 'leave', 'LeaveService.gs'), 'utf8');
var empSvc = fs.readFileSync(path.join(root, 'employee', 'EmployeeService.gs'), 'utf8');
var settings = fs.readFileSync(path.join(root, 'ui', 'SettingsClient.html'), 'utf8');

check('yearly-cf-requires-enabled', /!policy\.carry_forward_enabled/.test(policy));
check('monthly-cf-readonly-gated', /monthlyOpeningCarryReadOnly/.test(policy) &&
  /carry_forward_frequency !== 'MONTHLY'/.test(policy));
check('no-writable-carry-on-read', !/monthlyOpeningCarry\(employeeId/.test(monthly));
check('balance-cf-from-policy', /yearlyCarryForwardAmount/.test(leaveSvc) &&
  !/carryForwardDays\(prev, type\.carry_forward_max_days\)/.test(leaveSvc));
check('seed-cf-from-policy', /yearlyCarryForwardAmount/.test(empSvc));
check('save-cf-max-when-enabled', /Set maximum carry-forward days when carry-forward is enabled/.test(policy));
check('settings-cf-validation', /CF max \(days\)/.test(settings));

if (failures.length) {
  console.log('\n' + failures.length + ' failed');
  process.exit(1);
}
console.log('\nAll leave-module-carry checks passed');
