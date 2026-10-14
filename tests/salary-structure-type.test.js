/**
 * SalaryStructureTypeService unit tests — shared salary structure templates.
 * Loads Constants.gs + SalaryStructureTypeService.gs into a vm context with an
 * in-memory DbService and stubbed foundation helpers.
 * Run: node tests/salary-structure-type.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = path.join(__dirname, '..', 'apps-script', 'src');

function makeDb() {
  var store = {};
  var seq = 0;
  function rows(sheet) { return (store[sheet] = store[sheet] || []); }
  function matches(record, filter) {
    return Object.keys(filter).every(function (k) {
      var a = record[k], b = filter[k];
      if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
      return a === b;
    });
  }
  return {
    _store: store,
    getAllRecords: function (s) { return rows(s).map(function (r) { return Object.assign({}, r); }); },
    findRecords: function (s, f) { return rows(s).filter(function (r) { return matches(r, f || {}); }).map(function (r) { return Object.assign({}, r); }); },
    findOne: function (s, f) { var m = rows(s).filter(function (r) { return matches(r, f || {}); }); return m.length ? Object.assign({}, m[0]) : null; },
    insertRecord: function (s, rec) { rows(s).push(Object.assign({}, rec)); return rec; },
    insertRecords: function (s, recs) { (recs || []).forEach(function (r) { rows(s).push(Object.assign({}, r)); }); return (recs || []).length; },
    updateRecord: function (s, pk, val, updates) {
      var r = rows(s).filter(function (x) { return String(x[pk]) === String(val); })[0];
      if (r) Object.assign(r, updates);
      return r ? Object.assign({}, r) : null;
    },
    replaceRecords: function (s, filter, newRows) {
      store[s] = rows(s).filter(function (r) { return !matches(r, filter || {}); });
      (newRows || []).forEach(function (r) { store[s].push(Object.assign({}, r)); });
    },
    generateId: function (prefix) { seq += 1; return prefix + '-' + seq; },
    nextSequenceAssumingLocked: function () { seq += 1; return seq; },
    nextSequence: function () { seq += 1; return seq; }
  };
}

function hrmsError(message) { var e = new Error(message); e.hrmsCode = true; return e; }

const db = makeDb();
const context = {
  HRMS: {},
  Logger: { log: function () {} },
  DbService: db,
  PermissionService: { require: function () { return { email: 'hr@example.com' }; } },
  AuditService: { log: function () {} },
  EmployeeRepository: { listVerticals: function () { return ['AOPL', 'SAPL', 'AOMS', 'OTHERS']; } },
  withScriptLock_: function (fn) { return fn(); },
  validationError_: function (m) { return hrmsError(m); },
  notFoundError_: function (m) { return hrmsError(m); },
  conflictError_: function (m) { return hrmsError(m); },
  systemError_: function (m) { return hrmsError(m); }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(src, 'foundation', 'Constants.gs'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(src, 'payroll', 'SalaryComponentExpandService.gs'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(src, 'payroll', 'SalaryStructureTypeService.gs'), 'utf8'), context);

const Svc = context.SalaryStructureTypeService;
const failures = [];
function check(name, cond, detail) {
  if (cond) { console.log('PASS ' + name + (detail ? ' — ' + detail : '')); }
  else { failures.push(name + (detail ? ': ' + detail : '')); console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
}
function expectThrow(name, fn, matchText) {
  try { fn(); failures.push(name + ': expected error'); console.log('FAIL ' + name + ' — no error thrown'); }
  catch (e) {
    var ok = !matchText || String(e.message).indexOf(matchText) >= 0;
    check(name, ok, ok ? '' : ('got: ' + e.message));
  }
}

var ID_SAPL = 'SAPL-EXEC-CUSTOM';
var ID_AOPL = 'AOPL-PARTIAL';

// Create a valid structure (earnings total 100% → no warning).
var created = Svc.saveStructureType({
  salary_structure_id: ID_SAPL,
  structure_name: 'SAPL Executive',
  vertical_name: 'sapl',
  status: 'ACTIVE',
  components: [
    { component_code: 'bp', component_name: 'Basic Pay', component_kind: 'EARNING', calc_method: 'PERCENT', percent_base: 'CTC', percent: 50 },
    { component_code: 'hra', component_name: 'HRA', component_kind: 'EARNING', calc_method: 'PERCENT', percent_base: 'BP', percent: 20 },
    { component_code: 'sa', component_name: 'Special Allowance', component_kind: 'EARNING', calc_method: 'BALANCE_OF_CTC' },
    { component_code: 'pf', component_name: 'PF', component_kind: 'DEDUCTION', calc_method: 'FIXED', amount: 1800 }
  ]
});
check('create returns id', created.salary_structure_id === ID_SAPL, created.salary_structure_id);
check('create uppercases vertical', created.vertical_name === 'SAPL');
check('create default active', created.status === 'ACTIVE');
check('create stores components', created.components.length === 4);
check('create component code uppercased', created.components[0].component_code === 'BP');
check('earnings 100% → no warning', !created.warning, created.warning || '');
check('type row has empty employee_id', db._store.SalaryStructures[0].employee_id === '');

// Warning when earnings don't total 100%.
var warned = Svc.saveStructureType({
  salary_structure_id: ID_AOPL,
  structure_name: 'AOPL Partial',
  vertical_name: 'AOPL',
  components: [
    { component_code: 'BP', component_name: 'Basic', component_kind: 'EARNING', calc_method: 'PERCENT_OF_CTC', percent: 40 }
  ]
});
check('incomplete structure warns', /sample CTC|earnings total/i.test(warned.warning || ''), warned.warning || '');

expectThrow('missing structure id rejected', function () {
  Svc.saveStructureType({ salary_structure_id: '', structure_name: 'NoId', vertical_name: 'SAPL', components: [
    { component_code: 'BP', component_name: 'Basic', component_kind: 'EARNING', calc_method: 'PERCENT_OF_CTC', percent: 100 }
  ] });
}, 'Structure ID is required');

// Duplicate name rejected.
expectThrow('duplicate name rejected', function () {
  Svc.saveStructureType({ salary_structure_id: 'SAPL-OTHER', structure_name: 'sapl executive', vertical_name: 'SAPL', components: [
    { component_code: 'BP', component_name: 'Basic', component_kind: 'EARNING', calc_method: 'PERCENT_OF_CTC', percent: 100 }
  ] });
}, 'already exists');

// Invalid vertical rejected.
expectThrow('invalid vertical rejected', function () {
  Svc.saveStructureType({ salary_structure_id: 'ZETA-1', structure_name: 'Zeta', vertical_name: 'NOPE', components: [
    { component_code: 'BP', component_name: 'Basic', component_kind: 'EARNING', calc_method: 'PERCENT_OF_CTC', percent: 100 }
  ] });
}, 'valid vertical');

// Component validation.
expectThrow('missing component code', function () {
  Svc.saveStructureType({ salary_structure_id: 'NOCODE-1', structure_name: 'NoCode', vertical_name: 'SAPL', components: [
    { component_code: '', component_name: 'X', component_kind: 'EARNING', calc_method: 'PERCENT_OF_CTC', percent: 10 }
  ] });
}, 'code and a name');
expectThrow('bad kind rejected', function () {
  Svc.saveStructureType({ salary_structure_id: 'BADKIND-1', structure_name: 'BadKind', vertical_name: 'SAPL', components: [
    { component_code: 'X', component_name: 'X', component_kind: 'BONUS', calc_method: 'PERCENT_OF_CTC', percent: 10 }
  ] });
}, 'component_kind');
expectThrow('duplicate component code', function () {
  Svc.saveStructureType({ salary_structure_id: 'DUP-1', structure_name: 'Dup', vertical_name: 'SAPL', components: [
    { component_code: 'BP', component_name: 'a', component_kind: 'EARNING', calc_method: 'PERCENT_OF_CTC', percent: 50 },
    { component_code: 'bp', component_name: 'b', component_kind: 'EARNING', calc_method: 'PERCENT_OF_CTC', percent: 50 }
  ] });
}, 'Duplicate component code');
expectThrow('percent over 100 rejected', function () {
  Svc.saveStructureType({ salary_structure_id: 'OVER-1', structure_name: 'Over', vertical_name: 'SAPL', components: [
    { component_code: 'BP', component_name: 'a', component_kind: 'EARNING', calc_method: 'PERCENT_OF_CTC', percent: 150 }
  ] });
}, 'cannot exceed 100');
expectThrow('empty components rejected', function () {
  Svc.saveStructureType({ salary_structure_id: 'EMPTY-1', structure_name: 'Empty', vertical_name: 'SAPL', components: [] });
}, 'at least one');

// Rate BP + earned rule for BP (same code, different sections) must save.
var bothSections = Svc.saveStructureType({
  salary_structure_id: 'BOTH-SEC-TEST',
  structure_name: 'Both Sections BP',
  vertical_name: 'SAPL',
  components: [
    { structure_section: 'RATE_OF_PAY', component_code: 'BP', component_name: 'Basic', component_kind: 'EARNING',
      calc_method: 'PERCENT_OF_CTC', percent: 100 },
    { structure_section: 'EARNED_PAY', component_code: 'BP', component_name: 'Earned', component_kind: 'EARNING',
      calc_method: 'PRORATE_ROUND_LINE', round_mode: 'ROUND' },
    { structure_section: 'DEDUCTION', component_code: 'PF', component_name: 'PF', component_kind: 'DEDUCTION',
      calc_method: 'PERCENT_CAPPED', percent_base: 'RATE_LINE:BP', percent: 12, cap_amount: 25000 }
  ]
});
check('rate and earned same code saves', bothSections.salary_structure_id === 'BOTH-SEC-TEST');

// Listing + lookups.
check('listStructureTypes returns all', Svc.listStructureTypes(false).length === 3);
check('findTypeByName case-insensitive', !!Svc.findTypeByName('sapl executive'));
check('findTypeById works', !!Svc.findTypeById(created.salary_structure_id));
var opts = Svc.listStructureTypeOptions({ activeOnly: true });
check('options include name+vertical', opts.length === 3 && opts[0].structure_name && opts[0].vertical_name);
check('options filter by vertical', Svc.listStructureTypeOptions({ vertical_name: 'AOPL' }).length === 1);

// Update existing (edit) keeps single row and replaces components.
var edited = Svc.saveStructureType({
  salary_structure_id: created.salary_structure_id,
  structure_name: 'SAPL Executive',
  vertical_name: 'SAPL',
  status: 'ACTIVE',
  components: [
    { component_code: 'BP', component_name: 'Basic Pay', component_kind: 'EARNING', calc_method: 'PERCENT_OF_CTC', percent: 100 }
  ]
});
check('edit keeps same id', edited.salary_structure_id === created.salary_structure_id);
check('edit replaces components', edited.components.length === 1);
check('edit did not add a row', Svc.listStructureTypes(false).length === 3);

// Status toggle + activeOnly filter.
Svc.setStructureTypeStatus(created.salary_structure_id, 'INACTIVE');
check('setStatus inactive', Svc.getStructureType(created.salary_structure_id).status === 'INACTIVE');
check('activeOnly excludes inactive', Svc.listStructureTypes(true).length === 2);
check('inactive excluded from options', Svc.listStructureTypeOptions({ activeOnly: true }).length === 2);

// Legacy per-employee row must not be treated as a type.
db.insertRecord('SalaryStructures', { salary_structure_id: 'SS-legacy', employee_id: 'EMP001', status: 'CURRENT', structure_name: '' });
check('legacy row not a type (findTypeById)', Svc.findTypeById('SS-legacy') === null);
check('legacy row not in list', Svc.listStructureTypes(false).every(function (s) { return s.salary_structure_id !== 'SS-legacy'; }));

const clientHtml = fs.readFileSync(path.join(src, 'payroll', 'SalaryStructureClient.html'), 'utf8');
check('client-uses-hrms-callserver', /var callServer = App\.callServer/.test(clientHtml));
check('client-binds-showtoast', /var showToast = App\.showToast/.test(clientHtml));
check('client-percent-base-ui', /sst-c-base/.test(clientHtml) && /Remainder of CTC/.test(clientHtml));
check('client-structure-sections', /sst-rate-body/.test(clientHtml) && /sst-earned-body/.test(clientHtml) &&
  /sst-ded-body/.test(clientHtml) && /sst-manual-body/.test(clientHtml));
check('client-four-section-labels', /2\. Earned pay/.test(clientHtml) && /4\. Manual deductions \(fixed amounts\)/.test(clientHtml));
check('client-manual-amount-inputs', /sst-c-manual-amt/.test(clientHtml));
check('client-payroll-rules', /execution_sections/.test(clientHtml) && /payroll_rules_json/.test(clientHtml));
check('client-manual-structure-id', /sst-structure-id/.test(clientHtml));

if (failures.length) {
  console.error('\n' + failures.length + ' failed');
  process.exit(1);
}
console.log('\nAll SalaryStructureTypeService checks passed');
