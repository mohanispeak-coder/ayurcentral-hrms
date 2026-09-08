/**
 * Sidebar information architecture — grouping, collapsible sections, no RPC on toggle.
 * Run: node tests/sidebar-navigation.test.js
 */
var fs = require('fs');
var path = require('path');

var root = path.join(__dirname, '..', 'apps-script', 'src');
var failures = [];
var passed = 0;

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
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

var scripts = read('ui/Scripts.html');
var styles = read('ui/Styles.html');
var perm = read('foundation/PermissionService.gs');

var navRoutes = [];
var navMatch = perm.match(/var NAV_ITEMS_ = \[([\s\S]*?)\];/);
if (navMatch) {
  var routeRe = /route:\s*'([^']+)'/g;
  var m;
  while ((m = routeRe.exec(navMatch[1]))) navRoutes.push(m[1]);
}

check('nav-groups-defined', /var NAV_GROUPS = \[/.test(scripts));
check('nav-main-section', /id:\s*'main'[\s\S]*label:\s*'Main'[\s\S]*dashboard/.test(scripts));
check('nav-my-work-section', /id:\s*'my-work'[\s\S]*my-profile[\s\S]*my-leave[\s\S]*pms-my-review[\s\S]*my-payslips/.test(scripts));
check('nav-people-section', /id:\s*'people'[\s\S]*employees[\s\S]*my-team/.test(scripts));
check('nav-time-off-section', /id:\s*'time-off'[\s\S]*leave-admin[\s\S]*leave-approvals/.test(scripts));
check('nav-performance-section', /id:\s*'performance'[\s\S]*pms[\s\S]*pms-team[\s\S]*pms-cycles[\s\S]*pms-appraisal/.test(scripts));
check('nav-payroll-section', /id:\s*'payroll'[\s\S]*routes:\s*\['payroll'\]/.test(scripts));
check('compensation-not-in-sidebar', !/routes:\s*\['payroll',\s*'compensation'\]/.test(scripts));
check('nav-recruitment-section', /id:\s*'recruitment'[\s\S]*ats[\s\S]*ats-jobs[\s\S]*ats-candidates/.test(scripts));
check('nav-admin-section', /id:\s*'admin'[\s\S]*notifications[\s\S]*settings[\s\S]*users/.test(scripts));

var perfBlock = scripts.match(/id:\s*'performance'[\s\S]*?collapsible:\s*true/);
var timeOffBlock = scripts.match(/id:\s*'time-off'[\s\S]*?collapsible:\s*true/);
var payrollBlock = scripts.match(/id:\s*'payroll'[\s\S]*?collapsible:\s*true/);

check('pms-my-review-not-in-performance', !!(perfBlock && perfBlock[0].indexOf('pms-my-review') < 0));
check('my-leave-not-in-time-off', !!(timeOffBlock && timeOffBlock[0].indexOf('my-leave') < 0));
check('my-payslips-not-in-payroll', !!(payrollBlock && payrollBlock[0].indexOf('my-payslips') < 0));

check('collapsible-section-state', /navSectionExpanded_/.test(scripts));
check('no-localstorage-nav-state', !/localStorage\.(setItem|getItem|removeItem)\([^)]*navSection/.test(scripts));
check('nav-group-toggle-ui', /nav-group-toggle/.test(scripts) && /nav-group-chevron/.test(styles));
check('nav-auto-expand-active', /isNavGroupActive/.test(scripts) && /isNavGroupExpanded/.test(scripts));
check('nav-collapse-css', /nav-group-items\.is-collapsed/.test(styles));
check('nav-reduced-motion', /prefers-reduced-motion[\s\S]*nav-group-chevron/.test(styles));

check('grouped-nav-passes-id', /id:\s*g\.id/.test(scripts) && /collapsible:\s*!!g\.collapsible/.test(scripts));
check('render-nav-no-rpc', !/function renderNav[\s\S]{0,1200}google\.script\.run/.test(scripts));
check('toggle-nav-no-rpc', !/navSectionExpanded_[\s\S]{0,400}google\.script\.run/.test(scripts));
check('toggle-nav-no-callserver', !/nav-group-toggle[\s\S]{0,600}callServer/.test(scripts));

navRoutes.forEach(function (route) {
  if (route === 'dashboard') return;
  check('route-in-nav-groups-' + route, new RegExp("'" + route.replace(/-/g, '\\-') + "'").test(scripts));
});

if (failures.length) {
  console.log('\n' + failures.length + ' failed:');
  failures.forEach(function (f) { console.log(' - ' + f); });
  process.exit(1);
}
console.log('\nAll sidebar-navigation checks passed (' + passed + ')');
