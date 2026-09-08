/**
 * Thin sheet access for ATS entities. Uses DbService conventions.
 */
var ATS = ATS || {};

var AtsRepository = (function () {
  function safeAll_(sheetName) {
    try {
      return DbService.getAllRecords(sheetName);
    } catch (e) {
      return null;
    }
  }

  function requireSheet_(sheetName) {
    var rows = safeAll_(sheetName);
    if (rows === null) {
      throw configurationError_('ATS is not set up yet. An administrator must run ATS database setup.');
    }
    return rows;
  }

  function listJobs() {
    return requireSheet_(ATS.SHEETS.JOBS);
  }

  function findJob(jobId) {
    return DbService.findOne(ATS.SHEETS.JOBS, { job_id: String(jobId || '') });
  }

  function findJobBySlug(slug) {
    var want = String(slug || '').trim();
    if (!want) return null;
    var jobs = requireSheet_(ATS.SHEETS.JOBS);
    for (var i = 0; i < jobs.length; i++) {
      if (String(jobs[i].public_slug || '').trim() === want) return jobs[i];
    }
    return null;
  }

  function insertJob(record) {
    return DbService.insertRecord(ATS.SHEETS.JOBS, record);
  }

  function updateJob(jobId, updates) {
    return DbService.updateRecord(ATS.SHEETS.JOBS, 'job_id', jobId, updates);
  }

  function listCandidates() {
    return requireSheet_(ATS.SHEETS.CANDIDATES);
  }

  function findCandidate(candidateId) {
    return DbService.findOne(ATS.SHEETS.CANDIDATES, { candidate_id: String(candidateId || '') });
  }

  function findCandidateByEmail(email) {
    var want = String(email || '').trim().toLowerCase();
    if (!want) return null;
    var rows = requireSheet_(ATS.SHEETS.CANDIDATES);
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].email || '').trim().toLowerCase() === want) return rows[i];
    }
    return null;
  }

  function insertCandidate(record) {
    return DbService.insertRecord(ATS.SHEETS.CANDIDATES, record);
  }

  function updateCandidate(candidateId, updates) {
    return DbService.updateRecord(ATS.SHEETS.CANDIDATES, 'candidate_id', candidateId, updates);
  }

  function listApplications() {
    return requireSheet_(ATS.SHEETS.APPLICATIONS);
  }

  function findApplication(applicationId) {
    return DbService.findOne(ATS.SHEETS.APPLICATIONS, { application_id: String(applicationId || '') });
  }

  function applicationsForJob(jobId) {
    return DbService.findRecords(ATS.SHEETS.APPLICATIONS, { job_id: String(jobId || '') });
  }

  function applicationsForCandidate(candidateId) {
    return DbService.findRecords(ATS.SHEETS.APPLICATIONS, { candidate_id: String(candidateId || '') });
  }

  function insertApplication(record) {
    return DbService.insertRecord(ATS.SHEETS.APPLICATIONS, record);
  }

  function updateApplication(applicationId, updates) {
    return DbService.updateRecord(ATS.SHEETS.APPLICATIONS, 'application_id', applicationId, updates);
  }

  function listInterviews() {
    return requireSheet_(ATS.SHEETS.INTERVIEWS);
  }

  function interviewsForApplication(applicationId) {
    return DbService.findRecords(ATS.SHEETS.INTERVIEWS, { application_id: String(applicationId || '') });
  }

  function interviewsForCandidate(candidateId) {
    return DbService.findRecords(ATS.SHEETS.INTERVIEWS, { candidate_id: String(candidateId || '') });
  }

  function findInterview(interviewId) {
    return DbService.findOne(ATS.SHEETS.INTERVIEWS, { interview_id: String(interviewId || '') });
  }

  function insertInterview(record) {
    return DbService.insertRecord(ATS.SHEETS.INTERVIEWS, record);
  }

  function updateInterview(interviewId, updates) {
    return DbService.updateRecord(ATS.SHEETS.INTERVIEWS, 'interview_id', interviewId, updates);
  }

  function activityForCandidate(candidateId) {
    var rows = DbService.findRecords(ATS.SHEETS.ACTIVITY, { candidate_id: String(candidateId || '') });
    rows.sort(function (a, b) {
      return new Date(b.created_at) - new Date(a.created_at);
    });
    return rows;
  }

  function insertActivity(record) {
    return DbService.insertRecord(ATS.SHEETS.ACTIVITY, record);
  }

  return {
    safeAll: safeAll_,
    listJobs: listJobs,
    findJob: findJob,
    findJobBySlug: findJobBySlug,
    insertJob: insertJob,
    updateJob: updateJob,
    listCandidates: listCandidates,
    findCandidate: findCandidate,
    findCandidateByEmail: findCandidateByEmail,
    insertCandidate: insertCandidate,
    updateCandidate: updateCandidate,
    listApplications: listApplications,
    findApplication: findApplication,
    applicationsForJob: applicationsForJob,
    applicationsForCandidate: applicationsForCandidate,
    insertApplication: insertApplication,
    updateApplication: updateApplication,
    listInterviews: listInterviews,
    interviewsForApplication: interviewsForApplication,
    interviewsForCandidate: interviewsForCandidate,
    findInterview: findInterview,
    insertInterview: insertInterview,
    updateInterview: updateInterview,
    activityForCandidate: activityForCandidate,
    insertActivity: insertActivity
  };
})();
