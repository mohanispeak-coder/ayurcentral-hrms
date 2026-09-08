/**
 * Ask HR employee/master-data routing contracts.
 * Run: node tests/ask-hr-employee-routing.test.js
 */
var fs = require('fs');
var path = require('path');

var failures = [];
var passed = 0;

function check(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log('PASS ' + name + (detail ? ' — ' + detail : ''));
  } else {
    failures.push(name + (detail ? ': ' + detail : ''));
    console.log('FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

var lookup = read('apps-script/src/knowledge/AskHrEmployeeLookup.gs');
var ask = read('apps-script/src/knowledge/AskHrService.gs');
var hub = read('apps-script/src/knowledge/KnowledgeHubClient.gs');

check('employee-lookup-module', /var AskHrEmployeeLookup/.test(lookup));
check('classifies-self-manager', /kind: 'MY_MANAGER'/.test(lookup) && /who\\s\+is\\s\+my\\s\+manager/.test(lookup));
check('classifies-self-department', /kind: 'MY_DEPARTMENT'/.test(lookup) && /my\\s\+department/.test(lookup));
check('no-directory-lookup-helpers',
  !/function answerManagerOf_/.test(lookup) &&
  !/function answerDepartmentOf_/.test(lookup) &&
  !/function answerReportsTo_/.test(lookup) &&
  !/function scopedEmployees_/.test(lookup) &&
  !/function matchEmployees_/.test(lookup));
check('no-directory-classification-kinds',
  lookup.indexOf("kind: 'MANAGER_OF'") === -1 &&
  lookup.indexOf("kind: 'REPORTS_TO'") === -1 &&
  lookup.indexOf("kind: 'DEPARTMENT_OF'") === -1);
check('self-profile-still-uses-listall', /managerNameMap_/.test(lookup) && /EmployeeRepository\.listAll/.test(lookup));
check('no-hub-for-handled-employee', /AskHrEmployeeLookup\.tryAnswer/.test(ask) && /employeeAnswer\.handled/.test(ask));
check('self-profile-only-short-circuit', /MY_MANAGER/.test(lookup) && /MY_DEPARTMENT/.test(lookup) && /return \{ handled: false \}/.test(lookup));
check('hub-after-employee-miss', /KnowledgeHubClient\.submit/.test(ask));
check('employee-answer-no-extra-rpc', (ask.match(/KnowledgeHubClient\.submit/g) || []).length === 1);
check('employee-answer-shape', /answer: String\(employeeAnswer\.answer/.test(ask));
check('does-not-send-employee-id-to-hub', !/employee_id.*KnowledgeHubClient/.test(ask + hub));

check('no-gemini-call-in-employee-lookup', !/callGemini|DriveApp|UrlFetchApp|queryDriveFolder/.test(lookup));

if (failures.length) {
  console.error('\n' + failures.length + ' failure(s):\n- ' + failures.join('\n- '));
  process.exit(1);
}
console.log('\nAll ask-hr-employee-routing checks passed (' + passed + ')');
