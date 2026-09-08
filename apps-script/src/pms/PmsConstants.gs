/**
 * PMS constants. Extends HRMS.SHEETS from this module so Constants.gs is unchanged.
 */
var HRMS = HRMS || {};
HRMS.SHEETS = HRMS.SHEETS || {};

HRMS.SHEETS.PERFORMANCE_CYCLES = 'PerformanceCycles';
HRMS.SHEETS.PERFORMANCE_GOALS = 'PerformanceGoals';
HRMS.SHEETS.PERFORMANCE_REVIEWS = 'PerformanceReviews';
HRMS.SHEETS.PERFORMANCE_RATINGS = 'PerformanceRatings';

HRMS.PMS = {
  CYCLE_STATUS: {
    DRAFT: 'DRAFT',
    OPEN: 'OPEN',
    EMPLOYEE_SUBMITTED: 'EMPLOYEE_SUBMITTED',
    MANAGER_REVIEW: 'MANAGER_REVIEW',
    FINALIZED: 'FINALIZED',
    CLOSED: 'CLOSED'
  },
  GOAL_STATUS: {
    DRAFT: 'DRAFT',
    ACTIVE: 'ACTIVE',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED'
  },
  REVIEW_STATUS: {
    NOT_STARTED: 'NOT_STARTED',
    IN_PROGRESS: 'IN_PROGRESS',
    SELF_SUBMITTED: 'SELF_SUBMITTED',
    MANAGER_SUBMITTED: 'MANAGER_SUBMITTED',
    FINALIZED: 'FINALIZED'
  },
  ACTIONS: {
    VIEW_DASHBOARD: 'PMS_VIEW_DASHBOARD',
    MANAGE_CYCLES: 'PMS_MANAGE_CYCLES',
    MANAGE_GOALS: 'PMS_MANAGE_GOALS',
    VIEW_OWN: 'PMS_VIEW_OWN',
    SELF_ASSESS: 'PMS_SELF_ASSESS',
    VIEW_TEAM: 'PMS_VIEW_TEAM',
    MANAGER_REVIEW: 'PMS_MANAGER_REVIEW',
    FINALIZE: 'PMS_FINALIZE',
    MANAGE_RATINGS: 'PMS_MANAGE_RATINGS',
    REOPEN: 'PMS_REOPEN'
  },
  AUDIT: {
    CYCLE_CREATE: 'PMS_CYCLE_CREATE',
    CYCLE_UPDATE: 'PMS_CYCLE_UPDATE',
    CYCLE_TRANSITION: 'PMS_CYCLE_TRANSITION',
    GOAL_CREATE: 'PMS_GOAL_CREATE',
    GOAL_UPDATE: 'PMS_GOAL_UPDATE',
    GOAL_DELETE: 'PMS_GOAL_DELETE',
    SELF_SAVE: 'PMS_SELF_SAVE',
    SELF_SUBMIT: 'PMS_SELF_SUBMIT',
    SELF_REOPEN: 'PMS_SELF_REOPEN',
    MANAGER_SAVE: 'PMS_MANAGER_SAVE',
    MANAGER_SUBMIT: 'PMS_MANAGER_SUBMIT',
    FINALIZE: 'PMS_FINALIZE',
    RATING_SCALE_SAVE: 'PMS_RATING_SCALE_SAVE',
    SCHEMA_ENSURE: 'PMS_SCHEMA_ENSURE'
  },
  WEIGHT_TOTAL: 100,
  WEIGHT_EPS: 0.01,
  SCALE_CODE: 'DEFAULT',
  TITLE_MAX: 120,
  TEXT_MAX: 2000,
  NAME_MAX: 80,
  ID_PREFIX: {
    CYCLE: 'PCY',
    GOAL: 'PGL',
    REVIEW: 'PRV',
    RATING: 'PRT'
  }
};

HRMS.PMS.DEFAULT_RATINGS = [
  { value: 1, label: 'Needs Significant Improvement', description: 'Performance is well below the expected standard.', sort_order: 1 },
  { value: 2, label: 'Needs Improvement', description: 'Performance is below the expected standard in important areas.', sort_order: 2 },
  { value: 3, label: 'Meets Expectations', description: 'Performance meets the expected standard.', sort_order: 3 },
  { value: 4, label: 'Exceeds Expectations', description: 'Performance is consistently above the expected standard.', sort_order: 4 },
  { value: 5, label: 'Exceptional', description: 'Performance is outstanding and a model for others.', sort_order: 5 }
];

HRMS.PMS.CYCLE_STATUS_ORDER = [
  'DRAFT',
  'OPEN',
  'EMPLOYEE_SUBMITTED',
  'MANAGER_REVIEW',
  'FINALIZED',
  'CLOSED'
];

HRMS.PMS.NAV = [
  { id: 'pms', label: 'Performance', route: 'pms', icon: 'dashboard', roles: ['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'] },
  { id: 'pms-cycles', label: 'Review cycles', route: 'pms-cycles', icon: 'event', roles: ['ADMIN', 'HR'] },
  { id: 'pms-my-review', label: 'My review', route: 'pms-my-review', icon: 'person', roles: ['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'] },
  { id: 'pms-team', label: 'Team reviews', route: 'pms-team', icon: 'group', roles: ['ADMIN', 'HR', 'MANAGER'] },
  { id: 'pms-appraisal', label: 'Appraisals', route: 'pms-appraisal', icon: 'approval', roles: ['ADMIN', 'HR'] }
];
