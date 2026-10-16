/**
 * Ask HR UI removed from shell; knowledge hub client not wired in browser.
 * Run: node tests/ask-hr-knowledge-architecture.test.js
 */
var fs = require('fs');
var path = require('path');

var failures = [];
var passed = 0;

function check(name, cond) {
  if (cond) { passed++; console.log('PASS ' + name); }
  else { failures.push(name); console.log('FAIL ' + name); }
}

var scripts = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'src', 'ui', 'Scripts.html'), 'utf8');
check('no-knowledge-hub-in-scripts', !/KnowledgeHub/.test(scripts) && !/apiAskHr/.test(scripts));

if (failures.length) process.exit(1);
console.log('\nAll ask-hr-knowledge-architecture checks passed (' + passed + ')');
