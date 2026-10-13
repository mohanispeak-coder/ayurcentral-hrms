/**
 * Leave policy configuration smoke tests.
 * Run: node tests/leave-policy.test.js
 */
var fs = require('fs');
var path = require('path');

var root = path.join(__dirname, '..', 'apps-script', 'src');
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

var policySrc = fs.readFileSync(path.join(root, 'leave', 'LeavePolicyService.gs'), 'utf8');
var schemaSrc = fs.readFileSync(path.join(root, 'foundation', 'SchemaService.gs'), 'utf8');
var constantsSrc = fs.readFileSync(path.join(root, 'foundation', 'Constants.gs'), 'utf8');
var settingsUi = fs.readFileSync(path.join(root, 'ui', 'SettingsClient.html'), 'utf8');
var leaveUi = fs.readFileSync(path.join(root, 'leave', 'LeaveUi.html'), 'utf8');
var apiLeave = fs.readFileSync(path.join(root, 'leave', 'ApiLeave.gs'), 'utf8');

check('leave-policy-service', /LeavePolicyService/.test(policySrc) && /computeLeaveYearEntitlement/.test(policySrc));
check('ledger-sheet', /LEAVE_MONTHLY_LEDGER/.test(constantsSrc) && /LEAVE_MONTHLY_LEDGER/.test(schemaSrc));
check('vertical-cf-columns', /leave_carry_forward_enabled/.test(schemaSrc));
check('policy-api', /apiLeaveGetPolicySettings/.test(apiLeave) && /apiLeaveSavePolicySettings/.test(apiLeave));
check('settings-leave-policy-ui', /Leave policy/.test(settingsUi) && /apiLeaveSavePolicySettings/.test(settingsUi));
check('apply-form-no-type-picker', !/for="leave-type">Leave type/.test(leaveUi) && /type="hidden" name="leave_type_id"/.test(leaveUi));

if (failures.length) {
  console.log('\n' + failures.length + ' failed:');
  failures.forEach(function (f) { console.log(' - ' + f); });
  process.exit(1);
}
console.log('\nAll leave-policy checks passed (' + passed + ')');
