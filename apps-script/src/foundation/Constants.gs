/**
 * Shared constants - sheet names, roles, property keys, permission actions.
 */
var HRMS = HRMS || {};

HRMS.SHEETS = {
  EMPLOYEES: 'Employees',
  VERTICALS: 'Verticals',
  USERS: 'Users',
  LEAVE_TYPES: 'LeaveTypes',
  LEAVE_BALANCES: 'LeaveBalances',
  LEAVE_REQUESTS: 'LeaveRequests',
  SALARY_STRUCTURES: 'SalaryStructures',
  SALARY_COMPONENTS: 'SalaryComponents',
  PAYROLL_RUNS: 'PayrollRuns',
  PAYROLL_INPUTS: 'PayrollInputs',
  PAYROLL_RECORDS: 'PayrollRecords',
  NOTIFICATIONS: 'Notifications',
  AUDIT_LOG: 'AuditLog',
  SETTINGS: 'Settings',
  DOCUMENTS: 'Documents',
  EMPLOYEE_FIELD_DEFS: 'EmployeeFieldDefs'
};

HRMS.ROLES = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  HR: 'HR',
  MANAGER: 'MANAGER',
  EMPLOYEE: 'EMPLOYEE'
};

HRMS.USER_STATUS = {
  ACTIVE: 'ACTIVE',
  DISABLED: 'DISABLED'
};

HRMS.EMPLOYEE_STATUS = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE'
};

HRMS.EMPLOYMENT_TYPES = {
  PERMANENT: 'PERMANENT',
  CONTRACT: 'CONTRACT',
  INTERN: 'INTERN',
  CONSULTANT: 'CONSULTANT'
};

HRMS.VERTICALS = ['AOPL', 'SAPL', 'AOMS', 'OTHERS'];

/** Max leave balance shown on attendance register / Form T (per vertical). */
HRMS.ATTENDANCE_LEAVE_BALANCE_MAX = {
  SAPL: 2,
  AOPL: 2,
  AOMS: 1,
  OTHERS: 2
};

/** Default legal entity names for verticals (seeded on Verticals sheet). */
HRMS.VERTICAL_LEGAL_NAMES_DEFAULT = {
  AOPL: 'Ayurveda One Private Limited',
  SAPL: 'Sattva Ayurveda Private Limited',
  AOMS: 'Ayurvedaone Private Limited',
  OTHERS: 'Others'
};

/** Form T establishment block (top-right) defaults when Verticals sheet lines are empty. */
HRMS.VERTICAL_FORM_T_ADDRESS_DEFAULT = {
  AOPL: {
    address_line1: 'No 93, 23, Yeshwanthpur Industrial Suburb',
    address_line2: 'Yeswanthpur, Bengaluru, Karnataka 560022'
  },
  SAPL: {
    address_line1: 'No 93, 23, Yeshwanthpur Industrial Suburb',
    address_line2: 'Yeswanthpur, Bengaluru, Karnataka 560022'
  },
  AOMS: {
    address_line1: 'No 93, 23, Yeshwanthpur Industrial Suburb',
    address_line2: 'Yeswanthpur, Bengaluru, Karnataka 560022'
  },
  OTHERS: {
    address_line1: '',
    address_line2: ''
  }
};

/** Payslip header address (single line) when vertical catalog lines are empty. */
HRMS.PAYSLIP_ADDRESS_BY_VERTICAL = {
  SAPL: 'Plot No 93/23, 2nd Floor, Industrial Suburb, Yeshwanthpura, Bangalore - 560022',
  AOPL: 'Plot No 93/23, 2nd Floor, Industrial Suburb, Yeshwanthpura, Bangalore - 560022',
  AOMS: 'Plot No 93/23, 2nd Floor, Industrial Suburb, Yeshwanthpura, Bangalore - 560022'
};

HRMS.DOCUMENT_CATEGORY = {
  EMPLOYEE_FILE: 'EMPLOYEE_FILE',
  PAYSLIP: 'PAYSLIP'
};

