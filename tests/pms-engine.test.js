/**
 * Local PMS engine tests (cycle lifecycle, weights, RBAC, submissions).
 * Run: node tests/pms-engine.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = path.join(__dirname, '..', 'apps-script', 'src');
const context = {
  HRMS: {},
  Logger: { log: function () {} }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(src, 'foundation', 'Constants.gs'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(src, 'pms', 'PmsConstants.gs'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(src, 'pms', 'PmsEngine.gs'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(src, 'pms', 'PmsPermissionService.gs'), 'utf8'), context);

const PmsEngine = context.PmsEngine;
const PmsPermissionService = context.PmsPermissionService;
const HRMS = context.HRMS;
const CS = HRMS.PMS.CYCLE_STATUS;
const RS = HRMS.PMS.REVIEW_STATUS;
const ACT = HRMS.PMS.ACTIONS;
const failures = [];

function check(name, cond, detail) {
  if (cond) {
    console.log('PASS ' + name + (detail ? ' — ' + detail : ''));
  } else {
    failures.push(name + (detail ? ': ' + detail : ''));
    console.log('FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}

function throws(fn) {
  try {
    fn();
    return { threw: false, message: '' };
  } catch (e) {
    return { threw: true, message: e.message || String(e), code: e.hrmsCode || '' };
  }
}

const created = PmsEngine.validateCycleFields({
  name: 'FY26 H1',
  start_date: '2026-04-01',
  end_date: '2026-09-30',
  submission_deadline: '2026-08-15',
  review_deadline: '2026-09-15'
}, true);
check('PMS-cycle-create', created.name === 'FY26 H1' && created.start_date === '2026-04-01', created.start_date);

check('PMS-cycle-end-before-start', throws(function () {
  PmsEngine.validateCycleFields({
    name: 'Bad',
    start_date: '2026-09-01',
    end_date: '2026-04-01',
    submission_deadline: '2026-08-01',
    review_deadline: '2026-09-01'
  }, true);
}).threw);

check('PMS-cycle-review-before-submit', throws(function () {
  PmsEngine.validateCycleFields({
    name: 'Bad deadline',
    start_date: '2026-04-01',
    end_date: '2026-09-30',
    submission_deadline: '2026-09-20',
    review_deadline: '2026-09-01'
  }, true);
}).threw);

check('PMS-transition-draft-open', PmsEngine.isValidTransition(CS.DRAFT, CS.OPEN));
check('PMS-transition-open-self', PmsEngine.isValidTransition(CS.OPEN, CS.EMPLOYEE_SUBMITTED));
check('PMS-transition-self-mgr', PmsEngine.isValidTransition(CS.EMPLOYEE_SUBMITTED, CS.MANAGER_REVIEW));
check('PMS-transition-mgr-final', PmsEngine.isValidTransition(CS.MANAGER_REVIEW, CS.FINALIZED));
check('PMS-transition-final-closed', PmsEngine.isValidTransition(CS.FINALIZED, CS.CLOSED));
check('PMS-transition-skip-forbidden', !PmsEngine.isValidTransition(CS.DRAFT, CS.FINALIZED));
check('PMS-transition-closed-terminal', !PmsEngine.isValidTransition(CS.CLOSED, CS.OPEN));
check('PMS-transition-reopen-self', PmsEngine.isValidTransition(CS.EMPLOYEE_SUBMITTED, CS.OPEN));
check('PMS-transition-invalid-throws', throws(function () {
  PmsEngine.assertTransition(CS.OPEN, CS.FINALIZED);
}).threw);

const goal = PmsEngine.validateGoalFields({
  cycle_id: 'PCY-1',
  employee_id: 'EMP003',
  title: 'Grow retail NPS',
  weight: 40,
  status: 'ACTIVE'
}, {});
check('PMS-goal-create', goal.title === 'Grow retail NPS' && goal.weight === 40, String(goal.weight));
check('PMS-weight-zero', throws(function () { PmsEngine.validateWeightValue(0); }).threw);
check('PMS-weight-over-100', throws(function () { PmsEngine.validateWeightValue(120); }).threw);

const weightsOk = PmsEngine.validateWeights([
  { weight: 40, status: 'ACTIVE' },
  { weight: 60, status: 'ACTIVE' }
]);
check('PMS-weight-sum-100', weightsOk.ok && weightsOk.total === 100, String(weightsOk.total));
check('PMS-weight-sum-not-100', !PmsEngine.validateWeights([
  { weight: 40, status: 'ACTIVE' },
  { weight: 40, status: 'ACTIVE' }
]).ok);
check('PMS-weight-ignore-cancelled', PmsEngine.validateWeights([
  { weight: 50, status: 'ACTIVE' },
  { weight: 50, status: 'ACTIVE' },
  { weight: 25, status: 'CANCELLED' }
]).ok);
check('PMS-weight-empty', !PmsEngine.validateWeights([]).ok);

const scale = PmsEngine.defaultScale();
check('PMS-scale-default-5', scale.length === 5 && scale[0].value === 1 && scale[4].label === 'Exceptional');
check('PMS-scale-rejects-unknown', PmsEngine.isAllowedRating(3, scale) && !PmsEngine.isAllowedRating(9, scale));
check('PMS-scale-custom', PmsEngine.isAllowedRating(2, [
  { value: 1, label: 'Low', is_active: true },
  { value: 2, label: 'High', is_active: true }
]) && !PmsEngine.isAllowedRating(5, [
  { value: 1, label: 'Low', is_active: true },
  { value: 2, label: 'High', is_active: true }
]));

check('PMS-overall-weighted', PmsEngine.computeOverallRating([
  { weight: 50, status: 'ACTIVE', manager_rating: 4 },
  { weight: 50, status: 'ACTIVE', manager_rating: 2 }
], 'manager') === 3);

const cycleOpen = { status: CS.OPEN, review_deadline: '2026-09-15' };
const reviewDraft = { status: RS.IN_PROGRESS, reopen_allowed: false };
check('PMS-employee-can-submit-open', PmsEngine.canEmployeeSubmit(cycleOpen, reviewDraft));
check('PMS-duplicate-self-submit', throws(function () {
  PmsEngine.assertEmployeeCanSubmit(
    cycleOpen,
    { status: RS.SELF_SUBMITTED, reopen_allowed: false },
    [{ weight: 100, status: 'ACTIVE' }]
  );
}).threw);
check('PMS-reopen-allows-edit', PmsEngine.canEmployeeSubmit(cycleOpen, {
  status: RS.SELF_SUBMITTED,
  reopen_allowed: true
}));
check('PMS-employee-blocked-after-open', !PmsEngine.canEmployeeSubmit({ status: CS.EMPLOYEE_SUBMITTED }, reviewDraft));

const mgrCycle = { status: CS.MANAGER_REVIEW };
const mgrReview = { status: RS.SELF_SUBMITTED };
const mgrGoals = [{ weight: 100, status: 'ACTIVE', manager_rating: 4 }];
check('PMS-manager-submit-ok', !throws(function () {
  PmsEngine.assertManagerCanSubmit(mgrCycle, mgrReview, mgrGoals);
}).threw);
check('PMS-duplicate-manager-submit', throws(function () {
  PmsEngine.assertManagerCanSubmit(mgrCycle, { status: RS.MANAGER_SUBMITTED }, mgrGoals);
}).threw);
check('PMS-manager-before-window', throws(function () {
  PmsEngine.assertManagerCanSubmit(cycleOpen, mgrReview, mgrGoals);
}).threw);
check('PMS-manager-requires-ratings', throws(function () {
  PmsEngine.assertManagerCanSubmit(mgrCycle, mgrReview, [{ weight: 100, status: 'ACTIVE' }]);
}).threw);
check('PMS-finalize-ok', !throws(function () {
  PmsEngine.assertCanFinalize(mgrCycle, { status: RS.MANAGER_SUBMITTED });
}).threw);
check('PMS-finalize-duplicate', throws(function () {
  PmsEngine.assertCanFinalize(mgrCycle, { status: RS.FINALIZED });
}).threw);
check('PMS-finalize-before-manager', throws(function () {
  PmsEngine.assertCanFinalize(mgrCycle, { status: RS.SELF_SUBMITTED });
}).threw);

const hr = { authorized: true, role: 'HR', employee_id: 'EMP001' };
const mgr = { authorized: true, role: 'MANAGER', employee_id: 'EMP002' };
const emp = { authorized: true, role: 'EMPLOYEE', employee_id: 'EMP003' };
const other = { authorized: true, role: 'EMPLOYEE', employee_id: 'EMP004' };
const report = { employee_id: 'EMP003', manager_employee_id: 'EMP002' };
const outsider = { employee_id: 'EMP004', manager_employee_id: 'EMP099' };

check('PMS-rbac-hr-cycles', PmsEngine.can(ACT.MANAGE_CYCLES, hr, {}));
check('PMS-rbac-emp-no-cycles', !PmsEngine.can(ACT.MANAGE_CYCLES, emp, {}));
check('PMS-rbac-mgr-no-cycles', !PmsEngine.can(ACT.MANAGE_CYCLES, mgr, {}));
check('PMS-rbac-hr-finalize', PmsEngine.can(ACT.FINALIZE, hr, {}));
check('PMS-rbac-mgr-no-finalize', !PmsEngine.can(ACT.FINALIZE, mgr, {}));
check('PMS-rbac-self-assess-own', PmsEngine.can(ACT.SELF_ASSESS, emp, { employee: report }));
check('PMS-rbac-self-assess-other', !PmsEngine.can(ACT.SELF_ASSESS, emp, { employee: outsider }));
check('PMS-rbac-mgr-review-report', PmsEngine.can(ACT.MANAGER_REVIEW, mgr, { employee: report }));
check('PMS-rbac-mgr-review-self-denied', !PmsEngine.can(ACT.MANAGER_REVIEW, mgr, {
  employee: { employee_id: 'EMP002', manager_employee_id: 'EMP001' }
}));
check('PMS-rbac-mgr-review-outsider', !PmsEngine.can(ACT.MANAGER_REVIEW, mgr, { employee: outsider }));
check('PMS-rbac-emp-no-team', !PmsEngine.can(ACT.VIEW_TEAM, emp, {}));
check('PMS-view-invalid-access', !PmsEngine.canViewEmployeePms(other, report, {}));
check('PMS-view-self', PmsEngine.canViewEmployeePms(emp, report, {}));
check('PMS-view-hr', PmsEngine.canViewEmployeePms(hr, outsider, {}));

check('PMS-nav-hr-has-cycles', PmsPermissionService.navItemsForRole('HR').some(function (n) {
  return n.route === 'pms-cycles';
}));
check('PMS-nav-emp-no-appraisal', !PmsPermissionService.navItemsForRole('EMPLOYEE').some(function (n) {
  return n.route === 'pms-appraisal';
}));

const kpis = PmsEngine.buildDashboardKpis({
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
check('PMS-kpi-active', kpis.active_cycles === 2, JSON.stringify(kpis));
check('PMS-kpi-pending-self', kpis.employees_pending_self === 1, JSON.stringify(kpis));
check('PMS-kpi-pending-mgr', kpis.managers_pending_review === 1, JSON.stringify(kpis));
check('PMS-kpi-completed', kpis.completed_reviews === 1, JSON.stringify(kpis));
check('PMS-kpi-overdue', kpis.overdue_reviews >= 1, JSON.stringify(kpis));

if (failures.length) {
  console.error('\n' + failures.length + ' failed:\n' + failures.join('\n'));
  process.exit(1);
}
console.log('\nAll PMS engine tests passed.');
