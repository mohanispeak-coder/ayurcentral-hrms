/**
 * Shell UX helpers (no em dash in dropdown labels, payroll runs cache).
 * Run: node tests/ui-shell-ux.test.js
 */
var fs = require('fs');
var path = require('path');

var scripts = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'src', 'ui', 'Scripts.html'), 'utf8');
var failures = [];

function check(name, cond) {
  if (cond) console.log('PASS ' + name);
  else {
    failures.push(name);
    console.log('FAIL ' + name);
  }
}

check('format-vertical-label', /formatVerticalOptionLabel_/.test(scripts));
check('fetch-payroll-runs-cache', /fetchPayrollRunsList_/.test(scripts));
check('module-cache-assets-version', /clientAssetsVersion/.test(scripts));
check('attendance-nav-invalidate-selective', /cachedRun && cachedRun !== nextRun/.test(scripts));
check('popstate-payroll-merge', /onPopState_[\s\S]*mergePayrollPeriodContext_/.test(scripts));

var htmlDir = path.join(__dirname, '..', 'apps-script', 'src');
function walkHtml(dir, acc) {
  fs.readdirSync(dir).forEach(function (name) {
    var p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walkHtml(p, acc);
    else if (name.endsWith('.html')) acc.push(p);
  });
}
var htmlFiles = [];
walkHtml(htmlDir, htmlFiles);
function stripHtmlComments_(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}
var emDashInUi = htmlFiles.filter(function (f) {
  var t = stripHtmlComments_(fs.readFileSync(f, 'utf8'));
  if (f.indexOf('Scripts.html') >= 0) return false;
  return /'[^']*—[^']*'/.test(t) || /"[^"]*—[^"]*"/.test(t);
});
check('no-em-dash-in-ui-string-literals', emDashInUi.length === 0);

if (failures.length) {
  console.log('\n' + failures.length + ' failed');
  if (emDashInUi.length) console.log('Files:', emDashInUi.join(', '));
  process.exit(1);
}
console.log('\nAll ui-shell-ux checks passed');
