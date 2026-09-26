/**
 * Content template service smoke tests.
 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var src = path.join(__dirname, '..', 'apps-script', 'src', 'foundation');
var failures = [];
var passed = 0;

function check(name, cond) {
  if (cond) {
    passed++;
    console.log('PASS ' + name);
  } else {
    failures.push(name);
    console.log('FAIL ' + name);
  }
}

var ctx = {
  HRMS: { SHEETS: { SETTINGS: 'Settings' } },
  ConfigService: {
    getSetting: function (k, d) { return d; },
    clearSettingsCache: function () {}
  },
  DbService: {
    findOne: function () { return { setting_key: 'x' }; },
    updateRecord: function () {}
  },
  configurationError_: function (m) { throw new Error(m); }
};
vm.runInNewContext(fs.readFileSync(path.join(src, 'HrmsContentTemplateService.gs'), 'utf8'), ctx);

var svc = ctx.HrmsContentTemplateService;
check('defs-present', svc.definitions.length >= 4);
check('render-welcome', svc.render('employee_welcome', { '{{company}}': 'Co' }).subject.indexOf('Co') >= 0);
check('legacy-bulk-def', svc.definitions.some(function (d) { return d.id === 'bulk_legacy'; }));
check('settings-rows', svc.defaultSettingsRows().length >= 5);

var leave = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'src', 'leave', 'LeaveService.gs'), 'utf8');
check('coerce-balance-default', /requires_balance === '' \|\| row\.requires_balance == null/.test(leave));
check('coerce-active-default', /is_active === '' \|\| row\.is_active == null/.test(leave));

var ats = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'src', 'ats', 'AtsService.gs'), 'utf8');
check('offer-manual-hire', /sendOfferLetterForHire/.test(ats) && /sendHireOfferLetter/.test(ats));
check('pdf-layout-catalog', /PDF_LAYOUT_DEFINITIONS_/.test(fs.readFileSync(path.join(src, 'HrmsContentTemplateService.gs'), 'utf8')));
check('save-templates-editable-only', /DEFINITIONS_\.forEach/.test(fs.readFileSync(path.join(src, 'HrmsContentTemplateService.gs'), 'utf8')));

var empClient = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'src', 'employee', 'EmployeeClient.html'), 'utf8');
check('legacy-template-ui', /apiDownloadBulkLegacyEmployeeTemplate/.test(empClient));

if (failures.length) {
  console.log('\n' + failures.length + ' failed');
  process.exit(1);
}
console.log('\nAll content template checks passed (' + passed + ')');
