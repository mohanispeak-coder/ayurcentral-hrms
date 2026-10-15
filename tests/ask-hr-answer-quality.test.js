/**
 * Ask HR was removed from the web app shell; server modules may remain unused.
 * Run: node tests/ask-hr-answer-quality.test.js
 */
var fs = require('fs');
var path = require('path');

var failures = [];
var passed = 0;

function check(name, cond) {
  if (cond) { passed++; console.log('PASS ' + name); }
  else { failures.push(name); console.log('FAIL ' + name); }
}

var root = path.join(__dirname, '..', 'apps-script', 'src');
var index = fs.readFileSync(path.join(root, 'ui', 'Index.html'), 'utf8');
var scripts = fs.readFileSync(path.join(root, 'ui', 'Scripts.html'), 'utf8');
var styles = fs.readFileSync(path.join(root, 'ui', 'Styles.html'), 'utf8');

check('no-ask-hr-fab-in-index', !/ask-hr-fab/.test(index));
check('no-ask-hr-panel-in-index', !/ask-hr-panel/.test(index));
check('no-init-ask-hr', !/initAskHr/.test(scripts));
check('no-api-ask-hr-client', !/apiAskHr/.test(scripts));
check('no-ask-hr-css', !/\.ask-hr-fab/.test(styles));

if (failures.length) {
  console.log('\n' + failures.length + ' failed');
  process.exit(1);
}
console.log('\nAll ask-hr removal checks passed (' + passed + ')');
