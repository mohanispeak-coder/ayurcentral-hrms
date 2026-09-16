/**
 * Source-level contracts for leave performance (Phase 3).
 * Run: node tests/leave-perf.test.js
 */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'apps-script', 'src');
const failures = [];

function read(rel) {
  return fs.readFileSync(path.join(src, rel), 'utf8');
}

function fnBlock(source, name, nextName) {
  const start = source.indexOf('function ' + name);
  if (start < 0) return '';
  if (!nextName) return source.slice(start);
  const end = source.indexOf('function ' + nextName, start + 1);
  return end < 0 ? source.slice(start) : source.slice(start, end);
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
const api = read('leave/ApiLeave.gs');
const ui = read('leave/LeaveUi.html');
const client = read('leave/LeaveClient.html');
const db = read('foundation/DbService.gs');
const emp = read('employee/EmployeeService.gs');

check('apply-bundle-api', /function apiLeaveGetApplyBundle/.test(api));
check('apply-bundle-service', /function getApplyBootstrap/.test(leave));
check('apply-bundle-exported', /getApplyBootstrap:\s*getApplyBootstrap/.test(leave));
check('apply-ui-single-rpc', /apiLeaveGetApplyBundle/.test(ui));
check('apply-ui-no-triple-bootstrap', !/Promise\.all\([\s\S]{0,120}apiLeaveGetTypes/.test(ui));
check('apply-ui-no-my-leave-bootstrap', !/apiLeaveGetMyLeave[\s\S]{0,80}leave-apply/.test(ui));

check('preview-debounce', /previewTimer_/.test(ui) && /300/.test(ui));
check('preview-inflight', /previewBusy_/.test(ui) && /previewAgain_/.test(ui));
check('preview-stale', /previewGen_/.test(ui) && /gen !== previewGen_/.test(ui));

check('draft-edit-navigate-prefill', /navigate\('leave-apply',\s*\{\s*prefill:\s*row\s*\}\)/.test(ui));
check('draft-edit-no-settimeout', !/data-edit[\s\S]{0,120}setTimeout/.test(ui));
check('leave-client-passes-params', /render:\s*function\s*\(params\)/.test(client));
check('leave-ui-accepts-prefill', /params\.prefill/.test(ui));

check('balance-index-load', /function loadBalanceIndex_/.test(leave));
check('balance-index-key', /function balanceKey_/.test(leave));
check('get-my-leave-uses-index', /function getMyLeave[\s\S]*loadBalanceIndex_/.test(leave));
check('get-my-leave-no-per-type-scan', !/function getMyLeave[\s\S]*findBalance_\([^,]+,[^,]+,[^,]+\)\s*;/.test(leave));
check('get-my-leave-grants-through-current', /function getMyLeave[\s\S]*grantBalancesForEmployee/.test(leave));
check('admin-status-filter-helper', /matchesStatusFilter/.test(leave));
check('my-leave-year-select', /leave-year-select/.test(ui));
check('admin-pending-status-filter', /PENDING_MANAGER/.test(ui) && /Awaiting approval/.test(ui));

const startYearFn = fnBlock(leave, 'startLeaveYear', 'getApplyBootstrap');
check('start-year-one-lock', (startYearFn.match(/withScriptLock_/g) || []).length === 1);
check('start-year-batch-insert', /DbService\.insertRecords\(HRMS\.SHEETS\.LEAVE_BALANCES/.test(startYearFn));
check('start-year-balance-index', /loadBalanceIndex_/.test(startYearFn));
check('start-year-no-per-employee-grant', !/grantBalancesForEmployee\(/.test(startYearFn));

const grantFn = fnBlock(leave, 'grantBalancesForEmployee', 'startLeaveYear');
check('grant-uses-index', /loadBalanceIndex_/.test(grantFn));
check('grant-passes-index', /balanceIndex/.test(grantFn));
check('grant-uses-plan', /planBalanceGrants/.test(grantFn));
check('grant-default-not-joining-year-only', !/currentLeaveYear_\(emp\.joining_date/.test(grantFn));
check('submit-grants-request-year', /function submit[\s\S]*grantBalancesForEmployee\(targetId, leaveYear/.test(leave));

check('submit-uses-balance-index', /function submit[\s\S]{0,2800}loadBalanceIndex_/.test(leave));
check('approve-uses-balance-index', /function approve[\s\S]{0,1200}loadBalanceIndex_/.test(leave));
check('db-insert-records', /function insertRecords/.test(db));

check('admin-revoke-button', /data-revoke/.test(ui) && /Revoke/.test(ui));
check('admin-revoke-rejection-api', /apiLeaveRevokeRejection/.test(api));
check('admin-filter-keeps-actions', /adminLeaveRowHtml_/.test(ui) &&
  /bindAdminActions\(\)/.test(ui));
check('leave-approve-includes-manager', /LEAVE_APPROVE.*MANAGER/.test(read('foundation/PermissionService.gs')));
check('leave-approvals-nav-includes-manager', /leave-approvals[\s\S]{0,120}MANAGER/.test(read('foundation/PermissionService.gs')));
check('two-stage-pending-statuses', /PENDING_MANAGER/.test(read('leave/LeaveEngine.gs')) &&
  /statusAfterApproval/.test(read('leave/LeaveEngine.gs')));
check('leave-approve-many-api', /apiLeaveApproveMany/.test(read('leave/ApiLeave.gs')) &&
  /approveMany/.test(read('leave/LeaveService.gs')));
check('leave-bulk-ui', /leaveBulkToolbarHtml_/.test(read('leave/LeaveUi.html')) &&
  /apiLeaveApproveMany/.test(read('leave/LeaveUi.html')));
check('join-date-guard', /assertNotBeforeJoining_/.test(leave));
check('submit-notify-uses-result-status', /normalizeLeaveStatus\(result\.status\)/.test(leave));
check('grant-api-include-inactive', /includeInactive:\s*true/.test(api));
check('calendar-uses-config-today', /function getCalendar[\s\S]{0,400}todayDateOnly_/.test(leave));
check('my-leave-no-synthetic-past', /t\.is_active && String\(year\) === String\(currentYear\)/.test(leave));
check('seed-fallback-timezone', /formatDate\(now, ConfigService\.getTimezone/.test(emp));
check('seed-fallback-carry-forward', /function seedLeaveBalances_[\s\S]{0,1800}carryForwardDays/.test(emp));
check('entitled-days-pro-rata', /entitledDaysForLeaveYear/.test(read('leave/LeaveEngine.gs')) &&
  /entitledDaysForLeaveYear/.test(read('leave/LeaveService.gs')));
check('leave-approval-stage-columns', /manager_approver_employee_id/.test(read('foundation/SchemaService.gs')) &&
  /recordApprovalStage_/.test(read('leave/LeaveService.gs')));
check('owner-role-constant', /OWNER:\s*'OWNER'/.test(read('foundation/Constants.gs')));

if (failures.length) {
  console.error('\n' + failures.length + ' failed');
  process.exit(1);
}
console.log('\nAll leave-perf contracts passed');
