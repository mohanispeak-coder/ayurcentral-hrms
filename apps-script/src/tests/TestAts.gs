/**
 * ATS tests — engine/RBAC always; live sheet cases when HRMS_SPREADSHEET_ID is set
 * and the current user is HR/ADMIN.
 *
 * Run `testAts_All` from the Apps Script editor. Do not treat this as a Node run.
 */

function testAts_Engine() {
  var results = [];
  function check(name, cond, detail) {
    results.push({ name: name, passed: !!cond, detail: detail || '' });
    Logger.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ': ' + detail : ''));
  }

  check('job-lifecycle-publish', AtsEngine.canTransitionJob('DRAFT', 'PUBLISHED'));
  check('job-lifecycle-close', AtsEngine.canTransitionJob('PUBLISHED', 'CLOSED'));
  check('job-lifecycle-closed-terminal', !AtsEngine.canTransitionJob('CLOSED', 'DRAFT'));
  check('ids-are-not-employee', AtsEngine.formatAtsId('CAND', 1, 4) === 'CAND0001' &&
    !AtsEngine.isCandidateId('EMP001'));

  var job = {
    job_id: 'JOB0001',
    public_slug: 'slugslugslugslugslug',
    title: 'Store Manager',
    status: 'PUBLISHED',
    notes_internal: 'secret',
    hiring_manager_employee_id: 'EMP001',
    created_by_email: 'hr@test',
    pan: 'ABCDE1234F'
  };
  var view = AtsEngine.publicJobView(job);
  check('public-apply-no-leak', AtsEngine.assertPublicJobSafe(view).length === 0 && !view.notes_internal);

  var dup = AtsEngine.findDuplicateApplication(
    [{ job_id: 'JOB0001', email: 'c@test.com', stage: 'APPLIED' }],
    'c@test.com',
    'JOB0001'
  );
  check('duplicate-application', !!dup);
  check('pipeline-applied-to-hired-path', AtsEngine.canMoveStage('APPLIED', 'INTERVIEW', ATS.DEFAULT_PIPELINE));
  check('interview-rating', AtsEngine.validateInterviewPayload({ rating: 5, recommendation: 'STRONG_HIRE' }).ok);

  var emp = { authorized: true, role: 'EMPLOYEE', employee_id: 'EMP003', email: 'e@test' };
  var hr = { authorized: true, role: 'HR', employee_id: 'EMP001', email: 'h@test' };
  check('rbac-employee-no-ats', !AtsEngine.canAccessAts(emp));
  check('rbac-hr-full', AtsEngine.canManageAts(hr));
  try {
    AtsPermissionService.requireAccess(emp);
    check('unauthorized-employee', false, 'should throw');
  } catch (e) {
    check('unauthorized-employee', e.hrmsCode === HRMS.ERROR_CODES.AUTHORIZATION);
  }

  var pubApply = AtsEngine.validatePublicApplyPayload({
    public_slug: 'slugslugslugslugslug',
    full_name: 'Candidate One',
    email: 'c1@example.com',
    phone: '9998887776',
    employee_id: 'EMP001'
  });
  check('public-apply-does-not-need-hrms-account', pubApply.ok);

  return summarizeAtsTests_(results);
}