HRMS.WEBAPP = {
  /** Must match appsscript.json webapp.executeAs - owner-mediated Sheets/Drive access. */
  EXECUTE_AS: 'USER_DEPLOYING',
  /**
   * Must match appsscript.json webapp.access.
   * ANYONE_ANONYMOUS: browser can open /exec without Google account selection
   * (avoids multi-account "unable to open the file" gate). Application auth
   * (Google identity when available + OTP + session) remains the source of truth.
   */
  ACCESS: 'ANYONE_ANONYMOUS'
};

HRMS.APP_MODE = {
  PRODUCTION: 'PRODUCTION',
  DEMO: 'DEMO'
};

HRMS.PROPS = {
  SPREADSHEET_ID: 'HRMS_SPREADSHEET_ID',
  DRIVE_ROOT_FOLDER_ID: 'HRMS_DRIVE_ROOT_FOLDER_ID',
  /** Set to '1' to log/return startup timings (dev/test only). */
  PERF_TIMING: 'HRMS_PERF_TIMING',
  /** Knowledge Hub web app URL - Script Properties only, never sent to the browser. */
  KH_WEBAPP_URL: 'KH_WEBAPP_URL',
  /** HMAC secret shared with Knowledge Hub - Script Properties only, never sent to the browser. */
  KH_HMAC_SECRET: 'KH_HMAC_SECRET',
};

HRMS.SETTINGS_KEYS = {
  APP_MODE: 'app_mode',
  DEMO_EMAILS: 'demo_emails',
  DEMO_DEFAULT_ROLE: 'demo_default_role',
  DEMO_ROLES: 'demo_roles',
  FORM_T_TEMPLATE_DRIVE_ID: 'form_t_template_drive_id'
};

HRMS.DRIVE = {
  ROOT_NAME: 'HRMS Root',
  EMPLOYEE_DOCS: 'Employee Documents',
  PAYSLIPS: 'Payslips'
};

/** Permission actions - extend as modules are added. */
HRMS.ACTIONS = {
  ACCESS_APP: 'ACCESS_APP',
  /** Native Ask HR chatbot. v1: same roles as ACCESS_APP; can later be disabled per role. */
  ASK_HR: 'ASK_HR',
  RUN_SETUP: 'RUN_SETUP',
  ADMIN_SETTINGS: 'ADMIN_SETTINGS',
  ADMIN_USERS: 'ADMIN_USERS',
  VIEW_AUDIT: 'VIEW_AUDIT',
  EMPLOYEE_DIRECTORY: 'EMPLOYEE_DIRECTORY',
  EMPLOYEE_CREATE: 'EMPLOYEE_CREATE',
  EMPLOYEE_UPDATE: 'EMPLOYEE_UPDATE',
  EMPLOYEE_STATUS: 'EMPLOYEE_STATUS',
  EMPLOYEE_DOCUMENTS: 'EMPLOYEE_DOCUMENTS',
  LEAVE_APPLY: 'LEAVE_APPLY',
  LEAVE_APPROVE: 'LEAVE_APPROVE',
  LEAVE_ADMIN: 'LEAVE_ADMIN',
  PAYROLL_RUN: 'PAYROLL_RUN',
  ATTENDANCE_MANAGE: 'ATTENDANCE_MANAGE',
  VIEW_OWN_PAYSLIP: 'VIEW_OWN_PAYSLIP',
  COMPENSATION_MANAGE: 'COMPENSATION_MANAGE',
  ATS_ACCESS: 'ATS_ACCESS',
  ATS_MANAGE: 'ATS_MANAGE'
};

HRMS.PAYROLL_STATUS = {
  DRAFT: 'DRAFT',
  CALCULATED: 'CALCULATED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  APPROVED: 'APPROVED',
  LOCKED: 'LOCKED'
};

HRMS.STRUCTURE_STATUS = {
  CURRENT: 'CURRENT',
  SUPERSEDED: 'SUPERSEDED'
};

/** Status values for reusable salary structure *types* (shared templates). */
HRMS.STRUCTURE_TYPE_STATUS = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE'
};

HRMS.COMPONENT_KIND = {
  EARNING: 'EARNING',
  DEDUCTION: 'DEDUCTION',
  EMPLOYER: 'EMPLOYER'
};

