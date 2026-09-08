/**
 * Source-level contracts for the whole-HRMS performance pass.
 * Run: node tests/perf-optimization.test.js
 */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'apps-script', 'src');
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

const scripts = read('ui/Scripts.html');
const bell = read('notifications/NotificationBell.html');
const ntfClient = read('notifications/NotificationClient.html');
const ntfService = read('notifications/NotificationService.gs');
const ntfEngine = read('notifications/NotificationEngine.gs');
const db = read('foundation/DbService.gs');
const auth = read('foundation/AuthService.gs');
const errors = read('foundation/Errors.gs');
const api = read('foundation/ApiFoundation.gs');
const dash = read('foundation/HomeDashboardService.gs');
const leave = read('leave/LeaveService.gs');
const pms = read('pms/PmsService.gs');
const ats = read('ats/AtsService.gs');
const atsClient = read('ats/AtsClient.html');
const constants = read('foundation/Constants.gs');

check('no-post-login-herd', !/setTimeout\(preloadModulesFromNav,\s*0\)/.test(scripts));
check('preload-idle-one', /mode:\s*'idle-one-at-a-time'/.test(scripts));
check('preload-pauses-on-nav', /pauseBackgroundPreload\(\)/.test(scripts) && /userInitiated/.test(scripts));
check('dashboard-primary-then-more', /apiGetHomeDashboardMore/.test(scripts) && /secondaryPending/.test(scripts));
check('dashboard-service-split', /buildPrimary/.test(dash) && /buildSecondary/.test(dash));
check('api-dashboard-more', /function apiGetHomeDashboardMore/.test(api));

check('bell-mark-read-single-rpc', /rpcCount:\s*1/.test(bell) && /apiMarkNotificationRead/.test(bell));
check('bell-no-followup-refresh-on-mark', !/apiMarkNotificationRead[\s\S]{0,180}refresh\(false\)/.test(bell));
check('bell-optimistic-mark-all', /applyUnreadCount\(0\)/.test(bell));
check('bell-poll-unread-only', /apiGetUnreadNotificationCount/.test(bell) && /document\.hidden/.test(bell));
check('bell-skip-initial-fetch', /skipInitialFetch/.test(bell));
check('bell-mount-opts-not-container', /HrmsNotificationBell\.mount\(\s*null\s*,\s*\{\s*skipInitialFetch:\s*true\s*\}\s*\)/.test(scripts));
check('bell-mount-no-opts-as-first-arg', !/HrmsNotificationBell\.mount\(\s*\{/.test(scripts) && !/HrmsNotificationBell\.mount\(\s*\{/.test(ntfClient));
check('page-no-bell-refresh-after-mark', !/HrmsNotificationBell\.refresh\(false\)/.test(ntfClient));

check('engine-mark-all-batch', /store\.updateMany/.test(ntfEngine) && /unread_count:\s*0/.test(ntfEngine));
check('service-update-many', /DbService\.updateRecords/.test(ntfService));
check('service-find-one', /find:\s*function \(id\)/.test(ntfService));
check('reads-skip-ensure', !/function getNotifications[\s\S]{0,80}ensure_\(\)/.test(ntfService));
check('mark-read-skip-ensure', !/function markNotificationRead[\s\S]{0,80}ensure_\(\)/.test(ntfService));

check('db-update-records', /function updateRecords/.test(db));
check('db-projected', /function getProjectedRecords/.test(db));
check('db-find-row', /function findRowNumber/.test(db));
check('db-write-row-setvalues', /function writeRowValues_/.test(db));
check('db-no-per-cell-setvalue-in-update', !/function updateRecord[\s\S]{0,900}setValue\(updates\[key\]\)/.test(db));

check('session-request-cache', /resolveSessionCacheHit/.test(auth) && /clearRequestSessionCache/.test(auth));
check('hrmsrun-clears-session', /clearRequestSessionCache/.test(errors));
check('identity-cache-short-ttl', /IDENTITY_TTL_SEC:\s*15/.test(constants));
check('identity-cache-gen-bump', /invalidateIdentitySnapshots/.test(auth) && /IDENTITY_GEN_KEY/.test(constants));
check('leave-reuses-session', /PermissionService\.require\(HRMS\.ACTIONS\.LEAVE_APPLY,\s*\{\},\s*session\)/.test(leave));
check('pms-dashboard-no-ensure', !/function getDashboard[\s\S]{0,80}ensure_\(\)/.test(pms));
check('pms-dashboard-accepts-session', /function getDashboard\(optSession\)/.test(pms));
check('ats-bootstrap-includes-dashboard', /dashboard:\s*dashboard/.test(ats));
check('ats-client-reuses-bootstrap-dash', /boot && boot\.dashboard/.test(atsClient));

if (failures.length) {
  console.error('\n' + failures.length + ' failed');
  process.exit(1);
}
console.log('\nAll perf-optimization contracts passed');
