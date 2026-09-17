/**
 * Mobile responsiveness contracts (CSS + key module markup).
 * Run: node tests/mobile-responsive.test.js
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

const styles = read('ui/Styles.html');
const index = read('ui/Index.html');
const scripts = read('ui/Scripts.html');
const leave = read('leave/LeaveUi.html');
const emp = read('employee/EmployeeClient.html');

check('viewport-meta', /viewport-fit=cover/.test(index) && /width=device-width/.test(index));
check('sidebar-mobile-drawer', /@media \(max-width: 768px\)[\s\S]*translateX\(-100%\)/.test(styles));
check('sidebar-backdrop-mobile', /sidebar-backdrop\.open/.test(styles));
check('table-wrap-contain-scroll', /table-wrap--contain/.test(styles) && /-webkit-overflow-scrolling: touch/.test(styles));
check('stack-table-pattern', /data-table--stack-md/.test(styles) && /attr\(data-label\)/.test(styles));
check('touch-min-height', /--touch-min: 44px/.test(styles));
check('safe-area-ask-hr', /safe-area-inset-bottom/.test(styles));
check('modal-mobile-sheet', /@media \(max-width: 768px\)[\s\S]*modal-backdrop[\s\S]*align-items: flex-end/.test(styles));
check('kpi-mobile-columns', /@media \(max-width: 480px\)[\s\S]*kpi-row/.test(styles));
check('leave-balance-cards', /leave-balance-card/.test(styles) && /leaveBalanceCardsHtml/.test(leave));
check('leave-my-requests-stack', /data-table--stack-md/.test(leave) && /data-label="Dates"/.test(leave));
check('leave-toolbar-actions', /leave-toolbar-actions/.test(leave));
check('employee-directory-stack', /data-table--stack-md/.test(emp) && /data-label="Name"/.test(emp));
check('nav-drawer-class', /hrms-nav-drawer-open/.test(scripts) && /hrms-nav-drawer-open/.test(styles));
check('page-actions-stack', /hrms-page-actions/.test(scripts));
check('filters-stack-mobile', /@media \(max-width: 768px\)[\s\S]*\.filters[\s\S]*flex-direction: column/.test(styles));
check('tabs-scroll-mobile', /@media \(max-width: 768px\)[\s\S]*\.tabs[\s\S]*overflow-x: auto/.test(styles));
check('landscape-modal', /orientation: landscape/.test(styles));
check('no-page-overflow', /max-width: 100vw/.test(styles) && /overflow-x: hidden/.test(styles));

const breakpoints = ['768px', '480px', '360px', '1100px'];
breakpoints.forEach(function (bp) {
  check('breakpoint-' + bp, styles.indexOf('max-width: ' + bp) >= 0 || styles.indexOf('min-width: ' + bp) >= 0);
});

if (failures.length) {
  console.error('\n' + failures.length + ' failed');
  process.exit(1);
}
console.log('\nAll mobile-responsive checks passed');
