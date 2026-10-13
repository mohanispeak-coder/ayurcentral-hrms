const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outDir = '/opt/cursor/artifacts';
const styles = fs.readFileSync(path.join(root, 'apps-script/src/ui/Styles.html'), 'utf8');
const mod = fs.readFileSync(path.join(root, 'apps-script/src/payroll/SalaryStructureClient.html'), 'utf8');

const defaultComponents = [
  { structure_section: 'RATE_OF_PAY', component_code: 'BP', component_name: 'Basic + DA', component_kind: 'EARNING', calc_method: 'PERCENT', percent_base: 'CTC', percent: 60, sort_order: 1 },
  { structure_section: 'RATE_OF_PAY', component_code: 'HRA', component_name: 'HRA', component_kind: 'EARNING', calc_method: 'PERCENT', percent_base: 'BP', percent: 40, sort_order: 2 },
  { structure_section: 'RATE_OF_PAY', component_code: 'CONV', component_name: 'Conveyance', component_kind: 'EARNING', calc_method: 'FIXED', amount: 1600, sort_order: 3 },
  { structure_section: 'RATE_OF_PAY', component_code: 'MED', component_name: 'Medical', component_kind: 'EARNING', calc_method: 'FIXED', amount: 1250, sort_order: 4 },
  { structure_section: 'RATE_OF_PAY', component_code: 'SA', component_name: 'Special allowance', component_kind: 'EARNING', calc_method: 'BALANCE_OF_CTC', sort_order: 5 },
  { structure_section: 'DEDUCTION', component_code: 'PF', component_name: 'PF', component_kind: 'DEDUCTION', calc_method: 'PERCENT_CAPPED', percent_base: 'BP', percent: 12, cap_amount: 25000, round_mode: 'ROUND', sort_order: 10 },
  { structure_section: 'DEDUCTION', component_code: 'ESIC', component_name: 'ESIC', component_kind: 'DEDUCTION', calc_method: 'PERCENT_IF', cond_ref: 'RATE_GROSS', cond_op: 'LT', cond_value: 21001, percent_base: 'EARNED_GROSS', percent: 0.75, round_mode: 'ROUNDUP', sort_order: 11 },
  { structure_section: 'DEDUCTION', component_code: 'PT', component_name: 'Professional tax', component_kind: 'DEDUCTION', calc_method: 'THRESHOLD_FEE', cond_ref: 'EARNED_GROSS', cond_op: 'LTE', cond_value: 25000, amount: 200, round_mode: 'ROUND', sort_order: 12 },
  { structure_section: 'MANUAL_DEDUCTION', component_code: 'ADVANCE', component_name: 'Advance', component_kind: 'DEDUCTION', calc_method: 'MANUAL', sort_order: 20 },
  { structure_section: 'MANUAL_DEDUCTION', component_code: 'TDS', component_name: 'TDS', component_kind: 'DEDUCTION', calc_method: 'MANUAL', sort_order: 21 },
  { structure_section: 'MANUAL_DEDUCTION', component_code: 'LCD', component_name: 'LCD', component_kind: 'DEDUCTION', calc_method: 'MANUAL', sort_order: 22 },
  { structure_section: 'MANUAL_DEDUCTION', component_code: 'LWF', component_name: 'LWF', component_kind: 'DEDUCTION', calc_method: 'MANUAL', sort_order: 23 }
];

const mockScript = `
<script>
(function () {
  var sampleList = [{
    salary_structure_id: 'SS-001',
    structure_name: 'SAPL Standard (sample)',
    vertical_name: 'SAPL',
    status: 'ACTIVE',
    components: ${JSON.stringify(defaultComponents)}
  }];
  window.HrmsApp = {
    callServer: function (method) {
      var args = Array.prototype.slice.call(arguments, 1);
      return new Promise(function (resolve, reject) {
        setTimeout(function () {
          if (method === 'apiListSalaryStructureTypes') resolve(sampleList);
          else if (method === 'apiGetSalaryStructureTypeDefaults') {
            resolve({ components: ${JSON.stringify(defaultComponents)}, payroll_rules_json: '{"earned_prorate":"ROUND_LINE","arrears_add_codes":["ARREARS"]}' });
          } else if (method === 'apiGetSalaryStructureType') {
            resolve(sampleList[0]);
          } else if (method === 'apiGetEmployeeVerticals') resolve(['AOPL', 'SAPL', 'AOMS', 'OTHERS']);
          else if (method === 'apiSaveSalaryStructureType') resolve({ warning: '' });
          else resolve(null);
        }, 120);
      });
    },
    escapeHtml: function (v) {
      return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    },
    showToast: function (msg, type) {
      var el = document.getElementById('demo-toast');
      if (!el) return;
      el.textContent = msg;
      el.className = 'toast visible ' + (type || 'success');
      setTimeout(function () { el.className = 'toast'; }, 2800);
    },
    registerRoute: function (name, cfg) {
      window.__demoRoutes = window.__demoRoutes || {};
      window.__demoRoutes[name] = cfg;
    },
    markModuleViewLoaded: function () {}
  };
  document.addEventListener('DOMContentLoaded', function () {
    var route = window.__demoRoutes && window.__demoRoutes['salary-structure'];
    if (route && route.render) route.render({});
  });
})();
</script>`;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Salary structures — UI preview (branch build)</title>
  ${styles}
  <style>
    .demo-banner { background: #1e3a8a; color: #fff; padding: 8px 16px; font-size: 13px; text-align: center; }
    .demo-banner strong { font-weight: 600; }
    #page-content { padding: 24px; max-width: 1200px; margin: 0 auto; }
    .toast { position: fixed; bottom: 24px; right: 24px; padding: 12px 18px; border-radius: 8px; color: #fff; opacity: 0; transition: opacity .2s; z-index: 9999; }
    .toast.visible { opacity: 1; }
    .toast.success { background: var(--color-success); }
  </style>
</head>
<body>
  <div class="demo-banner">Preview uses the real <strong>SalaryStructureClient.html</strong> from this branch with mocked API data (not live Sheets).</div>
  <div class="main-wrap" style="margin:0">
    <header class="header app-header" style="position:sticky;top:0">
      <div class="header-left"><h1 class="page-title">Salary structures</h1></div>
      <div class="header-right"><span class="user-name">HR Preview</span></div>
    </header>
    <main class="content" id="main-content" style="min-height:80vh">
      <div id="page-content"></div>
    </main>
  </div>
  <div id="demo-toast" class="toast" aria-live="polite"></div>
  ${mockScript}
  ${mod}
</body>
</html>`;

fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'salary-structure-ui-preview.html');
fs.writeFileSync(outPath, html);
console.log('Wrote', outPath, html.length, 'chars');
