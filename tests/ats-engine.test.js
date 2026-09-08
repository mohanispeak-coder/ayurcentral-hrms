/**
 * Local ATS engine + permission tests.
 * Run: node tests/ats-engine.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = path.join(__dirname, '..', 'apps-script', 'src');
const context = {
  HRMS: {},
  ATS: {},
  Logger: { log: function () {} }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(src, 'foundation', 'Constants.gs'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(src, 'foundation', 'Errors.gs'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(src, 'ats', 'AtsConstants.gs'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(src, 'ats', 'AtsEngine.gs'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(src, 'ats', 'AtsPermissionService.gs'), 'utf8'), context);

const AtsEngine = context.AtsEngine;
const AtsPermissionService = context.AtsPermissionService;
const ATS = context.ATS;
const HRMS = context.HRMS;
const failures = [];

function check(name, cond, detail) {
  if (cond) {
    console.log('PASS ' + name + (detail ? ' — ' + detail : ''));
  } else {
    failures.push(name + (detail ? ': ' + detail : ''));
    console.log('FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}

check('candidate-id-not-employee', AtsEngine.isCandidateId('CAND0001') && !AtsEngine.isCandidateId('EMP001'));
check('job-id-shape', AtsEngine.isJobId('JOB0007') && !AtsEngine.isJobId('EMP001'));
check('format-ids', AtsEngine.formatAtsId('CAND', 12, 4) === 'CAND0012' &&
  AtsEngine.formatAtsId('JOB', 1, 4) === 'JOB0001');

check('job-create-draft-to-publish', AtsEngine.canTransitionJob('DRAFT', 'PUBLISHED'));
check('job-publish-to-pause', AtsEngine.canTransitionJob('PUBLISHED', 'PAUSED'));
check('job-pause-to-publish', AtsEngine.canTransitionJob('PAUSED', 'PUBLISHED'));
check('job-publish-to-close', AtsEngine.canTransitionJob('PUBLISHED', 'CLOSED'));
check('job-close-is-terminal', !AtsEngine.canTransitionJob('CLOSED', 'PUBLISHED'));
check('job-reopen-hr', AtsEngine.canTransitionJob('CLOSED', 'PUBLISHED', { allowReopen: true }));
check('job-no-skip-draft-to-closed', !AtsEngine.canTransitionJob('DRAFT', 'CLOSED'));

const job = {
  job_id: 'JOB0001',
  public_slug: 'abc123abc123abc123ab',
  title: 'Pharmacist',
  department: 'Retail',
  location: 'Chennai',
  employment_type: 'PERMANENT',
  experience: '2 years',
  education: 'B.Pharm',
  salary_range: '4–6 LPA',
  description: 'Dispense medicines',
  responsibilities: 'Counselling',
  requirements: 'License',
  skills: 'Ayurveda',
  openings: 2,
  status: 'PUBLISHED',
  closing_date: '2099-12-31',
  notes_internal: 'SECRET_NOTE',
  hiring_manager_employee_id: 'EMP001',
  hiring_manager_name: 'Hari',
  created_by_email: 'hr@example.com',
  updated_by_email: 'hr@example.com',
  external_ref_json: '{"linkedin":"x"}',
  employee_id: 'EMP001',
  google_email: 'should-not-leak@example.com',
  pan: 'ABCDE1234F'
};
const pub = AtsEngine.publicJobView(job);
const leaked = AtsEngine.assertPublicJobSafe(pub);
check('public-job-no-internal-keys', leaked.length === 0, leaked.join(','));
check('public-job-has-title', pub.title === 'Pharmacist' && pub.public_slug === job.public_slug);
check('public-job-hides-notes', pub.notes_internal === undefined);
check('public-job-hides-manager', pub.hiring_manager_employee_id === undefined);
check('public-accepting-published', AtsEngine.isJobAcceptingApplications(job, '2026-08-29'));

const closedDate = Object.assign({}, job, { closing_date: '2020-01-01' });
check('public-closed-by-date', !AtsEngine.isJobAcceptingApplications(closedDate, '2026-08-29'));
check('draft-not-public', !AtsEngine.isPubliclyVisibleJob({ status: 'DRAFT' }));
check('paused-visible-not-accepting', AtsEngine.isPubliclyVisibleJob({ status: 'PAUSED' }) &&
  !AtsEngine.isJobAcceptingApplications({ status: 'PAUSED', closing_date: '' }, '2026-08-29'));

const apps = [
  { job_id: 'JOB0001', email: 'ada@example.com', stage: 'APPLIED' },
  { job_id: 'JOB0001', email: 'bob@example.com', stage: 'WITHDRAWN' }
];
check('duplicate-blocks-active', !!AtsEngine.findDuplicateApplication(apps, 'ada@example.com', 'JOB0001'));
check('duplicate-allows-withdrawn-reapply', !AtsEngine.findDuplicateApplication(apps, 'bob@example.com', 'JOB0001'));
check('duplicate-other-job-ok', !AtsEngine.findDuplicateApplication(apps, 'ada@example.com', 'JOB0002'));

check('pipeline-forward', AtsEngine.canMoveStage('APPLIED', 'SCREENING', ATS.DEFAULT_PIPELINE));
check('pipeline-to-interview', AtsEngine.canMoveStage('SHORTLISTED', 'INTERVIEW', ATS.DEFAULT_PIPELINE));
check('pipeline-to-offer', AtsEngine.canMoveStage('SELECTED', 'OFFER', ATS.DEFAULT_PIPELINE));
check('pipeline-to-hired', AtsEngine.canMoveStage('OFFER', 'HIRED', ATS.DEFAULT_PIPELINE));
check('pipeline-reject-from-applied', AtsEngine.canMoveStage('APPLIED', 'REJECTED', ATS.DEFAULT_PIPELINE));
check('pipeline-withdraw', AtsEngine.canMoveStage('SCREENING', 'WITHDRAWN', ATS.DEFAULT_PIPELINE));
check('pipeline-hired-terminal', !AtsEngine.canMoveStage('HIRED', 'OFFER', ATS.DEFAULT_PIPELINE));
check('pipeline-no-backward-default', !AtsEngine.canMoveStage('INTERVIEW', 'APPLIED', ATS.DEFAULT_PIPELINE));
check('pipeline-backward-hr', AtsEngine.canMoveStage('INTERVIEW', 'APPLIED', ATS.DEFAULT_PIPELINE, { allowBackward: true }));

const custom = AtsEngine.parsePipeline('["APPLIED","SCREENING","CASE_STUDY","OFFER","HIRED"]');
check('configurable-pipeline', custom.indexOf('CASE_STUDY') >= 0 && custom[0] === 'APPLIED');
check('configurable-move', AtsEngine.canMoveStage('SCREENING', 'CASE_STUDY', custom));

const applyOk = AtsEngine.validatePublicApplyPayload({
  public_slug: job.public_slug,
  full_name: 'Ada Sharma',
  email: 'ada@example.com',
  phone: '9876543210',
  employee_id: 'EMP001'
});
check('public-apply-valid', applyOk.ok, JSON.stringify(applyOk.errors));
check('public-apply-ignores-employee-id', applyOk.ok && applyOk.email === 'ada@example.com');

const applyBad = AtsEngine.validatePublicApplyPayload({ public_slug: 'x', full_name: '', email: 'bad', phone: '1' });
check('public-apply-validates', !applyBad.ok && applyBad.errors.full_name && applyBad.errors.email);

const jobVal = AtsEngine.validateJobPayload({ title: 'Role', openings: 2, employment_type: 'PERMANENT' }, true);
check('job-validate-ok', jobVal.ok && jobVal.openings === 2);
const jobBad = AtsEngine.validateJobPayload({ title: '', openings: 0 }, true);
check('job-validate-required-title', !jobBad.ok && jobBad.errors.title);

const iv = AtsEngine.validateInterviewPayload({ rating: 4, recommendation: 'HIRE', notes: 'Strong' });
check('interview-validate', iv.ok && iv.rating === 4 && iv.recommendation === 'HIRE');
check('interview-rating-range', !AtsEngine.validateInterviewPayload({ rating: 9 }).ok);

check('resume-mime-pdf', AtsEngine.allowedResumeMime('application/pdf', 'cv.pdf'));
check('resume-mime-reject-exe', !AtsEngine.allowedResumeMime('application/octet-stream', 'x.exe'));

const admin = { authorized: true, role: 'ADMIN', employee_id: 'EMP001', email: 'admin@test' };
const hr = { authorized: true, role: 'HR', employee_id: 'EMP010', email: 'hr@test' };
const mgr = { authorized: true, role: 'MANAGER', employee_id: 'EMP002', email: 'mgr@test' };
const emp = { authorized: true, role: 'EMPLOYEE', employee_id: 'EMP003', email: 'emp@test' };
const anon = { authorized: false, role: '', email: '' };

check('rbac-admin-access', AtsEngine.canAccessAts(admin) && AtsEngine.canManageAts(admin));
check('rbac-hr-access', AtsEngine.canAccessAts(hr) && AtsEngine.canManageAts(hr));
check('rbac-manager-access-not-manage', AtsEngine.canAccessAts(mgr) && !AtsEngine.canManageAts(mgr));
check('rbac-employee-denied', !AtsEngine.canAccessAts(emp));
check('rbac-anon-denied', !AtsEngine.canAccessAts(anon));

const assignedJob = { job_id: 'JOB0001', hiring_manager_employee_id: 'EMP002' };
const otherJob = { job_id: 'JOB0002', hiring_manager_employee_id: 'EMP009' };
check('manager-assigned-job', AtsEngine.canAccessJob(mgr, assignedJob, []));
check('manager-other-job-denied', !AtsEngine.canAccessJob(mgr, otherJob, []));
check('manager-interviewer-scope', AtsEngine.canAccessJob(mgr, otherJob, [
  { job_id: 'JOB0002', interviewer_employee_id: 'EMP002' }
]));
check('employee-job-denied', !AtsEngine.canAccessJob(emp, assignedJob, []));
check('hr-any-job', AtsEngine.canAccessJob(hr, otherJob, []));

check('resume-hr', AtsEngine.canDownloadResume(hr, otherJob, []));
check('resume-employee-denied', !AtsEngine.canDownloadResume(emp, assignedJob, []));
check('resume-unassigned-manager', !AtsEngine.canDownloadResume(mgr, otherJob, []));

try {
  AtsPermissionService.requireAccess(emp);
  check('perm-employee-throw', false);
} catch (e) {
  check('perm-employee-throw', e.hrmsCode === HRMS.ERROR_CODES.AUTHORIZATION);
}
try {
  AtsPermissionService.requireManage(mgr);
  check('perm-manager-cannot-manage', false);
} catch (e) {
  check('perm-manager-cannot-manage', e.hrmsCode === HRMS.ERROR_CODES.AUTHORIZATION);
}
AtsPermissionService.requireAccess(hr);
AtsPermissionService.requireManage(admin);
check('perm-hr-admin-ok', true);

check('nav-employee-empty', AtsPermissionService.navItemsForRole('EMPLOYEE').length === 0);
check('nav-hr-has-ats', AtsPermissionService.navItemsForRole('HR').some(function (n) { return n.route === 'ats'; }));

const kpis = AtsEngine.computeKpis(
  [{ status: 'PUBLISHED' }, { status: 'DRAFT' }, { status: 'PAUSED' }],
  [
    { stage: 'APPLIED' }, { stage: 'SCREENING' }, { stage: 'INTERVIEW' },
    { stage: 'OFFER' }, { stage: 'HIRED' }, { stage: 'REJECTED' }
  ],
  [{}, {}]
);
check('kpi-open-jobs', kpis.open_jobs === 2);
check('kpi-applications', kpis.applications === 6);
check('kpi-screening', kpis.screening === 1);
check('kpi-hires', kpis.hires === 1);
check('kpi-rejections', kpis.rejections === 1);
check('kpi-interview-events', kpis.interview_events === 2);

const share = AtsEngine.sharePack(job, 'https://script.google.com/macros/s/ABC/exec');
check('share-url', share.apply_url.indexOf('ats=apply') >= 0 && share.apply_url.indexOf(job.public_slug) >= 0);
check('share-channels-future-disabled', share.channels.filter(function (c) { return c.id === 'linkedin' || c.id === 'naukri'; }).every(function (c) { return c.enabled === false; }));
check('share-manual-enabled', share.channels.filter(function (c) { return c.id === 'copy_link'; })[0].enabled === true);

check('candidate-record-no-emp-id', AtsEngine.candidateRecordMustNotBeEmployee({
  candidate_id: 'CAND0001', email: 'a@b.c', hired_employee_id: ''
}));
check('candidate-record-rejects-emp-shaped-id', !AtsEngine.candidateRecordMustNotBeEmployee({
  candidate_id: 'EMP001'
}));

check('slug-length', AtsEngine.newPublicSlug(function () { return 0; }).length === ATS.LIMITS.SLUG_LEN);

if (failures.length) {
  console.log('\n' + failures.length + ' failed');
  process.exit(1);
}
console.log('\nAll ATS engine tests passed.');
