/**
 * ATS module constants. Candidates are not employees — never reuse employee_id.
 * Sheet names live here (not in foundation Constants) so ATS can ship independently.
 */
var ATS = ATS || {};

ATS.SHEETS = {
  JOBS: 'JobRequisitions',
  CANDIDATES: 'Candidates',
  APPLICATIONS: 'Applications',
  INTERVIEWS: 'Interviews',
  ACTIVITY: 'CandidateActivity'
};

ATS.JOB_STATUS = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  PAUSED: 'PAUSED',
  CLOSED: 'CLOSED'
};

ATS.STAGE = {
  APPLIED: 'APPLIED',
  SCREENING: 'SCREENING',
  SHORTLISTED: 'SHORTLISTED',
  INTERVIEW: 'INTERVIEW',
  SELECTED: 'SELECTED',
  OFFER: 'OFFER',
  HIRED: 'HIRED',
  REJECTED: 'REJECTED',
  WITHDRAWN: 'WITHDRAWN'
};

ATS.DEFAULT_PIPELINE = [
  'APPLIED', 'SCREENING', 'SHORTLISTED', 'INTERVIEW', 'SELECTED', 'OFFER', 'HIRED'
];

ATS.TERMINAL_EXTRA = ['REJECTED', 'WITHDRAWN'];

ATS.RECOMMENDATION = {
  STRONG_HIRE: 'STRONG_HIRE',
  HIRE: 'HIRE',
  HOLD: 'HOLD',
  NO_HIRE: 'NO_HIRE'
};

ATS.EMPLOYMENT_TYPES = [
  'PERMANENT', 'CONTRACT', 'INTERN', 'CONSULTANT', 'FULL_TIME', 'PART_TIME'
];

ATS.SOURCES = [
  'CAREERS_PAGE', 'REFERRAL', 'LINKEDIN', 'NAUKRI', 'AGENCY', 'CAMPUS', 'OTHER'
];

ATS.ACTIONS = {
  ACCESS: 'ATS_ACCESS',
  MANAGE: 'ATS_MANAGE',
  SETUP: 'ATS_SETUP',
  INTERVIEW: 'ATS_INTERVIEW',
  RESUME: 'ATS_RESUME'
};

ATS.SEQ = {
  JOB: 'seq_ats_job',
  CANDIDATE: 'seq_ats_candidate',
  APPLICATION: 'seq_ats_application',
  INTERVIEW: 'seq_ats_interview',
  ACTIVITY: 'seq_ats_activity'
};

ATS.SETTINGS = {
  PIPELINE: 'ats_pipeline_stages',
  APPLY_ENABLED: 'ats_public_apply_enabled',
  RESUME_MAX: 'ats_resume_max_bytes'
};

ATS.ID_PREFIX = {
  JOB: 'JOB',
  CAND: 'CAND',
  APP: 'APP',
  INT: 'INT',
  ACT: 'ACT'
};

ATS.AUDIT = {
  JOB_CREATE: 'ATS_JOB_CREATE',
  JOB_UPDATE: 'ATS_JOB_UPDATE',
  JOB_PUBLISH: 'ATS_JOB_PUBLISH',
  JOB_PAUSE: 'ATS_JOB_PAUSE',
  JOB_RESUME: 'ATS_JOB_RESUME',
  JOB_CLOSE: 'ATS_JOB_CLOSE',
  JOB_REOPEN: 'ATS_JOB_REOPEN',
  APPLY: 'ATS_PUBLIC_APPLY',
  STAGE: 'ATS_STAGE_CHANGE',
  INTERVIEW: 'ATS_INTERVIEW',
  COMMENT: 'ATS_COMMENT',
  RESUME: 'ATS_RESUME_ACCESS',
  SETUP: 'ATS_SETUP'
};

ATS.DRIVE = {
  CANDIDATES_FOLDER: 'ATS Candidates'
};

ATS.LIMITS = {
  NAME_MAX: 120,
  TEXT_MAX: 8000,
  SKILLS_MAX: 500,
  SOURCE_MAX: 80,
  PHONE_MIN: 8,
  PHONE_MAX: 20,
  RESUME_MAX_BYTES: 2097152,
  APPLY_RATE_MAX: 5,
  APPLY_RATE_TTL_SEC: 3600,
  SLUG_LEN: 20,
  ID_PAD: 4
};

/** Fields safe to return on unauthenticated job views. Never include internals. */
ATS.PUBLIC_JOB_FIELDS = [
  'public_slug', 'title', 'department', 'location', 'employment_type',
  'experience', 'education', 'salary_range', 'description', 'responsibilities',
  'requirements', 'skills', 'openings', 'closing_date', 'published_at'
];

/** Reserved job columns for future job-board APIs — do not remove. */
ATS.SHARE_CHANNELS = [
  { id: 'copy_link', label: 'Copy link', enabled: true, provider: 'manual' },
  { id: 'open_apply', label: 'Open application', enabled: true, provider: 'manual' },
  { id: 'share_job', label: 'Share job', enabled: true, provider: 'manual' },
  { id: 'linkedin', label: 'LinkedIn', enabled: false, provider: 'linkedin' },
  { id: 'naukri', label: 'Naukri', enabled: false, provider: 'naukri' }
];

ATS.NAV_ITEMS = [
  { id: 'ats', label: 'Recruitment', route: 'ats', icon: 'group', roles: ['ADMIN', 'HR', 'MANAGER'] },
  { id: 'ats-jobs', label: 'Jobs', route: 'ats-jobs', icon: 'event', roles: ['ADMIN', 'HR', 'MANAGER'] },
  { id: 'ats-candidates', label: 'Candidates', route: 'ats-candidates', icon: 'people', roles: ['ADMIN', 'HR', 'MANAGER'] }
];
