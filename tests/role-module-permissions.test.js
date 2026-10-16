/**
 * Role module ↔ API action mapping smoke tests.
 * Run: node tests/role-module-permissions.test.js
 */
var fs = require('fs');
var path = require('path');

var root = path.join(__dirname, '..', 'apps-script', 'src', 'foundation');
var src = fs.readFileSync(path.join(root, 'SettingsAdminService.gs'), 'utf8');
var failures = [];
var passed = 0;

function check(name, cond) {
  if (cond) { passed++; console.log('PASS ' + name); }
  else { failures.push(name); console.log('FAIL ' + name); }
}

check('manager-directory-uses-my-team',
  /EMPLOYEE_DIRECTORY' && role === 'MANAGER'\) return 'my_team'/.test(src) ||
  /action === 'EMPLOYEE_DIRECTORY' && role === 'MANAGER'\) return 'my_team'/.test(src));
check('my-team-module-for-manager',
  /id: 'my_team'/.test(src) && /defaultRoles: \['MANAGER'\]/.test(src));
check('employees-module-not-manager-default',
  /id: 'employees'/.test(src) && /defaultRoles: \['HR', 'ADMIN'\]/.test(src));

if (failures.length) {
  console.log('\n' + failures.length + ' failed');
  process.exit(1);
}
console.log('\nAll role-module-permissions checks passed (' + passed + ')');
