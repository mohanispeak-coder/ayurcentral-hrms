/**
 * Integration-pass checks: shell wiring, RBAC nav, event hooks, public ATS entry.
 * Run: node tests/integration-shell.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const src = path.join(root, 'apps-script', 'src');
const failures = [];

function read(rel) {
  return fs.readFileSync(path.join(src, rel), 'utf8');
}

function check(name, cond, detail) {
  if (cond) {
    console.log('PASS ' + name + (detail ? ' — ' + detail : ''));
  } else {
    failures.push(name + (detail ? ': ' + detail : ''));
    console.log('FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}

const main = read('foundation/Main.gs');
const scripts = read('ui/Scripts.html');
const index = read('ui/Index.html');
const api = read('foundation/ApiFoundation.gs');
const permSrc = read('foundation/PermissionService.gs');
const schema = read('foundation/SchemaService.gs');
const leave = read('leave/LeaveService.gs');
const payroll = read('payroll/PayrollService.gs');
const payrollApi = read('payroll/ApiPayroll.gs');
const payrollBulk = read('payroll/PayrollBulkService.gs');
const pms = read('pms/PmsService.gs');
const ats = read('ats/AtsService.gs');
const atsWeb = read('ats/AtsWeb.gs');

check('doGet-ats-public', /AtsWeb\.tryServe/.test(main), 'Main.gs public/internal ATS entry');
check('index-bell-slot', /ntf-bell-slot/.test(index) && /NotificationBell/.test(index));
check('lazy-pms', /pms:\s*\['pms\/PmsClient'\]/.test(api));
check('lazy-ats', /ats:\s*\['ats\/AtsClient'\]/.test(api));
check('lazy-ntf', /notifications:\s*\['notifications\/NotificationClient'\]/.test(api));
check('route-pms', /'pms-my-review':\s*'pms'/.test(scripts));
check('route-ats', /'ats-candidates':\s*'ats'/.test(scripts));
check('route-ntf', /notifications:\s*'notifications'/.test(scripts));
check('nav-recruit', /id:\s*'recruitment'/.test(scripts));
check('schema-module-hook', /ensureModuleSheets_/.test(schema));
check('leave-inbox-submit', /NotificationLeaveAdapter\.notifySubmitted/.test(leave));
check('leave-inbox-hr-notify', /notifyHrReviewRequired/.test(read('notifications/NotificationAdapters.gs')));
check('leave-inbox-mgr-notify', /notifyManagerApprovalRequired/.test(read('notifications/NotificationAdapters.gs')));
check('leave-inbox-approve', /NotificationLeaveAdapter\.notifyApproved/.test(leave));
check('leave-inbox-reject', /NotificationLeaveAdapter\.notifyRejected/.test(leave));
check('leave-inbox-cancel', /NotificationLeaveAdapter\.notifyCancelled/.test(leave));
check('leave-email-retained', /MailApp\.sendEmail/.test(leave));
check('payroll-locked-notify', /NotificationPayrollAdapter\.notifyLocked/.test(payroll));
check('payroll-payslip-notify-disabled', !/regeneratePayslipForEmployee[\s\S]{0,500}notifyPayslipsAvailable/.test(payroll));
check('payroll-finalize-api', /apiFinalizePayroll/.test(payrollApi));
check('payroll-bulk-api', /apiValidatePayrollUpload/.test(payrollApi) && /PayrollBulkService/.test(payrollBulk));
check('pms-cycle-open-notify', /NotificationPmsAdapter\.notifyCycleOpen/.test(pms));
check('pms-manager-notify', /notifyManagerReviewPending/.test(pms));
check('pms-final-notify', /notifyFinalized/.test(pms));
check('ats-apply-notify', /notifyNewApplication/.test(ats));
check('ats-no-employee-on-apply', /created_employee:\s*false/.test(ats));
check('ats-web-internal-first', /isInternalAppRequest\(e\)[\s\S]*isPublicApplyRequest/.test(atsWeb));
check('home-dashboard-api', /apiGetHomeDashboard/.test(api));
check('home-dashboard-more-api', /apiGetHomeDashboardMore/.test(api));
check('no-immediate-module-herd', !/setTimeout\(preloadModulesFromNav,\s*0\)/.test(scripts));
check('idle-preload', /idle-one-at-a-time/.test(scripts) && /requestIdleCallback/.test(scripts));
check('user-rpc-priority', /pauseBackgroundPreload/.test(scripts) && /userRpcBusy_/.test(scripts));

const context = {
  HRMS: {},
  AuthService: {
    resolveSession: function () { return { authorized: false }; },
    requireAuth: function () { throw new Error('auth'); }
  }
};
vm.createContext(context);
vm.runInContext(read('foundation/Constants.gs'), context);
vm.runInContext(permSrc, context);

const nav = context.PermissionService.getNavForRole;
const empRoutes = nav('EMPLOYEE').map(function (i) { return i.route; });
const mgrRoutes = nav('MANAGER').map(function (i) { return i.route; });
const hrRoutes = nav('HR').map(function (i) { return i.route; });
const adminRoutes = nav('ADMIN').map(function (i) { return i.route; });

check('rbac-employee-no-ats', empRoutes.indexOf('ats') < 0);
check('rbac-employee-pms', empRoutes.indexOf('pms') >= 0 && empRoutes.indexOf('pms-cycles') < 0);
check('rbac-employee-no-payroll-admin', empRoutes.indexOf('payroll') < 0);
check('rbac-manager-ats', mgrRoutes.indexOf('ats') >= 0);
check('rbac-manager-no-cycles', mgrRoutes.indexOf('pms-cycles') < 0);
check('rbac-hr-pms-admin', hrRoutes.indexOf('pms-cycles') >= 0 && hrRoutes.indexOf('ats-jobs') >= 0);
check('rbac-admin-notifications', adminRoutes.indexOf('notifications') >= 0);
check('rbac-employee-no-notifications-nav', empRoutes.indexOf('notifications') < 0);

const ntfEngine = { HRMS: {}, Logger: { log: function () {} } };
vm.createContext(ntfEngine);
vm.runInContext(read('foundation/Constants.gs'), ntfEngine);
vm.runInContext(read('notifications/NotificationEngine.gs'), ntfEngine);
const E = ntfEngine.NotificationEngine;
const store = E.memoryStore();
const leaveReq = { leave_request_id: 'LR-1', employee_id: 'EMP001', start_date: '2026-09-01', end_date: '2026-09-02' };
const employeeRec = { employee_id: 'EMP001', display_name: 'Ada', email: 'a@x.com' };
const payload = E.payloads.leaveApproved(leaveReq, employeeRec);
payload.force_email = false;
payload.force_in_app = true;
let n = 0;
const created = E.inbox.create(store, payload, {
  now: new Date(),
  idFactory: function () { n += 1; return 'INB-' + n; },
  preferences: [],
  orgSettings: { notification_leave: true }
});
check('ntf-create', created.ok && created.created);
check('ntf-unread', E.inbox.unreadCount(store, { authorized: true, employee_id: 'EMP001', email: 'a@x.com', role: 'EMPLOYEE' }) === 1);
check('ntf-approved-route', payload.action_route === 'my-leave', payload.action_route);
const dup = E.inbox.create(store, payload, {
  now: new Date(),
  idFactory: function () { n += 1; return 'INB-' + n; },
  preferences: [],
  orgSettings: { notification_leave: true }
});
check('ntf-dedupe', dup.ok && dup.created === false, 'duplicate leave approved is suppressed');

if (failures.length) {
  console.error('\n' + failures.length + ' failed');
  process.exit(1);
}
console.log('\nAll integration-shell checks passed.');
