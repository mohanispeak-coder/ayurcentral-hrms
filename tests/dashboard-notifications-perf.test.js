/**
 * Source-level contracts for dashboard + notifications performance (Phase 4).
 * Run: node tests/dashboard-notifications-perf.test.js
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
const ntf = read('notifications/NotificationService.gs');
const engine = read('notifications/NotificationEngine.gs');
const bell = read('notifications/NotificationBell.html');
const ntfClient = read('notifications/NotificationClient.html');
const pms = read('pms/PmsClient.html');
const payroll = read('payroll/PayrollClient.html');
const ats = read('ats/AtsClient.html');

check('dash-secondary-stale-flag', /secondaryStale/.test(scripts));
check('dash-get-view-cache', /function getDashboardViewCache/.test(scripts));
check('dash-get-view-cache-exported', /getDashboardViewCache:\s*getDashboardViewCache/.test(scripts));
check('dash-skip-secondary-on-refresh', /skipSecondary/.test(scripts) && /dashViewCache_\.complete/.test(scripts));
check('dash-merge-on-refresh', /keepPainted[\s\S]{0,400}mergeDashboardPayload_\(primary/.test(scripts));
check('dash-secondary-invalidate', /secondaryOnly/.test(scripts));
check('dash-more-background', /apiGetHomeDashboardMore',\s*\{\s*background:\s*true\s*\}/.test(scripts));

check('payroll-secondary-inv', /invalidatePayrollHome_[\s\S]{0,200}secondaryOnly:\s*true/.test(payroll));
check('pms-secondary-inv', /invalidatePmsShells_/.test(pms) && /secondaryOnly:\s*true/.test(pms));
check('ats-secondary-inv', /invalidateAtsPipeline_/.test(ats) && /secondaryOnly:\s*true/.test(ats));
check('pms-seed-from-dashboard', /seedPmsFromDashboard_/.test(pms) && /getDashboardViewCache/.test(pms));

check('ntf-list-projection', /INBOX_LIST_COLS_/.test(ntf) && /projectedInboxStore_/.test(ntf));
check('ntf-mark-read-projected', /markNotificationRead[\s\S]{0,400}projectedInboxStore_\(INBOX_UNREAD_COLS_\)/.test(ntf));
check('ntf-mark-all-projected', /markAllNotificationsRead[\s\S]{0,300}projectedInboxStore_\(INBOX_UNREAD_COLS_\)/.test(ntf));
check('ntf-mark-read-list-for-count', /markReadInStore_[\s\S]{0,200}store\.list/.test(engine));
check('ntf-client-skip-boot-poll', /mount\(null,\s*\{\s*skipInitialFetch:\s*true\s*\}\)/.test(ntfClient));
check('bell-boot-waits-auth', /boot[\s\S]{0,200}sess\.authorized/.test(bell));

if (failures.length) {
  console.error('\n' + failures.length + ' failed');
  process.exit(1);
}
console.log('\nAll dashboard-notifications-perf contracts passed');
