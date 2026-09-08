/**
 * Loading skeleton consistency + refresh layout-stability contracts.
 * Presentation-only; must not imply new RPCs or cache changes.
 * Run: node tests/loading-skeleton-ux.test.js
 */
var fs = require('fs');
var path = require('path');

var src = path.join(__dirname, '..', 'apps-script', 'src');
var failures = [];
var passed = 0;

function read(rel) {
  return fs.readFileSync(path.join(src, rel), 'utf8');
}

function check(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log('PASS ' + name + (detail ? ' — ' + detail : ''));
  } else {
    failures.push(name + (detail ? ': ' + detail : ''));
    console.log('FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}

var styles = read('ui/Styles.html');
var scripts = read('ui/Scripts.html');
var ats = read('ats/AtsClient.html');
var emp = read('employee/EmployeeClient.html');
var leave = read('leave/LeaveUi.html');
var payroll = read('payroll/PayrollClient.html');
var pms = read('pms/PmsClient.html');
var ntf = read('notifications/NotificationClient.html');
var bell = read('notifications/NotificationBell.html');

check('skeleton-css-system', /\.hrms-loading-block/.test(styles) && /\.skeleton/.test(styles));
check('skeleton-shimmer-css', /hrms-skeleton-shimmer/.test(styles));
check('refresh-spinner-css', /hrms-spin/.test(styles) && /js-module-refresh\[aria-busy="true"\]/.test(styles));
check('refresh-button-minwidth', /btn\.js-module-refresh[\s\S]*min-width/.test(styles));
check('reduced-motion-skeleton', /prefers-reduced-motion/.test(styles));
check('stable-filter-minwidth', /#ats-job-status/.test(styles) && /min-width:\s*140px/.test(styles));
check('section-skeleton-helper', /function sectionSkeleton/.test(scripts));
check('section-spinner-aliases-skeleton', /function sectionSpinner[\s\S]*sectionSkeleton/.test(scripts));
check('skeleton-kpi-helper', /function skeletonKpiRow/.test(scripts));
check('pending-shell-ats-jobs', /route === 'ats-jobs'/.test(scripts) && /shell-ats-jobs/.test(scripts));
check('pending-shell-ats-candidates', /route === 'ats-candidates'/.test(scripts) && /shell-ats-cands/.test(scripts));
check('dashboard-initial-skeleton', /skeletonKpiRow\(\['Employee ID'/.test(scripts));
check('dashboard-secondary-skeleton', /dash-secondary[\s\S]*sectionSkeleton/.test(scripts));
check('refresh-aria-busy', /pageBusy\.setAttribute\('aria-busy'/.test(scripts) &&
  /pageBusy\.removeAttribute\('aria-busy'/.test(scripts));

check('ats-jobs-initial-skeleton', /skRows\(7,\s*7\)/.test(ats) && /ats-job-body/.test(ats));
check('ats-jobs-keep-refresh', /keepRefresh[\s\S]*paintJobRows\(atsView\.jobs\)/.test(ats));
check('ats-cands-initial-skeleton', /ats-cand-body[\s\S]*skRows\(7,\s*7\)/.test(ats));
check('ats-cands-keep-refresh', /keepRefresh[\s\S]*paintCandRows\(atsView\.candidates\)/.test(ats));
check('ats-detail-skeleton', /function detailSkeleton/.test(ats) && /detailSkeleton\(\)/.test(ats));
check('ats-no-plain-loading-p', !/<p>Loading…<\/p>/.test(ats));

check('ntf-skeleton-initial', /sectionSkeleton[\s\S]*Loading notifications|variant:\s*'list'/.test(ntf));
check('ntf-keep-refresh', /keepRefresh[\s\S]*paintInbox/.test(ntf));
check('bell-loading-skeleton', /ntf-skel/.test(bell) && !/ntf-empty">Loading…/.test(bell));

check('ask-hr-uses-skeleton-status',
  /ask-hr-skel-stack/.test(scripts) && /function startAskHrStatus/.test(scripts));
check('ask-hr-no-plain-loading-text-as-primary',
  !/ask-hr-status[\s\S]{0,200}textContent = ['"]Loading…['"]/.test(scripts));

check('emp-refresh-refills-selects', /isModuleRefresh[\s\S]*fillSelectOptions\('emp-filter-dept'/.test(emp));
check('leave-spinner-uses-skeleton', /sectionSkeleton/.test(leave) || /hrms-loading-block/.test(leave));

check('cache-api-untouched', /function consumeModuleViewRestore/.test(scripts) &&
  /function markModuleViewLoaded/.test(scripts) &&
  /var moduleViewCache_ = \{\}/.test(scripts));
check('refresh-api-untouched', /function refreshCurrentModuleView/.test(scripts) &&
  /Refreshing…/.test(scripts));
check('no-new-polling-timers-for-skeleton', !/setInterval\([^)]*skeleton/.test(scripts + ats + ntf) &&
  !/requestAnimationFrame\([^)]*shimmer/.test(scripts));

// Plain "Loading…" should not remain as primary data-region placeholders in modules
function countBadLoading(text) {
  var bad = 0;
  if (/sectionSpinner\('Loading…'\)/.test(text)) bad += 1;
  if (/innerHTML = ['\"]Loading…['\"]/.test(text)) bad += 1;
  if (/['\"]<p>Loading…<\/p>['\"]/.test(text)) bad += 1;
  if (/ntf-empty">Loading…/.test(text)) bad += 1;
  return bad;
}
check('ats-no-bad-loading-text', countBadLoading(ats) === 0);
check('ntf-no-bad-loading-text', countBadLoading(ntf) === 0);
check('payroll-spinner-skeleton', /sectionSkeleton/.test(payroll));
check('pms-spinner-skeleton', /sectionSkeleton/.test(pms));

// RPC surface: sectionSkeleton must not call google.script.run
check('skeleton-helper-no-rpc', !/function sectionSkeleton[\s\S]{0,800}google\.script\.run/.test(scripts));
check('ats-jobs-still-uses-list-api', /apiAtsListJobs/.test(ats));
check('ats-cands-still-uses-list-api', /apiAtsListCandidates/.test(ats));

if (failures.length) {
  console.log('\n' + failures.length + ' failed:');
  failures.forEach(function (f) { console.log(' - ' + f); });
  process.exit(1);
}
console.log('\nAll loading-skeleton-ux checks passed (' + passed + ')');