function testAts_All() {
  var engine = testAts_Engine();
  var results = engine.results.slice();
  function record(name, passed, detail, skipped) {
    results.push({ name: name, passed: passed, detail: detail || '', skipped: !!skipped });
    Logger.log((skipped ? 'SKIP' : passed ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ': ' + detail : ''));
  }

  var session = AuthService.resolveSession();
  var spreadsheetConfigured = !!ConfigService.getScriptProperty(HRMS.PROPS.SPREADSHEET_ID);
  if (!spreadsheetConfigured) {
    record('liveAts', true, 'Requires HRMS_SPREADSHEET_ID', true);
    return summarizeAtsTests_(results);
  }

  if (!session.authorized || !AtsEngine.canManageAts(session)) {
    record('liveAtsWrites', true, 'Requires HR/ADMIN session for live writes', true);
    if (session.authorized && session.role === 'EMPLOYEE') {
      try {
        AtsService.listJobs(session, {});
        record('live-employee-denied', false, 'EMPLOYEE listed jobs');
      } catch (e) {
        record('live-employee-denied', e.hrmsCode === HRMS.ERROR_CODES.AUTHORIZATION, e.message);
      }
    }
    return summarizeAtsTests_(results);
  }

  try {
    AtsSchemaService.ensureSheets();
    record('ats-schema-ensure', true);
  } catch (e) {
    record('ats-schema-ensure', false, e.message);
    return summarizeAtsTests_(results);
  }

  var stamp = Utilities.formatDate(new Date(), ConfigService.getTimezone(), 'yyyyMMddHHmmss');
  var created;
  try {
    created = AtsService.createJob(session, {
      title: 'ATS Test Role ' + stamp,
      department: 'QA',
      location: 'Test',
      employment_type: 'CONTRACT',
      openings: 1,
      description: 'Automated ATS test requisition'
    });
    record('job-create', !!(created && created.job && created.job.job_id && created.job.status === 'DRAFT'),
      created && created.job ? created.job.job_id : '');
  } catch (e) {
    record('job-create', false, e.message);
    return summarizeAtsTests_(results);
  }

  var jobId = created.job.job_id;
  try {
    var published = AtsService.transitionJob(session, jobId, 'PUBLISHED');
    record('job-publish', published.job.status === 'PUBLISHED' && !!published.job.public_slug,
      published.job.public_slug);
  } catch (e) {
    record('job-publish', false, e.message);
    return summarizeAtsTests_(results);
  }

  var slug = AtsService.getJob(session, jobId).job.public_slug;
  var email = 'ats.cand.' + stamp + '@example.com';
  try {
    var applied = AtsService.submitPublicApplication({
      public_slug: slug,
      full_name: 'ATS Candidate ' + stamp,
      email: email,
      phone: '9876501234',
      location: 'Chennai',
      education: 'B.Pharm',
      experience: '2 years',
      skills: 'Retail',
      cover_letter: 'I would like to apply.',
      source: 'CAREERS_PAGE',
      employee_id: 'EMP001'
    });
    record('public-application', !!applied.application_id && applied.created_employee === false &&
      applied.employee_id === '' && AtsEngine.isCandidateId(applied.candidate_id),
      applied.candidate_id + ' / ' + applied.application_id);
    record('candidate-not-employee', applied.created_candidate === true &&
      String(applied.candidate_id).indexOf('EMP') !== 0);
  } catch (e) {
    record('public-application', false, e.message);
    return summarizeAtsTests_(results);
  }

  try {
    AtsService.submitPublicApplication({
      public_slug: slug,
      full_name: 'ATS Candidate ' + stamp,
      email: email,
      phone: '9876501234',
      source: 'CAREERS_PAGE'
    });
    record('duplicate-application', false, 'Second apply should fail');
  } catch (e) {
    record('duplicate-application', e.hrmsCode === HRMS.ERROR_CODES.CONFLICT, e.message);
  }

  var publicView = AtsService.getPublicJob(slug);
  record('public-job-shape', publicView.title && !publicView.notes_internal &&
    !publicView.hiring_manager_employee_id && AtsEngine.assertPublicJobSafe(publicView).length === 0);

  var empSession = { authorized: true, role: 'EMPLOYEE', employee_id: 'EMP003', email: 'employee-ats-test@example.com' };
  try {
    AtsService.getJob(empSession, jobId);
    record('rbac-employee-get-job', false, 'should deny');
  } catch (e) {
    record('rbac-employee-get-job', e.hrmsCode === HRMS.ERROR_CODES.AUTHORIZATION, e.message);
  }

  var mgrSession = {
    authorized: true,
    role: 'MANAGER',
    employee_id: 'EMP-NO-MATCH',
    email: 'manager-ats-test@example.com'
  };
  try {
    AtsService.getJob(mgrSession, jobId);
    record('rbac-unassigned-manager', false, 'should deny');
  } catch (e) {
    record('rbac-unassigned-manager', e.hrmsCode === HRMS.ERROR_CODES.AUTHORIZATION, e.message);
  }

  var candId = AtsService.getJob(session, jobId).applications[0].candidate_id;
  var appId = AtsService.getJob(session, jobId).applications[0].application_id;
  try {
    var moved = AtsService.moveStage(session, appId, 'SCREENING', 'Test screen');
    record('pipeline-move', moved.application.stage === 'SCREENING', moved.application.stage);
  } catch (e) {
    record('pipeline-move', false, e.message);
  }

  try {
    var iv = AtsService.scheduleInterview(session, {
      application_id: appId,
      interviewer_name: 'Test Interviewer',
      rating: 4,
      recommendation: 'HIRE',
      notes: 'Solid communication'
    });
    record('interview', !!(iv && iv.interview && iv.interview.interview_id),
      iv && iv.interview ? iv.interview.interview_id : '');
  } catch (e) {
    record('interview', false, e.message);
  }

  try {
    var closed = AtsService.transitionJob(session, jobId, 'CLOSED');
    record('job-close', closed.job.status === 'CLOSED');
  } catch (e) {
    record('job-close', false, e.message);
  }

  try {
    AtsService.submitPublicApplication({
      public_slug: slug,
      full_name: 'Too Late',
      email: 'late.' + stamp + '@example.com',
      phone: '9876500000'
    });
    record('apply-after-close', false, 'Closed job accepted an application');
  } catch (e) {
    record('apply-after-close', e.hrmsCode === HRMS.ERROR_CODES.CONFLICT ||
      e.hrmsCode === HRMS.ERROR_CODES.NOT_FOUND, e.message);
  }

  try {
    var profile = AtsService.getCandidate(session, candId);
    record('candidate-profile', profile.candidate.candidate_id === candId &&
      profile.applications.length >= 1 &&
      (profile.hired_employee_id === '' || profile.candidate.hired_employee_id === ''),
      candId);
  } catch (e) {
    record('candidate-profile', false, e.message);
  }

  return summarizeAtsTests_(results);
}

function summarizeAtsTests_(results) {
  var passed = 0;
  var failed = 0;
  var skipped = 0;
  results.forEach(function (r) {
    if (r.skipped) skipped++;
    else if (r.passed) passed++;
    else failed++;
  });
  var summary = { passed: passed, failed: failed, skipped: skipped, results: results };
  Logger.log('ATS tests: ' + passed + ' passed, ' + failed + ' failed, ' + skipped + ' skipped');
  return summary;
}
