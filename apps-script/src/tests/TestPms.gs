/**
 * PMS P0 tests — engine/rules always run. Sheet integration skips if DB is not configured.
 */

function testPms_All() {
  var results = [];
  function record(name, passed, detail, skipped) {
    results.push({ name: name, passed: !!passed, detail: detail || '', skipped: !!skipped });
    Logger.log((skipped ? 'SKIP' : passed ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ': ' + detail : ''));
  }

  testPms_EngineSuite_(record);
  testPms_PermissionSuite_(record);
  testPms_ApiSurfaceSuite_(record);

  var spreadsheetConfigured = typeof ConfigService !== 'undefined' &&
    !!ConfigService.getScriptProperty(HRMS.PROPS.SPREADSHEET_ID);
  if (spreadsheetConfigured) {
    testPms_SchemaSuite_(record);
  } else {
    record('PMS-schema-integration', true, 'Spreadsheet not configured', true);
  }

  var failed = results.filter(function (r) { return !r.passed && !r.skipped; });
  Logger.log('PMS tests: ' + (results.length - failed.length) + '/' + results.length +
    ' passed (' + failed.length + ' failed)');
  return { results: results, allPassed: failed.length === 0, failedCount: failed.length };
}

function testPms_throws_(fn) {
  try {
    fn();
    return { threw: false, message: '' };
  } catch (e) {
    return { threw: true, message: e.message || String(e), code: e.hrmsCode || '' };
  }
}

