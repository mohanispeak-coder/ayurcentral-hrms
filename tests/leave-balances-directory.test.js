/**
 * Leave balances directory smoke tests.
 * Run: node tests/leave-balances-directory.test.js
 */
var fs = require('fs');
var path = require('path');

var root = path.join(__dirname, '..', 'apps-script', 'src');
var failures = [];
var passed = 0;

function check(name, cond) {
  if (cond) { passed++; console.log('PASS ' + name); }
  else { failures.push(name); console.log('FAIL ' + name); }
}

var emp = fs.readFileSync(path.join(root, 'employee', 'EmployeeService.gs'), 'utf8');
var api = fs.readFileSync(path.join(root, 'employee', 'ApiEmployee.gs'), 'utf8');
var perm = fs.readFileSync(path.join(root, 'foundation', 'PermissionService.gs'), 'utf8');
var leaveUi = fs.readFileSync(path.join(root, 'leave', 'LeaveUi.html'), 'utf8');
var scripts = fs.readFileSync(path.join(root, 'ui', 'Scripts.html'), 'utf8');

check('list-leave-balances-service', /listLeaveBalancesDirectory/.test(emp));
check('api-leave-balances', /apiGetLeaveBalancesDirectory/.test(api));
check('nav-leave-balances', /leave-balances/.test(perm) && /leave-balances/.test(scripts));
check('leave-ui-balances-route', /renderLeaveBalances/.test(leaveUi) && /apiGetLeaveBalancesDirectory/.test(leaveUi));

if (failures.length) {
  console.log('\n' + failures.length + ' failed');
  process.exit(1);
}
console.log('\nAll leave-balances-directory checks passed (' + passed + ')');
