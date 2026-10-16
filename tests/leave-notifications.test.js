/**
 * Leave approve/reject notification contracts.
 * Run: node tests/leave-notifications.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', 'apps-script', 'src');
const failures = [];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function check(name, cond, detail) {
  if (cond) {
    console.log('PASS ' + name + (detail ? ' — ' + detail : ''));
  } else {
    failures.push(name + (detail ? ': ' + detail : ''));
    console.log('FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}

const leave = read('leave/LeaveService.gs');
const adapters = read('notifications/NotificationAdapters.gs');
const engine = read('notifications/NotificationEngine.gs');
const ntfSvc = read('notifications/NotificationService.gs');
const schema = read('foundation/SchemaService.gs');

check('email-body-uses-employee-name', /Employee Name:/.test(leave));
check('email-body-not-employee-id-line', !/Open HRMS to review this leave request\.\\nEmployee ID:/.test(leave));
check('dispatch-loads-request-server-side', /DbService\.findOne\(HRMS\.SHEETS\.LEAVE_REQUESTS/.test(/function dispatchLeaveDecisionNotifications_[\s\S]{0,500}/.exec(leave)[0]));
check('dispatch-resolves-employee-server-side', /getEmployee_\(row\.employee_id\)/.test(/function dispatchLeaveDecisionNotifications_[\s\S]{0,500}/.exec(leave)[0]));
check('recipient-settings-schema', /leave_decision_notify_additional_email/.test(schema));
check('recipient-toggles-schema', /leave_decision_notify_manager/.test(schema) &&
  /leave_decision_notify_employee/.test(schema));
check('manager-notify-adapter', /notifyLeaveDecisionToManager/.test(adapters));
check('additional-notify-adapter', /notifyLeaveDecisionToAdditional/.test(adapters));
check('additional-from-config-not-client', /getSetting\('leave_decision_notify_additional_email'/.test(adapters));
check('engine-decision-notice', /function buildLeaveDecisionNotice/.test(engine));
check('retry-email-no-employee-id-suffix', !/Employee ID:/.test(/function retryEmail[\s\S]{0,800}/.exec(ntfSvc)[0]));
check('approve-uses-dispatch', /dispatchLeaveDecisionNotifications_\(leaveRequestId, 'LEAVE_APPROVED'/.test(leave));
check('reject-uses-dispatch', /dispatchLeaveDecisionNotifications_\(leaveRequestId, 'LEAVE_REJECTED'/.test(leave));
check('dedupe-recipients', /seen\[key\]/.test(/function resolveLeaveDecisionEmailRecipients_[\s\S]{0,600}/.exec(leave)[0]));

const ctx = {
  HRMS: {},
  Logger: { log: function () {} }
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'foundation', 'Constants.gs'), 'utf8'), ctx);
vm.runInContext(engine, ctx);
const E = ctx.NotificationEngine;

const employeeRec = { employee_id: 'EMP003', display_name: 'Ada Employee', email: 'ada@client.com' };
const mgrRec = { employee_id: 'EMP002', display_name: 'Mo Manager', email: 'mgr@client.com' };
const leaveReq = {
  leave_request_id: 'LR-100',
  employee_id: 'EMP003',
  start_date: '2026-08-03',
  end_date: '2026-08-05',
  total_days: 3
};

const approvedMgr = E.payloads.leaveDecisionNotice(leaveReq, employeeRec, mgrRec, 'approved', {});
check('decision-notice-title-name', String(approvedMgr.title).indexOf('Ada Employee') >= 0);
check('decision-notice-not-id-only', String(approvedMgr.message).indexOf('Employee Name: EMP003') < 0 ||
  String(approvedMgr.message).indexOf('Ada Employee') >= 0);

const approvedEmp = E.payloads.leaveApproved(leaveReq, employeeRec, {
  email_body: 'Employee Name: Ada Employee\nStatus: Approved'
});
check('approved-email-body-preserved', String(approvedEmp.email_body).indexOf('Ada Employee') >= 0);

if (failures.length) {
  console.error('\n' + failures.length + ' failed');
  process.exit(1);
}
console.log('\nAll leave-notifications checks passed');
