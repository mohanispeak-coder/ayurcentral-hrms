/**
 * ATS business service — requisitions, candidates, pipeline, interviews.
 * Does not create Employees or Users. Public apply is unauthenticated by design.
 */
var ATS = ATS || {};

var AtsService = (function () {
  function trim_(v) {
    return AtsEngine.trim(v);
  }

  function now_() {
    return new Date();
  }

  function tzToday_() {
    try {
      return Utilities.formatDate(new Date(), ConfigService.getTimezone(), 'yyyy-MM-dd');
    } catch (e) {
      return Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
    }
  }

  function toIso_(value) {
    if (value === null || value === undefined || value === '') return '';
    if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
      return value.toISOString();
    }
    var d = new Date(value);
    if (!isNaN(d.getTime())) return d.toISOString();
    return String(value);
  }

  function toIsoDate_(value) {
    if (value === null || value === undefined || value === '') return '';
    if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
      try {
        return Utilities.formatDate(value, ConfigService.getTimezone(), 'yyyy-MM-dd');
      } catch (e) {
        return Utilities.formatDate(value, 'Asia/Kolkata', 'yyyy-MM-dd');
      }
    }
    var s = String(value);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
    var d = new Date(value);
    if (!isNaN(d.getTime())) return toIsoDate_(d);
    return s;
  }

  function withJobDates_(job) {
    if (!job) return job;
    var copy = {};
    Object.keys(job).forEach(function (k) { copy[k] = job[k]; });
    copy.closing_date = toIsoDate_(job.closing_date);
    copy.status = String(job.status || '');
    return copy;
  }

  function pipeline_() {
    var raw = '';
    try {
      raw = ConfigService.getSetting(ATS.SETTINGS.PIPELINE, '');
    } catch (ignore) {}
    return AtsEngine.parsePipeline(raw);
  }

  function applyEnabled_() {
    try {
      var v = ConfigService.getSetting(ATS.SETTINGS.APPLY_ENABLED, true);
      if (v === false || v === 0 || String(v).toLowerCase() === 'false') return false;
      return true;
    } catch (e) {
      return true;
    }
  }

  function fireAtsNotify_(fn) {
    try {
      if (typeof NotificationAtsAdapter === 'undefined') return;
      fn();
    } catch (e) {
      Logger.log('ATS notify: ' + (e.message || e));
    }
  }

  function atsInternalRecipients_(job) {
    var list = [];
    var seen = {};
    function add(rec) {
      if (!rec) return;
      var key = rec.employee_id || rec.email;
      if (!key || seen[key]) return;
      seen[key] = true;
      list.push(rec);
    }
    if (typeof NotificationService !== 'undefined' && NotificationService.listHrAdminRecipients) {
      (NotificationService.listHrAdminRecipients() || []).forEach(add);
    }
    if (job && job.hiring_manager_employee_id && typeof NotificationService !== 'undefined' && NotificationService.resolveRecipient) {
      add(NotificationService.resolveRecipient({ employee_id: job.hiring_manager_employee_id }));
    }
    return list;
  }

  function resumeMaxBytes_() {
    try {
      var n = Number(ConfigService.getSetting(ATS.SETTINGS.RESUME_MAX, ATS.LIMITS.RESUME_MAX_BYTES));
      return n > 0 ? n : ATS.LIMITS.RESUME_MAX_BYTES;
    } catch (e) {
      return ATS.LIMITS.RESUME_MAX_BYTES;
    }
  }

  function nextId_(seqKey, prefix) {
    var seq = DbService.nextSequenceAssumingLocked(seqKey);
    return AtsEngine.formatAtsId(prefix, seq, ATS.LIMITS.ID_PAD);
  }

  function webAppUrl_() {
    try {
      return ScriptApp.getService().getUrl() || '';
    } catch (e) {
      return '';
    }
  }

  function actorEmail_(session) {
    if (session && session.email) return String(session.email).toLowerCase();
    return 'system';
  }

  function audit_(action, entityType, entityId, summary, employeeIdScope) {
    try {
      if (typeof AuditService !== 'undefined' && AuditService.log) {
        AuditService.log(action, entityType, entityId, summary, employeeIdScope || '');
      }
    } catch (ignore) {}
  }

  function activity_(candidateId, applicationId, jobId, actorEmail, action, summary) {
    var row = {
      activity_id: '',
      candidate_id: candidateId || '',
      application_id: applicationId || '',
      job_id: jobId || '',
      actor_email: actorEmail || '',
      action: action || '',
      summary: String(summary || '').substring(0, 500),
      created_at: now_()
    };
    withScriptLock_(function () {
      row.activity_id = nextId_(ATS.SEQ.ACTIVITY, ATS.ID_PREFIX.ACT);
      AtsRepository.insertActivity(row);
    });
    return row;
  }

  function hiringManagerName_(employeeId) {
    var id = trim_(employeeId);
    if (!id) return '';
    try {
      if (typeof EmployeeRepository !== 'undefined' && EmployeeRepository.findById) {
        var emp = EmployeeRepository.findById(id);
        if (emp) return trim_(emp.display_name) || trim_(emp.first_name + ' ' + emp.last_name);
      }
    } catch (ignore) {}
    return '';
  }

  function jobFromPayload_(payload, existing) {
    existing = existing || {};
    var v = AtsEngine.validateJobPayload(payload, !existing.job_id);
    if (!v.ok) throw validationError_('Please correct the highlighted fields.', v.errors);
    var empType = AtsEngine.upper(payload.employment_type) || existing.employment_type || 'PERMANENT';
    return {
      title: trim_(payload.title),
      department: trim_(payload.department),
      location: trim_(payload.location),
      employment_type: empType,
      experience: trim_(payload.experience),
      education: trim_(payload.education),
      salary_range: trim_(payload.salary_range),
      description: trim_(payload.description),
      responsibilities: trim_(payload.responsibilities),
      requirements: trim_(payload.requirements),
      skills: trim_(payload.skills),
      openings: v.openings,
      hiring_manager_employee_id: trim_(payload.hiring_manager_employee_id),
      hiring_manager_name: trim_(payload.hiring_manager_name) || hiringManagerName_(payload.hiring_manager_employee_id),
      closing_date: trim_(payload.closing_date).substring(0, 10),
      notes_internal: trim_(payload.notes_internal),
      external_ref_json: trim_(payload.external_ref_json) || existing.external_ref_json || '{}'
    };
  }

  function sanitizeJob_(job, session) {
    if (!job) return null;
    var out = {
      job_id: job.job_id,
      public_slug: job.public_slug,
      title: job.title,
      department: job.department,
      location: job.location,
      employment_type: job.employment_type,
      experience: job.experience,
      education: job.education,
      salary_range: job.salary_range,
      description: job.description,
      responsibilities: job.responsibilities,
      requirements: job.requirements,
      skills: job.skills,
      openings: Number(job.openings) || 1,
      hiring_manager_employee_id: job.hiring_manager_employee_id,
      hiring_manager_name: job.hiring_manager_name,
      status: AtsEngine.upper(job.status),
      closing_date: toIsoDate_(job.closing_date),
      published_at: toIso_(job.published_at),
      paused_at: toIso_(job.paused_at),
      closed_at: toIso_(job.closed_at),
      created_at: toIso_(job.created_at),
      created_by_email: job.created_by_email,
      updated_at: toIso_(job.updated_at),
      share: AtsEngine.sharePack(job, webAppUrl_())
    };
    if (AtsEngine.canManageAts(session)) {
      out.notes_internal = job.notes_internal || '';
      out.external_ref_json = job.external_ref_json || '{}';
      out.updated_by_email = job.updated_by_email || '';
    }
    return out;
  }

  function sanitizeCandidate_(row) {
    if (!row) return null;
    return {
      candidate_id: row.candidate_id,
      full_name: row.full_name,
      email: row.email,
      phone: row.phone,
      location: row.location,
      education: row.education,
      experience_summary: row.experience_summary,
      skills: row.skills,
      source: row.source,
      has_resume: !!trim_(row.resume_drive_file_id),
      resume_file_name: row.resume_file_name || '',
      hired_employee_id: row.hired_employee_id || '',
      created_at: toIso_(row.created_at),
      updated_at: toIso_(row.updated_at)
    };
  }

  function sanitizeApplication_(row, job) {
    if (!row) return null;
    return {
      application_id: row.application_id,
      job_id: row.job_id,
      candidate_id: row.candidate_id,
      stage: AtsEngine.upper(row.stage),
      cover_letter: row.cover_letter || '',
      source: row.source || '',
      applied_at: toIso_(row.applied_at),
      updated_at: toIso_(row.updated_at),
      job_title: job ? job.title : '',
      job_status: job ? job.status : ''
    };
  }

  function sanitizeInterview_(row) {
    if (!row) return null;
    return {
      interview_id: row.interview_id,
      application_id: row.application_id,
      candidate_id: row.candidate_id,
      job_id: row.job_id,
      stage: row.stage,
      scheduled_at: toIso_(row.scheduled_at),
      interviewer_employee_id: row.interviewer_employee_id,
      interviewer_name: row.interviewer_name,
      interviewer_email: row.interviewer_email,
      notes: row.notes || '',
      rating: row.rating === '' || row.rating === null || row.rating === undefined ? '' : Number(row.rating),
      recommendation: row.recommendation || '',
      created_at: toIso_(row.created_at),
      created_by_email: row.created_by_email
    };
  }

  function jobsForManager_(session, jobs, interviews) {
    interviews = interviews || [];
    return (jobs || []).filter(function (job) {
      var related = interviews.filter(function (iv) { return trim_(iv.job_id) === trim_(job.job_id); });
      return AtsEngine.canAccessJob(session, job, related);
    });
  }

  function scopedJobs_(session) {
    var jobs = AtsRepository.listJobs();
    if (AtsEngine.canManageAts(session)) return jobs;
    var interviews = AtsRepository.safeAll(ATS.SHEETS.INTERVIEWS) || [];
    return jobsForManager_(session, jobs, interviews);
  }

  function ensureManageSchema_(session) {
    AtsPermissionService.requireManage(session);
    return AtsSchemaService.ensureSheets();
  }

  function getBootstrap(session) {
    var s = AtsPermissionService.requireAccess(session);
    var ready = AtsSchemaService.sheetsExist();
    var dashboard = null;
    if (ready) {
      try {
        dashboard = getDashboard(s);
      } catch (ignoreDash) {
        dashboard = null;
      }
    }
    return {
      role: s.role,
      can_manage: AtsEngine.canManageAts(s),
      can_setup: AtsEngine.canManageAts(s),
      schema_ready: ready,
      pipeline: pipeline_(),
      employment_types: ATS.EMPLOYMENT_TYPES.slice(),
      sources: ATS.SOURCES.slice(),
      recommendations: Object.keys(ATS.RECOMMENDATION),
      nav: AtsPermissionService.navItemsForRole(s.role),
      share_channels: ATS.SHARE_CHANNELS,
      dashboard: dashboard
    };
  }

  function ensureSchema(session) {
    var result = ensureManageSchema_(session);
    audit_(ATS.AUDIT.SETUP, 'AtsSchema', result.spreadsheetId, 'ATS sheets verified');
    return result;
  }

  function getDashboard(session) {
    AtsPermissionService.requireAccess(session);
    var jobs = scopedJobs_(session);
    var jobIds = {};
    jobs.forEach(function (j) { jobIds[j.job_id] = true; });
    var applications = AtsRepository.listApplications().filter(function (a) {
      return jobIds[a.job_id];
    });
    var interviews = (AtsRepository.safeAll(ATS.SHEETS.INTERVIEWS) || []).filter(function (iv) {
      return jobIds[iv.job_id];
    });
    var kpis = AtsEngine.computeKpis(jobs, applications, interviews);
    kpis.pipeline_stages = pipeline_();
    return kpis;
  }

  function listJobs(session, query) {
    AtsPermissionService.requireAccess(session);
    query = query || {};
    var q = trim_(query.q).toLowerCase();
    var status = AtsEngine.upper(query.status);
    var rows = scopedJobs_(session).filter(function (job) {
      if (status && AtsEngine.upper(job.status) !== status) return false;
      if (!q) return true;
      var hay = [job.job_id, job.title, job.department, job.location, job.hiring_manager_name].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
    rows.sort(function (a, b) {
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });
    var counts = {};
    try {
      AtsRepository.listApplications().forEach(function (a) {
        counts[a.job_id] = (counts[a.job_id] || 0) + 1;
      });
    } catch (ignore) {}
    return rows.map(function (job) {
      var view = sanitizeJob_(job, session);
      view.application_count = counts[job.job_id] || 0;
      return view;
    });
  }

  function getJob(session, jobId) {
    AtsPermissionService.requireAccess(session);
    var job = AtsRepository.findJob(jobId);
    if (!job) throw notFoundError_('Job requisition not found.');
    var interviews = AtsRepository.safeAll(ATS.SHEETS.INTERVIEWS) || [];
    var relatedIv = interviews.filter(function (iv) { return trim_(iv.job_id) === trim_(job.job_id); });
    AtsPermissionService.requireJob(session, job, relatedIv);
    var applications = AtsRepository.applicationsForJob(job.job_id);
    var candidatesById = {};
    applications.forEach(function (app) {
      if (!candidatesById[app.candidate_id]) {
        candidatesById[app.candidate_id] = AtsRepository.findCandidate(app.candidate_id);
      }
    });
    var hired = applications.filter(function (a) {
      return AtsEngine.upper(a.stage) === ATS.STAGE.HIRED;
    }).length;
    return {
      job: sanitizeJob_(job, session),
      pipeline: pipeline_(),
      hired_count: hired,
      applications: applications.map(function (app) {
        var view = sanitizeApplication_(app, job);
        var cand = candidatesById[app.candidate_id];
        view.candidate_name = cand ? cand.full_name : '';
        view.candidate_email = cand ? cand.email : '';
        return view;
      })
    };
  }

  function createJob(session, payload) {
    AtsPermissionService.requireManage(session);
    AtsSchemaService.ensureSheets();
    var fields = jobFromPayload_(payload, null);
    var now = now_();
    var record;
    withScriptLock_(function () {
      record = {
        job_id: nextId_(ATS.SEQ.JOB, ATS.ID_PREFIX.JOB),
        public_slug: '',
        status: ATS.JOB_STATUS.DRAFT,
        published_at: '',
        paused_at: '',
        closed_at: '',
        created_at: now,
        created_by_email: actorEmail_(session),
        updated_at: now,
        updated_by_email: actorEmail_(session)
      };
      Object.keys(fields).forEach(function (k) { record[k] = fields[k]; });
      AtsRepository.insertJob(record);
    });
    audit_(ATS.AUDIT.JOB_CREATE, 'JobRequisition', record.job_id, 'Created job "' + record.title + '"');
    return { job: sanitizeJob_(record, session) };
  }

  function updateJob(session, jobId, payload) {
    AtsPermissionService.requireManage(session);
    var job = AtsRepository.findJob(jobId);
    if (!job) throw notFoundError_('Job requisition not found.');
    if (AtsEngine.upper(job.status) === ATS.JOB_STATUS.CLOSED) {
      throw conflictError_('Closed jobs cannot be edited. Reopen first if needed.');
    }
    var fields = jobFromPayload_(payload, job);
    fields.updated_at = now_();
    fields.updated_by_email = actorEmail_(session);
    var updated = AtsRepository.updateJob(job.job_id, fields);
    audit_(ATS.AUDIT.JOB_UPDATE, 'JobRequisition', job.job_id, 'Updated job "' + fields.title + '"');
    return { job: sanitizeJob_(updated, session) };
  }

  function transitionJob(session, jobId, toStatus) {
    AtsPermissionService.requireManage(session);
    var job = AtsRepository.findJob(jobId);
    if (!job) throw notFoundError_('Job requisition not found.');
    var target = AtsEngine.upper(toStatus);
    var allowReopen = AtsEngine.canManageAts(session);
    if (!AtsEngine.canTransitionJob(job.status, target, { allowReopen: allowReopen })) {
      throw conflictError_('Cannot change job status from ' + job.status + ' to ' + target + '.');
    }
    var now = now_();
    var updates = {
      status: target,
      updated_at: now,
      updated_by_email: actorEmail_(session)
    };
    if (target === ATS.JOB_STATUS.PUBLISHED) {
      updates.published_at = now;
      if (!trim_(job.public_slug)) {
        var uuid = '';
        try { uuid = Utilities.getUuid(); } catch (ignore) {}
        updates.public_slug = AtsEngine.newPublicSlug(uuid || Math.random);
      }
    }
    if (target === ATS.JOB_STATUS.PAUSED) updates.paused_at = now;
    if (target === ATS.JOB_STATUS.CLOSED) updates.closed_at = now;
    var updated = AtsRepository.updateJob(job.job_id, updates);
    var action = AtsEngine.jobActionForTransition(job.status, target);
    audit_(action, 'JobRequisition', job.job_id, 'Job ' + job.job_id + ' ' + job.status + ' → ' + target);
    return { job: sanitizeJob_(updated, session) };
  }

  function getSharePack(session, jobId) {
    var detail = getJob(session, jobId);
    return detail.job.share;
  }

  function listHiringManagers(session) {
    AtsPermissionService.requireManage(session);
    try {
      if (typeof EmployeeService !== 'undefined' && EmployeeService.listPicker) {
        return EmployeeService.listPicker(session);
      }
    } catch (e) {
      if (e && e.hrmsCode === HRMS.ERROR_CODES.AUTHORIZATION) throw e;
    }
    return [];
  }

  function listCandidates(session, query) {
    AtsPermissionService.requireAccess(session);
    query = query || {};
    var q = trim_(query.q).toLowerCase();
    var jobs = scopedJobs_(session);
    var jobIds = {};
    jobs.forEach(function (j) { jobIds[j.job_id] = true; });
    var applications = AtsRepository.listApplications();
    var allowedCandidates = {};
    if (AtsEngine.canManageAts(session)) {
      AtsRepository.listCandidates().forEach(function (c) {
        allowedCandidates[c.candidate_id] = true;
      });
    } else {
      applications.forEach(function (a) {
        if (jobIds[a.job_id]) allowedCandidates[a.candidate_id] = true;
      });
    }
    var rows = AtsRepository.listCandidates().filter(function (c) {
      if (!allowedCandidates[c.candidate_id]) return false;
      if (!q) return true;
      var hay = [c.candidate_id, c.full_name, c.email, c.phone, c.skills, c.location].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
    rows.sort(function (a, b) {
      return new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0);
    });
    return rows.map(function (c) {
      var view = sanitizeCandidate_(c);
      view.application_count = applications.filter(function (a) {
        return a.candidate_id === c.candidate_id;
      }).length;
      return view;
    });
  }

  function jobsForCandidate_(candidateId) {
    var apps = AtsRepository.applicationsForCandidate(candidateId);
    var jobs = [];
    var seen = {};
    apps.forEach(function (a) {
      if (seen[a.job_id]) return;
      seen[a.job_id] = true;
      var job = AtsRepository.findJob(a.job_id);
      if (job) jobs.push(job);
    });
    return { applications: apps, jobs: jobs };
  }

  function getCandidate(session, candidateId) {
    AtsPermissionService.requireAccess(session);
    var candidate = AtsRepository.findCandidate(candidateId);
    if (!candidate) throw notFoundError_('Candidate not found.');
    var packed = jobsForCandidate_(candidate.candidate_id);
    var interviews = AtsRepository.interviewsForCandidate(candidate.candidate_id);
    AtsPermissionService.requireCandidate(session, packed.jobs, interviews);
    var activity = AtsRepository.activityForCandidate(candidate.candidate_id);
    return {
      candidate: sanitizeCandidate_(candidate),
      applications: packed.applications.map(function (app) {
        var job = AtsRepository.findJob(app.job_id);
        return sanitizeApplication_(app, job);
      }),
      interviews: interviews.map(sanitizeInterview_),
      activity: activity.map(function (row) {
        return {
          activity_id: row.activity_id,
          action: row.action,
          summary: row.summary,
          actor_email: row.actor_email,
          created_at: toIso_(row.created_at),
          application_id: row.application_id,
          job_id: row.job_id
        };
      }),
      pipeline: pipeline_()
    };
  }

  function addComment(session, candidateId, payload) {
    AtsPermissionService.requireAccess(session);
    var candidate = AtsRepository.findCandidate(candidateId);
    if (!candidate) throw notFoundError_('Candidate not found.');
    var packed = jobsForCandidate_(candidate.candidate_id);
    var interviews = AtsRepository.interviewsForCandidate(candidate.candidate_id);
    AtsPermissionService.requireCandidate(session, packed.jobs, interviews);
    var body = trim_(payload && payload.body);
    if (!body) throw validationError_('Comment is required.');
    if (body.length > ATS.LIMITS.TEXT_MAX) throw validationError_('Comment is too long.');
    var appId = trim_(payload && payload.application_id);
    var jobId = trim_(payload && payload.job_id);
    activity_(candidate.candidate_id, appId, jobId, actorEmail_(session), 'COMMENT', body);
    audit_(ATS.AUDIT.COMMENT, 'Candidate', candidate.candidate_id, 'Comment added');
    return getCandidate(session, candidate.candidate_id);
  }

  function moveStage(session, applicationId, toStage, comment) {
    AtsPermissionService.requireAccess(session);
    var app = AtsRepository.findApplication(applicationId);
    if (!app) throw notFoundError_('Application not found.');
    var job = AtsRepository.findJob(app.job_id);
    if (!job) throw notFoundError_('Job requisition not found.');
    var interviews = AtsRepository.interviewsForApplication(app.application_id);
    AtsPermissionService.requireJob(session, job, interviews);
    if (AtsEngine.isManager(session) && !AtsEngine.canManageAts(session)) {
      var mgrTarget = AtsEngine.upper(toStage);
      var mgrAllowed = [ATS.STAGE.SCREENING, ATS.STAGE.SHORTLISTED, ATS.STAGE.INTERVIEW, ATS.STAGE.REJECTED];
      if (mgrAllowed.indexOf(mgrTarget) < 0) {
        throw authorizationError_('Managers can screen, shortlist, interview, or reject. HR moves later stages.');
      }
    }
    var options = {
      allowBackward: AtsEngine.canManageAts(session),
      allowReopenRejected: AtsEngine.canManageAts(session),
      allowReopenWithdrawn: AtsEngine.canManageAts(session)
    };
    if (!AtsEngine.canMoveStage(app.stage, toStage, pipeline_(), options)) {
      throw conflictError_('Cannot move application from ' + app.stage + ' to ' + AtsEngine.upper(toStage) + '.');
    }
    var target = AtsEngine.upper(toStage);
    var now = now_();
    var updated = AtsRepository.updateApplication(app.application_id, {
      stage: target,
      updated_at: now,
      stage_changed_at: now,
      stage_changed_by_email: actorEmail_(session)
    });
    var note = 'Stage ' + app.stage + ' → ' + target;
    if (trim_(comment)) note += '. ' + trim_(comment).substring(0, 200);
    activity_(app.candidate_id, app.application_id, app.job_id, actorEmail_(session), 'STAGE', note);
    audit_(ATS.AUDIT.STAGE, 'Application', app.application_id, note);
    fireAtsNotify_(function () {
      var packed = {
        application_id: updated.application_id,
        job_id: job.job_id,
        candidate_id: app.candidate_id,
        title: job.title
      };
      var recips = atsInternalRecipients_(job);
      if (target === ATS.STAGE.SHORTLISTED) {
        NotificationAtsAdapter.notifyShortlisted(packed, recips);
      } else if (target === ATS.STAGE.SELECTED) {
        NotificationAtsAdapter.notifySelected(packed, recips);
      }
    });
    return { application: sanitizeApplication_(updated, job), pipeline: pipeline_() };
  }

  function scheduleInterview(session, payload) {
    AtsPermissionService.requireAccess(session);
    payload = payload || {};
    var app = AtsRepository.findApplication(payload.application_id);
    if (!app) throw notFoundError_('Application not found.');
    var job = AtsRepository.findJob(app.job_id);
    if (!job) throw notFoundError_('Job requisition not found.');
    var existingIv = AtsRepository.interviewsForApplication(app.application_id);
    AtsPermissionService.requireJob(session, job, existingIv);
    var v = AtsEngine.validateInterviewPayload(payload);
    if (!v.ok) throw validationError_('Please correct the interview fields.', v.errors);
    var now = now_();
    var record;
    withScriptLock_(function () {
      record = {
        interview_id: nextId_(ATS.SEQ.INTERVIEW, ATS.ID_PREFIX.INT),
        application_id: app.application_id,
        candidate_id: app.candidate_id,
        job_id: app.job_id,
        stage: trim_(payload.stage) || ATS.STAGE.INTERVIEW,
        scheduled_at: payload.scheduled_at ? new Date(payload.scheduled_at) : now,
        interviewer_employee_id: trim_(payload.interviewer_employee_id) || session.employee_id || '',
        interviewer_name: trim_(payload.interviewer_name) || session.displayName || '',
        interviewer_email: trim_(payload.interviewer_email) || actorEmail_(session),
        notes: trim_(payload.notes),
        rating: v.rating,
        recommendation: v.recommendation,
        created_at: now,
        created_by_email: actorEmail_(session),
        updated_at: now
      };
      AtsRepository.insertInterview(record);
    });
    if (AtsEngine.upper(app.stage) === ATS.STAGE.SHORTLISTED || AtsEngine.upper(app.stage) === ATS.STAGE.SCREENING) {
      try {
        moveStage(session, app.application_id, ATS.STAGE.INTERVIEW, '');
      } catch (ignore) {}
    }
    activity_(app.candidate_id, app.application_id, app.job_id, actorEmail_(session), 'INTERVIEW',
      'Interview scheduled' + (record.interviewer_name ? (' with ' + record.interviewer_name) : ''));
    audit_(ATS.AUDIT.INTERVIEW, 'Interview', record.interview_id, 'Interview scheduled');
    fireAtsNotify_(function () {
      var packed = {
        application_id: app.application_id,
        job_id: job.job_id,
        candidate_id: app.candidate_id,
        title: job.title
      };
      var recips = atsInternalRecipients_(job);
      if (record.interviewer_employee_id && typeof NotificationService !== 'undefined') {
        recips = recips.concat([NotificationService.resolveRecipient({ employee_id: record.interviewer_employee_id })]);
      }
      NotificationAtsAdapter.notifyInterviewScheduled(packed, recips);
      NotificationAtsAdapter.notifyFeedbackPending(packed, recips);
      var cand = AtsRepository.findCandidate(app.candidate_id);
      if (cand) {
        NotificationAtsAdapter.notifyCandidate('ATS_CANDIDATE_INTERVIEW', cand, {
          interview_at: record.scheduled_at
        });
      }
    });
    return { interview: sanitizeInterview_(record) };
  }

  function updateInterview(session, interviewId, payload) {
    AtsPermissionService.requireAccess(session);
    var interview = AtsRepository.findInterview(interviewId);
    if (!interview) throw notFoundError_('Interview not found.');
    var job = AtsRepository.findJob(interview.job_id);
    AtsPermissionService.requireJob(session, job, [interview]);
    if (!AtsEngine.canWriteInterview(session, job, interview)) {
      throw authorizationError_('You cannot update this interview.');
    }
    var v = AtsEngine.validateInterviewPayload(payload || {});
    if (!v.ok) throw validationError_('Please correct the interview fields.', v.errors);
    var updates = {
      notes: payload.notes !== undefined ? trim_(payload.notes) : interview.notes,
      rating: payload.rating !== undefined ? v.rating : interview.rating,
      recommendation: payload.recommendation !== undefined ? v.recommendation : interview.recommendation,
      updated_at: now_()
    };
    if (payload.scheduled_at) updates.scheduled_at = new Date(payload.scheduled_at);
    if (payload.interviewer_name) updates.interviewer_name = trim_(payload.interviewer_name);
    if (payload.interviewer_employee_id) updates.interviewer_employee_id = trim_(payload.interviewer_employee_id);
    if (payload.interviewer_email) updates.interviewer_email = trim_(payload.interviewer_email);
    var updated = AtsRepository.updateInterview(interview.interview_id, updates);
    activity_(interview.candidate_id, interview.application_id, interview.job_id, actorEmail_(session),
      'INTERVIEW', 'Interview feedback updated');
    audit_(ATS.AUDIT.INTERVIEW, 'Interview', interview.interview_id, 'Interview feedback updated');
    return { interview: sanitizeInterview_(updated) };
  }

  function downloadResume(session, candidateId) {
    AtsPermissionService.requireAccess(session);
    var candidate = AtsRepository.findCandidate(candidateId);
    if (!candidate) throw notFoundError_('Candidate not found.');
    var packed = jobsForCandidate_(candidate.candidate_id);
    var interviews = AtsRepository.interviewsForCandidate(candidate.candidate_id);
    var job = packed.jobs[0] || null;
    AtsPermissionService.requireResume(session, job, interviews);
    if (!trim_(candidate.resume_drive_file_id)) {
      throw notFoundError_('No resume is on file for this candidate.');
    }
    audit_(ATS.AUDIT.RESUME, 'Candidate', candidate.candidate_id, 'Resume downloaded');
    var file = AtsDriveService.downloadResume(candidate.resume_drive_file_id);
    return {
      fileName: candidate.resume_file_name || file.fileName,
      mimeType: candidate.resume_mime_type || file.mimeType,
      base64: file.base64
    };
  }

  function publicNotFound_() {
    throw notFoundError_('This job is not available.');
  }

  function publicCareersUnavailable_() {
    throw conflictError_('Careers are not available right now. Please try again later.');
  }

  function sanitizePublicView_(view) {
    if (!view) return view;
    var out = {};
    Object.keys(view).forEach(function (key) {
      var value = view[key];
      if (value === null || value === undefined) {
        out[key] = '';
      } else if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
        out[key] = toIso_(value);
      } else if (typeof value === 'boolean' || typeof value === 'number') {
        out[key] = value;
      } else {
        out[key] = String(value);
      }
    });
    return out;
  }

  function listPublicJobs() {
    var rows = AtsRepository.safeAll(ATS.SHEETS.JOBS);
    if (!rows) return { jobs: [], company_name: companyName_() };
    var today = tzToday_();
    var jobs = rows.filter(function (job) {
      return AtsEngine.isJobAcceptingApplications(withJobDates_(job), today);
    }).map(function (job) {
      var view = AtsEngine.publicJobView(withJobDates_(job));
      view.accepting_applications = true;
      return sanitizePublicView_(view);
    });
    return { jobs: jobs, company_name: companyName_() };
  }

  function companyName_() {
    try {
      return ConfigService.getCompanyName();
    } catch (e) {
      return 'AyurCentral';
    }
  }

  function getPublicJob(slug) {
    var want = trim_(slug);
    if (!want) publicNotFound_();
    var job = null;
    try {
      job = AtsRepository.findJobBySlug(want);
    } catch (e) {
      if (e && e.hrmsCode === HRMS.ERROR_CODES.CONFIGURATION) publicCareersUnavailable_();
      publicNotFound_();
    }
    job = withJobDates_(job);
    if (!job || !AtsEngine.isPubliclyVisibleJob(job)) publicNotFound_();
    var view = AtsEngine.publicJobView(job);
    view.accepting_applications = AtsEngine.isJobAcceptingApplications(job, tzToday_());
    view.company_name = companyName_();
    if (AtsEngine.upper(job.status) === ATS.JOB_STATUS.PAUSED) {
      view.message = 'This role is not currently accepting applications.';
    } else if (!view.accepting_applications) {
      view.message = 'This role is no longer accepting applications.';
    }
    return sanitizePublicView_(view);
  }

  function checkApplyRate_(email) {
    try {
      var cache = CacheService.getScriptCache();
      var key = 'ats_apply_' + email;
      var n = Number(cache.get(key) || '0') || 0;
      if (n >= ATS.LIMITS.APPLY_RATE_MAX) {
        throw validationError_('Too many applications from this email. Please try again later.');
      }
      cache.put(key, String(n + 1), ATS.LIMITS.APPLY_RATE_TTL_SEC);
    } catch (e) {
      if (e && e.hrmsCode) throw e;
    }
  }

  function saveResumeIfAny_(candidateId, payload) {
    var base64 = trim_(payload && payload.resume_base64);
    if (!base64) return null;
    var fileName = trim_(payload.resume_file_name) || 'resume.pdf';
    var mime = trim_(payload.resume_mime_type) || 'application/pdf';
    if (!AtsEngine.allowedResumeMime(mime, fileName)) {
      throw validationError_('Resume must be a PDF or Word document.');
    }
    var bytes;
    try {
      bytes = Utilities.base64Decode(base64);
    } catch (e) {
      throw validationError_('Resume file could not be read.');
    }
    if (!bytes || !bytes.length) throw validationError_('Resume file is empty.');
    if (bytes.length > resumeMaxBytes_()) {
      throw validationError_('Resume must be 2 MB or smaller.');
    }
    var blob = Utilities.newBlob(bytes, mime, fileName);
    return AtsDriveService.saveResume(candidateId, blob);
  }

  function submitPublicApplication(payload) {
    payload = payload || {};
    if (!applyEnabled_()) {
      throw conflictError_('Applications are not being accepted at this time.');
    }
    var v = AtsEngine.validatePublicApplyPayload(payload);
    if (!v.ok) throw validationError_('Please correct the highlighted fields.', v.errors);

    var job;
    try {
      job = AtsRepository.findJobBySlug(payload.public_slug || payload.job_slug || payload.slug);
    } catch (e) {
      publicNotFound_();
    }
    job = withJobDates_(job);
    if (!job || !AtsEngine.isJobAcceptingApplications(job, tzToday_())) {
      throw conflictError_('This role is not accepting applications.');
    }
    checkApplyRate_(v.email);

    var source = trim_(payload.source) || 'CAREERS_PAGE';
    if (ATS.SOURCES.indexOf(AtsEngine.upper(source)) >= 0) source = AtsEngine.upper(source);

    var result = withScriptLock_(function () {
      var candidate = AtsRepository.findCandidateByEmail(v.email);
      var now = now_();
      var createdCandidate = false;
      if (!candidate) {
        createdCandidate = true;
        candidate = {
          candidate_id: nextId_(ATS.SEQ.CANDIDATE, ATS.ID_PREFIX.CAND),
          full_name: v.full_name,
          email: v.email,
          phone: v.phone,
          location: trim_(payload.location),
          education: trim_(payload.education),
          experience_summary: trim_(payload.experience || payload.experience_summary),
          skills: trim_(payload.skills),
          source: source,
          resume_drive_file_id: '',
          resume_file_name: '',
          resume_mime_type: '',
          hired_employee_id: '',
          created_at: now,
          updated_at: now
        };
        if (!AtsEngine.isCandidateId(candidate.candidate_id)) {
          throw systemError_('Candidate ID allocation failed.');
        }
        AtsRepository.insertCandidate(candidate);
      } else {
        AtsRepository.updateCandidate(candidate.candidate_id, {
          full_name: v.full_name || candidate.full_name,
          phone: v.phone || candidate.phone,
          location: trim_(payload.location) || candidate.location,
          education: trim_(payload.education) || candidate.education,
          experience_summary: trim_(payload.experience || payload.experience_summary) || candidate.experience_summary,
          skills: trim_(payload.skills) || candidate.skills,
          updated_at: now
        });
        candidate = AtsRepository.findCandidate(candidate.candidate_id);
      }

      var apps = AtsRepository.applicationsForJob(job.job_id);
      var enriched = apps.map(function (a) {
        var c = a.candidate_id === candidate.candidate_id ? candidate : AtsRepository.findCandidate(a.candidate_id);
        return {
          job_id: a.job_id,
          email: c ? c.email : '',
          stage: a.stage,
          application_id: a.application_id
        };
      });
      var dup = AtsEngine.findDuplicateApplication(enriched, v.email, job.job_id);
      if (dup) {
        throw conflictError_('You have already applied for this role.');
      }

      var application = {
        application_id: nextId_(ATS.SEQ.APPLICATION, ATS.ID_PREFIX.APP),
        job_id: job.job_id,
        candidate_id: candidate.candidate_id,
        stage: ATS.STAGE.APPLIED,
        cover_letter: trim_(payload.cover_letter),
        source: source,
        applied_at: now,
        updated_at: now,
        stage_changed_at: now,
        stage_changed_by_email: 'public'
      };
      AtsRepository.insertApplication(application);
      return { candidate: candidate, application: application, createdCandidate: createdCandidate };
    });

    try {
      var saved = saveResumeIfAny_(result.candidate.candidate_id, payload);
      if (saved) {
        AtsRepository.updateCandidate(result.candidate.candidate_id, {
          resume_drive_file_id: saved.drive_file_id,
          resume_file_name: saved.file_name,
          resume_mime_type: trim_(payload.resume_mime_type) || 'application/pdf',
          updated_at: now_()
        });
      }
    } catch (e) {
      if (e && e.hrmsCode) throw e;
      throw configurationError_('Unable to attach your resume right now. Please try again later.');
    }

    try {
      activity_(result.candidate.candidate_id, result.application.application_id, job.job_id,
        'public:' + v.email, 'APPLY', 'Applied for ' + job.title);
    } catch (ignore) {}
    audit_(ATS.AUDIT.APPLY, 'Application', result.application.application_id,
      'Public application for job ' + job.job_id);

    fireAtsNotify_(function () {
      var packed = {
        application_id: result.application.application_id,
        job_id: job.job_id,
        candidate_id: result.candidate.candidate_id,
        title: job.title
      };
      NotificationAtsAdapter.notifyNewApplication(packed, atsInternalRecipients_(job));
      NotificationAtsAdapter.notifyCandidate('ATS_CANDIDATE_APPLICATION', result.candidate);
    });

    return {
      ok_message: 'Application received.',
      application_id: result.application.application_id,
      candidate_id: result.candidate.candidate_id,
      job_title: job.title,
      created_candidate: result.createdCandidate,
      employee_id: '',
      created_employee: false
    };
  }

  return {
    getBootstrap: getBootstrap,
    ensureSchema: ensureSchema,
    getDashboard: getDashboard,
    listJobs: listJobs,
    getJob: getJob,
    createJob: createJob,
    updateJob: updateJob,
    transitionJob: transitionJob,
    getSharePack: getSharePack,
    listHiringManagers: listHiringManagers,
    listCandidates: listCandidates,
    getCandidate: getCandidate,
    addComment: addComment,
    moveStage: moveStage,
    scheduleInterview: scheduleInterview,
    updateInterview: updateInterview,
    downloadResume: downloadResume,
    listPublicJobs: listPublicJobs,
    getPublicJob: getPublicJob,
    submitPublicApplication: submitPublicApplication
  };
})();