function testPms_EngineSuite_(record) {
  var CS = HRMS.PMS.CYCLE_STATUS;
  var RS = HRMS.PMS.REVIEW_STATUS;
  var ACT = HRMS.PMS.ACTIONS;

  var created = PmsEngine.validateCycleFields({
    name: 'FY26 H1',
    start_date: '2026-04-01',
    end_date: '2026-09-30',
    submission_deadline: '2026-08-15',
    review_deadline: '2026-09-15'
  }, true);
  record('PMS-cycle-create', created.name === 'FY26 H1' && created.start_date === '2026-04-01', created.start_date);

  var badDates = testPms_throws_(function () {
    PmsEngine.validateCycleFields({
      name: 'Bad',
      start_date: '2026-09-01',
      end_date: '2026-04-01',
      submission_deadline: '2026-08-01',
      review_deadline: '2026-09-01'
    }, true);
  });
  record('PMS-cycle-end-before-start', badDates.threw, badDates.message);

  var badDeadline = testPms_throws_(function () {
    PmsEngine.validateCycleFields({
      name: 'Bad deadline',
      start_date: '2026-04-01',
      end_date: '2026-09-30',
      submission_deadline: '2026-09-20',
      review_deadline: '2026-09-01'
    }, true);
  });
  record('PMS-cycle-review-before-submit', badDeadline.threw, badDeadline.message);

  record('PMS-transition-draft-open', PmsEngine.isValidTransition(CS.DRAFT, CS.OPEN));
  record('PMS-transition-open-self', PmsEngine.isValidTransition(CS.OPEN, CS.EMPLOYEE_SUBMITTED));
  record('PMS-transition-self-mgr', PmsEngine.isValidTransition(CS.EMPLOYEE_SUBMITTED, CS.MANAGER_REVIEW));
  record('PMS-transition-mgr-final', PmsEngine.isValidTransition(CS.MANAGER_REVIEW, CS.FINALIZED));
  record('PMS-transition-final-closed', PmsEngine.isValidTransition(CS.FINALIZED, CS.CLOSED));
  record('PMS-transition-skip-forbidden', !PmsEngine.isValidTransition(CS.DRAFT, CS.FINALIZED));
  record('PMS-transition-closed-terminal', !PmsEngine.isValidTransition(CS.CLOSED, CS.OPEN));
  record('PMS-transition-reopen-self', PmsEngine.isValidTransition(CS.EMPLOYEE_SUBMITTED, CS.OPEN));

  var skip = testPms_throws_(function () {
    PmsEngine.assertTransition(CS.OPEN, CS.FINALIZED);
  });
  record('PMS-transition-invalid-throws', skip.threw, skip.message);

  var goal = PmsEngine.validateGoalFields({
    cycle_id: 'PCY-1',
    employee_id: 'EMP003',
    title: 'Grow retail NPS',
    description: 'Improve store NPS',
    measurement: 'NPS score',
    target: '55',
    weight: 40,
    status: 'ACTIVE'
  }, {});
  record('PMS-goal-create', goal.title === 'Grow retail NPS' && goal.weight === 40, String(goal.weight));

  var badWeight = testPms_throws_(function () {
    PmsEngine.validateWeightValue(0);
  });
  record('PMS-weight-zero', badWeight.threw, badWeight.message);

  var overWeight = testPms_throws_(function () {
    PmsEngine.validateWeightValue(120);
  });
  record('PMS-weight-over-100', overWeight.threw, overWeight.message);

  var weightsOk = PmsEngine.validateWeights([
    { weight: 40, status: 'ACTIVE' },
    { weight: 60, status: 'ACTIVE' }
  ]);
  record('PMS-weight-sum-100', weightsOk.ok && weightsOk.total === 100, String(weightsOk.total));

  var weightsBad = PmsEngine.validateWeights([
    { weight: 40, status: 'ACTIVE' },
    { weight: 40, status: 'ACTIVE' }
  ]);
  record('PMS-weight-sum-not-100', !weightsBad.ok, weightsBad.message);

  var cancelledIgnored = PmsEngine.validateWeights([
    { weight: 50, status: 'ACTIVE' },
    { weight: 50, status: 'ACTIVE' },
    { weight: 25, status: 'CANCELLED' }
  ]);
  record('PMS-weight-ignore-cancelled', cancelledIgnored.ok, cancelledIgnored.message);

  var emptyGoals = PmsEngine.validateWeights([]);
  record('PMS-weight-empty', !emptyGoals.ok, emptyGoals.message);

  var scale = PmsEngine.defaultScale();
  record('PMS-scale-default-5', scale.length === 5 && scale[0].value === 1 && scale[4].value === 5 &&
    scale[4].label === 'Exceptional', scale.map(function (r) { return r.value; }).join(','));
  record('PMS-scale-not-hardcoded-check', PmsEngine.isAllowedRating(3, scale) && !PmsEngine.isAllowedRating(9, scale));

  var customScale = [{ value: 1, label: 'Low', is_active: true }, { value: 2, label: 'High', is_active: true }];
  record('PMS-scale-custom', PmsEngine.isAllowedRating(2, customScale) && !PmsEngine.isAllowedRating(5, customScale));

  var overall = PmsEngine.computeOverallRating([
    { weight: 50, status: 'ACTIVE', manager_rating: 4 },
    { weight: 50, status: 'ACTIVE', manager_rating: 2 }
  ], 'manager');
  record('PMS-overall-weighted', overall === 3, String(overall));

  var cycleOpen = { status: CS.OPEN, review_deadline: '2026-09-15' };
  var reviewDraft = { status: RS.IN_PROGRESS, reopen_allowed: false };
  record('PMS-employee-can-submit-open', PmsEngine.canEmployeeSubmit(cycleOpen, reviewDraft));

  var already = testPms_throws_(function () {
    PmsEngine.assertEmployeeCanSubmit(
      cycleOpen,
      { status: RS.SELF_SUBMITTED, reopen_allowed: false },
      [{ weight: 100, status: 'ACTIVE' }]
    );
  });
  record('PMS-duplicate-self-submit', already.threw, already.message);

  var reopenOk = PmsEngine.canEmployeeSubmit(cycleOpen, { status: RS.SELF_SUBMITTED, reopen_allowed: true });
  record('PMS-reopen-allows-edit', reopenOk === true);

  var closedCycle = { status: CS.EMPLOYEE_SUBMITTED };
  record('PMS-employee-blocked-after-open', !PmsEngine.canEmployeeSubmit(closedCycle, reviewDraft));

  var mgrCycle = { status: CS.MANAGER_REVIEW };
  var mgrReview = { status: RS.SELF_SUBMITTED };
  var mgrGoals = [
    { weight: 100, status: 'ACTIVE', manager_rating: 4 }
  ];
  var mgrOk = testPms_throws_(function () {
    PmsEngine.assertManagerCanSubmit(mgrCycle, mgrReview, mgrGoals);
  });
  record('PMS-manager-submit-ok', !mgrOk.threw, mgrOk.message);

  var dupMgr = testPms_throws_(function () {
    PmsEngine.assertManagerCanSubmit(mgrCycle, { status: RS.MANAGER_SUBMITTED }, mgrGoals);
  });
  record('PMS-duplicate-manager-submit', dupMgr.threw, dupMgr.message);

  var mgrTooSoon = testPms_throws_(function () {
    PmsEngine.assertManagerCanSubmit(cycleOpen, mgrReview, mgrGoals);
  });
  record('PMS-manager-before-window', mgrTooSoon.threw, mgrTooSoon.message);

  var missingRate = testPms_throws_(function () {
    PmsEngine.assertManagerCanSubmit(mgrCycle, mgrReview, [{ weight: 100, status: 'ACTIVE' }]);
  });
  record('PMS-manager-requires-ratings', missingRate.threw, missingRate.message);

  var finOk = testPms_throws_(function () {
    PmsEngine.assertCanFinalize(mgrCycle, { status: RS.MANAGER_SUBMITTED });
  });
  record('PMS-finalize-ok', !finOk.threw, finOk.message);

  var finDup = testPms_throws_(function () {
    PmsEngine.assertCanFinalize(mgrCycle, { status: RS.FINALIZED });
  });
  record('PMS-finalize-duplicate', finDup.threw, finDup.message);

  var finEarly = testPms_throws_(function () {
    PmsEngine.assertCanFinalize(mgrCycle, { status: RS.SELF_SUBMITTED });
  });
  record('PMS-finalize-before-manager', finEarly.threw, finEarly.message);

  var hr = { authorized: true, role: 'HR', employee_id: 'EMP001' };
  var mgr = { authorized: true, role: 'MANAGER', employee_id: 'EMP002' };
  var emp = { authorized: true, role: 'EMPLOYEE', employee_id: 'EMP003' };
  var other = { authorized: true, role: 'EMPLOYEE', employee_id: 'EMP004' };
  var report = { employee_id: 'EMP003', manager_employee_id: 'EMP002' };
  var outsider = { employee_id: 'EMP004', manager_employee_id: 'EMP099' };

  record('PMS-rbac-hr-cycles', PmsEngine.can(ACT.MANAGE_CYCLES, hr, {}));
  record('PMS-rbac-emp-no-cycles', !PmsEngine.can(ACT.MANAGE_CYCLES, emp, {}));
  record('PMS-rbac-mgr-no-cycles', !PmsEngine.can(ACT.MANAGE_CYCLES, mgr, {}));
  record('PMS-rbac-hr-finalize', PmsEngine.can(ACT.FINALIZE, hr, {}));
  record('PMS-rbac-mgr-no-finalize', !PmsEngine.can(ACT.FINALIZE, mgr, {}));
  record('PMS-rbac-self-assess-own', PmsEngine.can(ACT.SELF_ASSESS, emp, { employee: report }));
  record('PMS-rbac-self-assess-other', !PmsEngine.can(ACT.SELF_ASSESS, emp, { employee: outsider }));
  record('PMS-rbac-mgr-review-report', PmsEngine.can(ACT.MANAGER_REVIEW, mgr, { employee: report }));
  record('PMS-rbac-mgr-review-self-denied', !PmsEngine.can(ACT.MANAGER_REVIEW, mgr, {
    employee: { employee_id: 'EMP002', manager_employee_id: 'EMP001' }
  }));
  record('PMS-rbac-mgr-review-outsider', !PmsEngine.can(ACT.MANAGER_REVIEW, mgr, { employee: outsider }));
  record('PMS-rbac-emp-no-team', !PmsEngine.can(ACT.VIEW_TEAM, emp, {}));
  record('PMS-view-invalid-access', !PmsEngine.canViewEmployeePms(other, report, {}));
  record('PMS-view-self', PmsEngine.canViewEmployeePms(emp, report, {}));
  record('PMS-view-hr', PmsEngine.canViewEmployeePms(hr, outsider, {}));

  var kpis = PmsEngine.buildDashboardKpis({
    session: hr,
    now: new Date(2026, 8, 20),
    employees: [report, outsider, { employee_id: 'EMP002', manager_employee_id: 'EMP001' }],
    cycles: [
      { cycle_id: 'C1', status: CS.OPEN, review_deadline: '2026-09-15' },
      { cycle_id: 'C2', status: CS.MANAGER_REVIEW, review_deadline: '2026-09-01' }
    ],
    goals: [
      { cycle_id: 'C1', employee_id: 'EMP003', weight: 100, status: 'ACTIVE' },
      { cycle_id: 'C2', employee_id: 'EMP003', weight: 100, status: 'ACTIVE' },
      { cycle_id: 'C2', employee_id: 'EMP004', weight: 100, status: 'ACTIVE' }
    ],
    reviews: [
      { cycle_id: 'C2', employee_id: 'EMP003', status: RS.SELF_SUBMITTED },
      { cycle_id: 'C2', employee_id: 'EMP004', status: RS.MANAGER_SUBMITTED }
    ]
  });
  record('PMS-kpi-active', kpis.active_cycles === 2, JSON.stringify(kpis));
  record('PMS-kpi-pending-self', kpis.employees_pending_self === 1, JSON.stringify(kpis));
  record('PMS-kpi-pending-mgr', kpis.managers_pending_review === 1, JSON.stringify(kpis));
  record('PMS-kpi-completed', kpis.completed_reviews === 1, JSON.stringify(kpis));
  record('PMS-kpi-overdue', kpis.overdue_reviews >= 1, JSON.stringify(kpis));
}