HRMS.CALC_METHOD = {
  FIXED: 'FIXED',
  PERCENT_OF_BASIC: 'PERCENT_OF_BASIC',
  PERCENT_OF_CTC: 'PERCENT_OF_CTC'
};

HRMS.PAYROLL_EXCEPTION = {
  MISSING_STRUCTURE: 'MISSING_STRUCTURE',
  MISSING_BANK: 'MISSING_BANK',
  MISSING_PAN: 'MISSING_PAN',
  NEGATIVE_NET: 'NEGATIVE_NET',
  WORKING_DAYS_ZERO: 'WORKING_DAYS_ZERO'
};

HRMS.DOC_CATEGORY = {
  EMPLOYEE_FILE: 'EMPLOYEE_FILE',
  PAYSLIP: 'PAYSLIP'
};

HRMS.AUDIT_ACTIONS = {
  PAYROLL_CREATE: 'PAYROLL_CREATE',
  PAYROLL_CALCULATE: 'PAYROLL_CALCULATE',
  PAYROLL_REVIEW: 'PAYROLL_REVIEW',
  PAYROLL_APPROVE: 'PAYROLL_APPROVE',
  PAYROLL_LOCK: 'PAYROLL_LOCK',
  PAYROLL_CORRECT: 'PAYROLL_CORRECT',
  PAYROLL_RETURN_DRAFT: 'PAYROLL_RETURN_DRAFT',
  SALARY_SAVE: 'SALARY_SAVE',
  SALARY_REVISE: 'SALARY_REVISE',
  STRUCTURE_TYPE_SAVE: 'STRUCTURE_TYPE_SAVE',
  STRUCTURE_TYPE_STATUS: 'STRUCTURE_TYPE_STATUS'
};

HRMS.CACHE = {
  SETTINGS_KEY: 'hrms_settings_v1',
  TTL_SECONDS: 120,
  ASK_HR_RATE_PREFIX: 'hrms_askhr_rate_v1_',
  /**
   * Short-lived Users+Employees identity snapshot (not an authorization decision).
   * Keyed by email. TTL 15s. Generation is bumped on any Users/Employees write so
   * disable/role changes take effect on the next RPC (direct sheet edits: max 15s).
   */
  IDENTITY_PREFIX: 'hrms:id:v1:',
  IDENTITY_GEN_KEY: 'hrms:id:gen',
  IDENTITY_TTL_SEC: 15
};

/** Ask HR chatbot - server-side only. */
HRMS.ASK_HR = {
  VERSION: '1',
  MIN_QUESTION_LEN: 3,
  MAX_QUESTION_LEN: 1000,
  RATE_MAX: 10,
  RATE_WINDOW_SEC: 900,
  RATE_WINDOW_MS: 900000,
  AUDIT_QUESTION_CHARS: 80,
  ANSWER_MAX_CHARS: 20000,
  FILENAME_MAX_CHARS: 200,
  KEYPOINT_MAX: 10,
  KEYPOINT_MAX_CHARS: 500,
  REF_MAX: 10,
  NONCE_HEX_LEN: 32
};

HRMS.AUTH_CACHE = {
  OTP_PREFIX: 'hrms_otp_v1_',
  OTP_RATE_PREFIX: 'hrms_otp_rate_v1_',
  OTP_DEMO_RATE_PREFIX: 'hrms_otp_demo_rate_v1_',
  SESSION_PREFIX: 'hrms_sess_v1_'
};

/** Bump when module HTML/JS changes so browsers reload lazy modules after clasp push. */
HRMS.CLIENT_ASSETS_VERSION = '2026.09.26.05';

HRMS.AUTH_LIMITS = {
  OTP_TTL_SEC: 600,
  OTP_TTL_MS: 600000,
  OTP_MAX_REQUESTS: 3,
  DEMO_OTP_MAX_REQUESTS: 20,
  OTP_RATE_WINDOW_SEC: 900,
  OTP_RATE_WINDOW_MS: 900000,
  OTP_MAX_VERIFY_ATTEMPTS: 5,
  SESSION_TTL_SEC: 21600
};
