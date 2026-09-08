/**
 * Pure ATS rules — job lifecycle, pipeline, RBAC helpers, public sanitization.
 * No SpreadsheetApp / AuthService calls. Safe for Node unit tests.
 */
var ATS = ATS || {};

var AtsEngine = (function () {
  var JOB_NEXT_ = {};
  JOB_NEXT_[ATS.JOB_STATUS.DRAFT] = [ATS.JOB_STATUS.PUBLISHED];
  JOB_NEXT_[ATS.JOB_STATUS.PUBLISHED] = [ATS.JOB_STATUS.PAUSED, ATS.JOB_STATUS.CLOSED];
  JOB_NEXT_[ATS.JOB_STATUS.PAUSED] = [ATS.JOB_STATUS.PUBLISHED, ATS.JOB_STATUS.CLOSED];
  JOB_NEXT_[ATS.JOB_STATUS.CLOSED] = [];

  var REOPEN_NEXT_ = {};
  REOPEN_NEXT_[ATS.JOB_STATUS.CLOSED] = [ATS.JOB_STATUS.PAUSED, ATS.JOB_STATUS.PUBLISHED];

  function upper_(v) {
    return String(v || '').trim().toUpperCase();
  }

  function trim_(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
  }

  function normalizeEmail_(email) {
    return trim_(email).toLowerCase();
  }

  function isValidEmail_(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function formatAtsId(prefix, seq, pad) {
    var width = pad || ATS.LIMITS.ID_PAD;
    var num = String(Number(seq) || 0);
    while (num.length < width) num = '0' + num;
    return String(prefix) + num;
  }

  function isEmployeeIdShape_(value) {
    return /^EMP\d+/i.test(trim_(value));
  }

  function isCandidateId(value) {
    return /^CAND\d+$/i.test(trim_(value));
  }

  function isJobId(value) {
    return /^JOB\d+$/i.test(trim_(value));
  }

  function defaultPipeline() {
    return ATS.DEFAULT_PIPELINE.slice();
  }

  function parsePipeline(raw) {
    if (Array.isArray(raw)) {
      return normalizePipeline_(raw);
    }
    var text = trim_(raw);
    if (!text) return defaultPipeline();
    try {
      var parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return normalizePipeline_(parsed);
    } catch (ignore) {}
    var parts = text.split(/[,;]+/).map(upper_).filter(Boolean);
    return parts.length ? normalizePipeline_(parts) : defaultPipeline();
  }

  function normalizePipeline_(list) {
    var seen = {};
    var out = [];
    list.forEach(function (item) {
      var stage = upper_(item);
      if (!stage || seen[stage]) return;
      if (stage === ATS.STAGE.REJECTED || stage === ATS.STAGE.WITHDRAWN) return;
      seen[stage] = true;
      out.push(stage);
    });
    if (!out.length) return defaultPipeline();
    if (out.indexOf(ATS.STAGE.APPLIED) < 0) out.unshift(ATS.STAGE.APPLIED);
    if (out.indexOf(ATS.STAGE.HIRED) < 0) out.push(ATS.STAGE.HIRED);
    return out;
  }

  function happyPath(pipeline) {
    return parsePipeline(pipeline);
  }

  function isTerminalExtra(stage) {
    var s = upper_(stage);
    return s === ATS.STAGE.REJECTED || s === ATS.STAGE.WITHDRAWN;
  }

  function isHappyPathStage(stage, pipeline) {
    return happyPath(pipeline).indexOf(upper_(stage)) >= 0;
  }

  function isKnownStage(stage, pipeline) {
    var s = upper_(stage);
    return isHappyPathStage(s, pipeline) || isTerminalExtra(s);
  }

  function canTransitionJob(fromStatus, toStatus, options) {
    options = options || {};
    var from = upper_(fromStatus);
    var to = upper_(toStatus);
    if (!from || !to || from === to) return false;
    var allowed = JOB_NEXT_[from] || [];
    if (allowed.indexOf(to) >= 0) return true;
    if (options.allowReopen && REOPEN_NEXT_[from] && REOPEN_NEXT_[from].indexOf(to) >= 0) {
      return true;
    }
    return false;
  }

  function jobActionForTransition(fromStatus, toStatus) {
    var from = upper_(fromStatus);
    var to = upper_(toStatus);
    if (to === ATS.JOB_STATUS.PUBLISHED && from === ATS.JOB_STATUS.DRAFT) return ATS.AUDIT.JOB_PUBLISH;
    if (to === ATS.JOB_STATUS.PUBLISHED && from === ATS.JOB_STATUS.PAUSED) return ATS.AUDIT.JOB_RESUME;
    if (to === ATS.JOB_STATUS.PAUSED && from === ATS.JOB_STATUS.PUBLISHED) return ATS.AUDIT.JOB_PAUSE;
    if (to === ATS.JOB_STATUS.CLOSED) return ATS.AUDIT.JOB_CLOSE;
    if (from === ATS.JOB_STATUS.CLOSED) return ATS.AUDIT.JOB_REOPEN;
    return ATS.AUDIT.JOB_UPDATE;
  }

  function todayIso_(nowIso) {
    var s = trim_(nowIso);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
    return '';
  }

  function isJobAcceptingApplications(job, todayIso) {
    if (!job) return false;
    if (upper_(job.status) !== ATS.JOB_STATUS.PUBLISHED) return false;
    var close = trim_(job.closing_date);
    if (close) {
      var today = todayIso_(todayIso);
      if (today && close.substring(0, 10) < today) return false;
    }
    return true;
  }

  function isPubliclyVisibleJob(job) {
    if (!job) return false;
    var status = upper_(job.status);
    return status === ATS.JOB_STATUS.PUBLISHED || status === ATS.JOB_STATUS.PAUSED;
  }

  function publicFieldValue_(value) {
    if (value === undefined || value === null || value === '') return '';
    if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
      return value.toISOString();
    }
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    return String(value);
  }

  function publicJobView(job) {
    job = job || {};
    var out = {};
    ATS.PUBLIC_JOB_FIELDS.forEach(function (key) {
      out[key] = publicFieldValue_(job[key]);
    });
    out.accepting_applications = isJobAcceptingApplications(job, '');
    out.status_label = upper_(job.status) === ATS.JOB_STATUS.PUBLISHED ? 'OPEN' : 'NOT_ACCEPTING';
    if (upper_(job.status) === ATS.JOB_STATUS.PAUSED) out.status_label = 'PAUSED';
    return out;
  }

  function assertPublicJobSafe(view) {
    var leaked = [
      'job_id', 'notes_internal', 'hiring_manager_employee_id', 'hiring_manager_name',
      'created_by_email', 'updated_by_email', 'external_ref_json', 'employee_id',
      'google_email', 'pan', 'bank_account_number'
    ];
    var bad = leaked.filter(function (key) {
      return view && Object.prototype.hasOwnProperty.call(view, key);
    });
    return bad;
  }

  function findDuplicateApplication(applications, email, jobId) {
    var wantEmail = normalizeEmail_(email);
    var wantJob = trim_(jobId);
    if (!wantEmail || !wantJob) return null;
    var list = applications || [];
    for (var i = 0; i < list.length; i++) {
      var row = list[i];
      if (trim_(row.job_id) !== wantJob) continue;
      if (normalizeEmail_(row.email || row.candidate_email) !== wantEmail) continue;
      if (upper_(row.stage) === ATS.STAGE.WITHDRAWN) continue;
      return row;
    }
    return null;
  }

  function canMoveStage(fromStage, toStage, pipeline, options) {
    options = options || {};
    var from = upper_(fromStage);
    var to = upper_(toStage);
    if (!from || !to || from === to) return false;
    if (!isKnownStage(to, pipeline)) return false;
    if (from === ATS.STAGE.HIRED) return false;
    if (from === ATS.STAGE.REJECTED && !options.allowReopenRejected) return false;
    if (from === ATS.STAGE.WITHDRAWN && !options.allowReopenWithdrawn) return false;
    if (isTerminalExtra(to)) return true;
    var path = happyPath(pipeline);
    var fromIdx = path.indexOf(from);
    var toIdx = path.indexOf(to);
    if (toIdx < 0) return false;
    if (fromIdx < 0) {
      return options.allowReopenRejected || options.allowReopenWithdrawn;
    }
    if (toIdx >= fromIdx) return true;
    return !!options.allowBackward;
  }

  function roleOf(session) {
    return upper_(session && session.role);
  }

  function canAccessAts(session) {
    if (!session || !session.authorized) return false;
    var role = roleOf(session);
    return role === 'ADMIN' || role === 'HR' || role === 'MANAGER';
  }

  function canManageAts(session) {
    if (!canAccessAts(session)) return false;
    var role = roleOf(session);
    return role === 'ADMIN' || role === 'HR';
  }

  function isManager(session) {
    return roleOf(session) === 'MANAGER';
  }

  function isAssignedHiringManager(session, job) {
    if (!session || !job) return false;
    var emp = trim_(session.employee_id);
    if (!emp) return false;
    return trim_(job.hiring_manager_employee_id) === emp;
  }

  function isAssignedInterviewer(session, interviews) {
    if (!session) return false;
    var emp = trim_(session.employee_id);
    var email = normalizeEmail_(session.email);
    if (!emp && !email) return false;
    var list = interviews || [];
    for (var i = 0; i < list.length; i++) {
      var row = list[i];
      if (emp && trim_(row.interviewer_employee_id) === emp) return true;
      if (email && normalizeEmail_(row.interviewer_email || '') === email) return true;
    }
    return false;
  }

  function canAccessJob(session, job, interviews) {
    if (!canAccessAts(session)) return false;
    if (canManageAts(session)) return true;
    return isAssignedHiringManager(session, job) || isAssignedInterviewer(session, interviews);
  }

  function canAccessCandidate(session, jobsForCandidate, interviewsForCandidate) {
    if (!canAccessAts(session)) return false;
    if (canManageAts(session)) return true;
    var jobs = jobsForCandidate || [];
    for (var i = 0; i < jobs.length; i++) {
      if (isAssignedHiringManager(session, jobs[i])) return true;
    }
    return isAssignedInterviewer(session, interviewsForCandidate);
  }

  function canDownloadResume(session, job, interviews) {
    if (!canAccessAts(session)) return false;
    if (canManageAts(session)) return true;
    return canAccessJob(session, job, interviews);
  }

  function canWriteInterview(session, job, interview) {
    if (!canAccessAts(session)) return false;
    if (canManageAts(session)) return true;
    if (isAssignedHiringManager(session, job)) return true;
    if (interview) return isAssignedInterviewer(session, [interview]);
    return isAssignedHiringManager(session, job);
  }

  function validateJobPayload(payload, isCreate) {
    payload = payload || {};
    var errors = {};
    var title = trim_(payload.title);
    if (!title) errors.title = 'Job title is required.';
    else if (title.length > ATS.LIMITS.NAME_MAX) errors.title = 'Title is too long.';

    var openings = Number(payload.openings);
    if (payload.openings === '' || payload.openings === null || payload.openings === undefined) {
      if (isCreate) openings = 1;
    }
    if (!isFinite(openings) || openings < 1 || openings > 99) {
      errors.openings = 'Openings must be a number from 1 to 99.';
    }

    var empType = upper_(payload.employment_type);
    if (empType && ATS.EMPLOYMENT_TYPES.indexOf(empType) < 0) {
      errors.employment_type = 'Choose a valid employment type.';
    }

    var close = trim_(payload.closing_date);
    if (close && !/^\d{4}-\d{2}-\d{2}$/.test(close.substring(0, 10))) {
      errors.closing_date = 'Closing date must be YYYY-MM-DD.';
    }

    ['description', 'responsibilities', 'requirements'].forEach(function (key) {
      if (trim_(payload[key]).length > ATS.LIMITS.TEXT_MAX) {
        errors[key] = 'Keep this field under ' + ATS.LIMITS.TEXT_MAX + ' characters.';
      }
    });
    if (trim_(payload.skills).length > ATS.LIMITS.SKILLS_MAX) {
      errors.skills = 'Skills must be ' + ATS.LIMITS.SKILLS_MAX + ' characters or fewer.';
    }

    if (payload.employee_id) {
      errors.employee_id = 'Jobs must not set employee_id.';
    }

    return { ok: Object.keys(errors).length === 0, errors: errors, openings: isFinite(openings) && openings >= 1 ? Math.floor(openings) : 1 };
  }

  function validatePublicApplyPayload(payload) {
    payload = payload || {};
    var errors = {};
    var name = trim_(payload.full_name || payload.name);
    if (!name) errors.full_name = 'Name is required.';
    else if (name.length > ATS.LIMITS.NAME_MAX) errors.full_name = 'Name is too long.';

    var email = normalizeEmail_(payload.email);
    if (!email) errors.email = 'Email is required.';
    else if (!isValidEmail_(email)) errors.email = 'Enter a valid email address.';

    var phone = trim_(payload.phone).replace(/[^\d+]/g, '');
    var digits = phone.replace(/\D/g, '');
    if (!digits) errors.phone = 'Phone is required.';
    else if (digits.length < ATS.LIMITS.PHONE_MIN || digits.length > ATS.LIMITS.PHONE_MAX) {
      errors.phone = 'Enter a valid phone number.';
    }

    if (trim_(payload.cover_letter).length > ATS.LIMITS.TEXT_MAX) {
      errors.cover_letter = 'Cover letter is too long.';
    }
    if (trim_(payload.skills).length > ATS.LIMITS.SKILLS_MAX) {
      errors.skills = 'Skills is too long.';
    }

    var slug = trim_(payload.public_slug || payload.job_slug || payload.slug);
    if (!slug) errors.public_slug = 'Job link is missing.';

    return {
      ok: Object.keys(errors).length === 0,
      errors: errors,
      full_name: name,
      email: email,
      phone: trim_(payload.phone)
    };
  }

  function validateInterviewPayload(payload) {
    payload = payload || {};
    var errors = {};
    var rating = payload.rating === '' || payload.rating === null || payload.rating === undefined
      ? ''
      : Number(payload.rating);
    if (rating !== '') {
      if (!isFinite(rating) || rating < 1 || rating > 5) {
        errors.rating = 'Rating must be 1 to 5.';
      } else {
        rating = Math.round(rating);
      }
    }
    var rec = upper_(payload.recommendation);
    if (rec && !ATS.RECOMMENDATION[rec]) {
      errors.recommendation = 'Choose a valid recommendation.';
    }
    if (trim_(payload.notes).length > ATS.LIMITS.TEXT_MAX) {
      errors.notes = 'Notes are too long.';
    }
    return { ok: Object.keys(errors).length === 0, errors: errors, rating: rating, recommendation: rec };
  }

  function allowedResumeMime(mime, fileName) {
    var m = trim_(mime).toLowerCase();
    var name = trim_(fileName).toLowerCase();
    if (m === 'application/pdf' || name.slice(-4) === '.pdf') return true;
    if (m === 'application/msword' || name.slice(-4) === '.doc') return true;
    if (m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || name.slice(-5) === '.docx') return true;
    return false;
  }

  function computeKpis(jobs, applications, interviews) {
    jobs = jobs || [];
    applications = applications || [];
    interviews = interviews || [];
    var pipeline = {};
    ATS.DEFAULT_PIPELINE.concat(ATS.TERMINAL_EXTRA).forEach(function (s) {
      pipeline[s] = 0;
    });
    applications.forEach(function (a) {
      var s = upper_(a.stage) || ATS.STAGE.APPLIED;
      pipeline[s] = (pipeline[s] || 0) + 1;
    });
    var openJobs = 0;
    jobs.forEach(function (j) {
      var st = upper_(j.status);
      if (st === ATS.JOB_STATUS.PUBLISHED || st === ATS.JOB_STATUS.PAUSED) openJobs++;
    });
    return {
      open_jobs: openJobs,
      applications: applications.length,
      screening: pipeline[ATS.STAGE.SCREENING] || 0,
      interviews: pipeline[ATS.STAGE.INTERVIEW] || 0,
      interview_events: interviews.length,
      offers: pipeline[ATS.STAGE.OFFER] || 0,
      hires: pipeline[ATS.STAGE.HIRED] || 0,
      rejections: pipeline[ATS.STAGE.REJECTED] || 0,
      withdrawn: pipeline[ATS.STAGE.WITHDRAWN] || 0,
      pipeline: pipeline
    };
  }

  function sharePack(job, webAppUrl) {
    job = job || {};
    var base = trim_(webAppUrl).replace(/\/+$/, '');
    var slug = trim_(job.public_slug);
    var applyUrl = base && slug ? (base + '?ats=apply&job=' + encodeURIComponent(slug)) : '';
    var title = trim_(job.title) || 'Open role';
    var dept = trim_(job.department);
    var loc = trim_(job.location);
    var bits = [title];
    if (dept) bits.push(dept);
    if (loc) bits.push(loc);
    var shareText = bits.join(' · ') + (applyUrl ? ('\nApply: ' + applyUrl) : '');
    return {
      apply_url: applyUrl,
      copy_text: shareText,
      channels: ATS.SHARE_CHANNELS.map(function (ch) {
        return {
          id: ch.id,
          label: ch.label,
          enabled: !!ch.enabled,
          provider: ch.provider
        };
      }),
      external_ref_json: trim_(job.external_ref_json) || '{}'
    };
  }

  function newPublicSlug(randomSource) {
    var src = randomSource || Math.random;
    var alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    var out = '';
    var i;
    if (typeof src === 'function' && src.length === 0) {
      for (i = 0; i < ATS.LIMITS.SLUG_LEN; i++) {
        out += alphabet.charAt(Math.floor(src() * alphabet.length));
      }
      return out;
    }
    var raw = trim_(randomSource).replace(/-/g, '').toLowerCase();
    if (raw.length >= ATS.LIMITS.SLUG_LEN) return raw.substring(0, ATS.LIMITS.SLUG_LEN);
    out = raw;
    while (out.length < ATS.LIMITS.SLUG_LEN) {
      out += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    return out.substring(0, ATS.LIMITS.SLUG_LEN);
  }

  function candidateRecordMustNotBeEmployee(record) {
    record = record || {};
    if (record.employee_id && trim_(record.employee_id) && !trim_(record.hired_employee_id)) {
      return false;
    }
    if (isEmployeeIdShape_(record.candidate_id)) return false;
    return true;
  }

  return {
    upper: upper_,
    trim: trim_,
    normalizeEmail: normalizeEmail_,
    isValidEmail: isValidEmail_,
    formatAtsId: formatAtsId,
    isCandidateId: isCandidateId,
    isJobId: isJobId,
    defaultPipeline: defaultPipeline,
    parsePipeline: parsePipeline,
    happyPath: happyPath,
    isKnownStage: isKnownStage,
    isTerminalExtra: isTerminalExtra,
    canTransitionJob: canTransitionJob,
    jobActionForTransition: jobActionForTransition,
    isJobAcceptingApplications: isJobAcceptingApplications,
    isPubliclyVisibleJob: isPubliclyVisibleJob,
    publicJobView: publicJobView,
    assertPublicJobSafe: assertPublicJobSafe,
    findDuplicateApplication: findDuplicateApplication,
    canMoveStage: canMoveStage,
    canAccessAts: canAccessAts,
    canManageAts: canManageAts,
    isManager: isManager,
    isAssignedHiringManager: isAssignedHiringManager,
    isAssignedInterviewer: isAssignedInterviewer,
    canAccessJob: canAccessJob,
    canAccessCandidate: canAccessCandidate,
    canDownloadResume: canDownloadResume,
    canWriteInterview: canWriteInterview,
    validateJobPayload: validateJobPayload,
    validatePublicApplyPayload: validatePublicApplyPayload,
    validateInterviewPayload: validateInterviewPayload,
    allowedResumeMime: allowedResumeMime,
    computeKpis: computeKpis,
    sharePack: sharePack,
    newPublicSlug: newPublicSlug,
    candidateRecordMustNotBeEmployee: candidateRecordMustNotBeEmployee
  };
})();