function testPms_PermissionSuite_(record) {
  var employeeSession = { authorized: true, role: 'EMPLOYEE', employee_id: 'EMP003', email: 'e3@test' };
  var managerSession = { authorized: true, role: 'MANAGER', employee_id: 'EMP002', email: 'e2@test' };
  var hrSession = { authorized: true, role: 'HR', employee_id: 'EMP001', email: 'e1@test' };
  var adminSession = { authorized: true, role: 'ADMIN', employee_id: 'EMP000', email: 'a@test' };
  var ACT = HRMS.PMS.ACTIONS;
  var report = { employee_id: 'EMP003', manager_employee_id: 'EMP002' };

  record('PMS-admin-full', PmsEngine.can(ACT.MANAGE_CYCLES, adminSession, {}) &&
    PmsEngine.can(ACT.FINALIZE, adminSession, {}));
  record('PMS-hr-manage', PmsEngine.can(ACT.MANAGE_CYCLES, hrSession, {}) &&
    PmsEngine.can(ACT.MANAGE_RATINGS, hrSession, {}));
  record('PMS-mgr-goals-report', PmsEngine.can(ACT.MANAGE_GOALS, managerSession, { employee: report }));
  record('PMS-mgr-goals-other', !PmsEngine.can(ACT.MANAGE_GOALS, managerSession, {
    employee: { employee_id: 'EMP004', manager_employee_id: 'EMP099' }
  }));
  record('PMS-emp-no-goals-admin', !PmsEngine.can(ACT.MANAGE_GOALS, employeeSession, { employee: report }));
  record('PMS-nav-hr-has-cycles', PmsPermissionService.navItemsForRole('HR').some(function (n) {
    return n.route === 'pms-cycles';
  }));
  record('PMS-nav-emp-no-appraisal', !PmsPermissionService.navItemsForRole('EMPLOYEE').some(function (n) {
    return n.route === 'pms-appraisal';
  }));
  record('PMS-nav-emp-has-my-review', PmsPermissionService.navItemsForRole('EMPLOYEE').some(function (n) {
    return n.route === 'pms-my-review';
  }));
}

