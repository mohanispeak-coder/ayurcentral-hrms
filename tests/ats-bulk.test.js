/**
 * ATS bulk upload tests.
 * Run: node tests/ats-bulk.test.js
 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var atsDir = path.join(__dirname, '..', 'apps-script', 'src', 'ats');
var failures = [];
var passed = 0;

function read(rel) {
  return fs.readFileSync(path.join(atsDir, rel), 'utf8');
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

var bulk = read('AtsBulkService.gs');
var api = read('ApiAtsBulk.gs');
var client = read('AtsClient.html');

check('bulk-service', /var AtsBulkService/.test(bulk));
check('jobs-template', /downloadJobsTemplate/.test(bulk));
check('candidates-template', /downloadCandidatesTemplate/.test(bulk));
check('source-required', /source is required for reverse tracking/.test(bulk));
check('valid-sources', /ATS\.SOURCES/.test(bulk));
check('dup-job-title', /Duplicate job title/.test(bulk));
check('dup-application', /Duplicate application/.test(bulk));
check('csv-xlsx', /Upload a \.csv or \.xlsx file/.test(bulk));
check('api-jobs', /apiAtsValidateJobsBulkUpload/.test(api));
check('api-candidates', /apiAtsValidateCandidatesBulkUpload/.test(api));
check('ui-jobs-bulk', /ats-jobs-bulk-template/.test(client));
check('ui-cands-bulk', /ats-candidates-bulk-template/.test(client) && /ats-candidates-bulk-validate/.test(client));
check('candidates-source-column', /formatSource_/.test(client) && /<th>Source<\/th>/.test(client));
check('bulk-upload-card', /bulk-upload-card/.test(client));

function loadBulk() {
  var ctx = {
    ATS: {
      SOURCES: ['CAREERS_PAGE', 'REFERRAL', 'LINKEDIN', 'NAUKRI', 'AGENCY', 'CAMPUS', 'OTHER'],
      SHEETS: { JOBS: 'JobRequisitions', CANDIDATES: 'Candidates', APPLICATIONS: 'Applications' },
      LIMITS: { NAME_MAX: 120, PHONE_MIN: 8, PHONE_MAX: 20, ID_PAD: 4 },
      JOB_STATUS: { DRAFT: 'DRAFT', PUBLISHED: 'PUBLISHED' },
      STAGE: { APPLIED: 'APPLIED' },
      SEQ: { JOB: 'seq', CANDIDATE: 'seq', APPLICATION: 'seq', ACTIVITY: 'seq' },
      ID_PREFIX: { JOB: 'JOB', CAND: 'CAND', APP: 'APP', ACT: 'ACT' }
    },
    AtsPermissionService: { requireManage: function () {} },
    AtsSchemaService: { ensureSheets: function () {} },
    AtsRepository: {
      listJobs: function () { return [{ job_id: 'JOB-0001', title: 'Sales' }]; },
      listCandidates: function () { return []; },
      listApplications: function () { return []; }
    },
    AtsEngine: {
      validateJobPayload: function (payload) {
        if (!payload.title) return { ok: false, errors: { title: 'required' }, openings: 1 };
        return { ok: true, errors: {}, openings: 1 };
      },
      upper: function (v) { return String(v || '').trim().toUpperCase(); },
      findDuplicateApplication: function () { return null; }
    },
    AuthService: { requireAuth: function () { return { email: 'hr@test.com' }; } },
    Utilities: {
      parseCsv: function (text) {
        return text.split('\n').map(function (line) { return line.split(','); });
      },
      getUuid: function () { return 'uuid-ats-1'; },
      base64Encode: function () { return 'x'; },
      newBlob: function (c) { return { getBytes: function () { return Buffer.from(c); }, setName: function () { return this; } }; }
    },
    CacheService: {
      getScriptCache: function () {
        return { put: function () {}, get: function () { return null; }, remove: function () {} };
      }
    },
    validationError_: function (msg) { throw new Error(msg); },
    authorizationError_: function (msg) { throw new Error(msg); },
    configurationError_: function (msg) { throw new Error(msg); }
  };
  vm.runInNewContext(bulk, ctx);
  return ctx.AtsBulkService;
}

var Bulk = loadBulk();

var jobCsv = 'title,department\nSales Exec,Sales\n';
var jobRows = Bulk.parseCsvRows(jobCsv);
var jobs = Bulk.validateJobRows(jobRows);
check('job-valid', jobs.validCount === 1);

var dupJobs = Bulk.validateJobRows([
  { rowNumber: 2, title: 'Same', department: 'A' },
  { rowNumber: 3, title: 'same', department: 'B' }
]);
check('job-dup-title', dupJobs.errorCount >= 1);

var candCsv = 'job_id,full_name,email,phone,source\nJOB-0001,Priya,p@test.com,9876543210,NAUKRI\n';
var candRows = Bulk.parseCsvRows(candCsv);
var cands = Bulk.validateCandidateRows(candRows);
check('cand-valid-source', cands.validCount === 1);

var noSource = Bulk.validateCandidateRows([{
  rowNumber: 2, job_id: 'JOB-0001', full_name: 'X', email: 'x@test.com', phone: '9876543210', source: ''
}]);
check('cand-source-required', noSource.errorCount === 1);

var badSource = Bulk.validateCandidateRows([{
  rowNumber: 2, job_id: 'JOB-0001', full_name: 'X', email: 'y@test.com', phone: '9876543210', source: 'INVALID'
}]);
check('cand-invalid-source', badSource.errorCount === 1);

if (failures.length) {
  console.log('\n' + failures.length + ' failed:');
  failures.forEach(function (f) { console.log(' - ' + f); });
  process.exit(1);
}
console.log('\nAll ats-bulk checks passed (' + passed + ')');