function testPms_ApiSurfaceSuite_(record) {
  record('PMS-api-apiGetPmsModuleUi', typeof apiGetPmsModuleUi === 'function');
  record('PMS-api-apiPmsGetDashboard', typeof apiPmsGetDashboard === 'function');
  record('PMS-api-apiPmsListCycles', typeof apiPmsListCycles === 'function');
  record('PMS-api-apiPmsCreateCycle', typeof apiPmsCreateCycle === 'function');
  record('PMS-api-apiPmsTransitionCycle', typeof apiPmsTransitionCycle === 'function');
  record('PMS-api-apiPmsCreateGoal', typeof apiPmsCreateGoal === 'function');
  record('PMS-api-apiPmsSubmitSelfAssessment', typeof apiPmsSubmitSelfAssessment === 'function');
  record('PMS-api-apiPmsSubmitManagerReview', typeof apiPmsSubmitManagerReview === 'function');
  record('PMS-api-apiPmsFinalizeReview', typeof apiPmsFinalizeReview === 'function');
  record('PMS-api-apiPmsSaveRatingScale', typeof apiPmsSaveRatingScale === 'function');
  record('PMS-schema-info', PmsSchemaService.getSchemaInfo().sheets.length === 4,
    String(PmsSchemaService.getSchemaInfo().sheets.length));
  var headers = PmsSchemaService.getHeaderMap();
  record('PMS-schema-cycle-pk', headers.PerformanceCycles && headers.PerformanceCycles[0] === 'cycle_id');
  record('PMS-schema-goal-employee-id', headers.PerformanceGoals && headers.PerformanceGoals.indexOf('employee_id') >= 0);
}

function testPms_SchemaSuite_(record) {
  try {
    var info = PmsSchemaService.ensure();
    record('PMS-schema-ensure', !!info, info && info.sheets ? ('sheets=' + info.sheets.length) : '');
  } catch (e) {
    record('PMS-schema-ensure', false, e.message || String(e));
  }
}
