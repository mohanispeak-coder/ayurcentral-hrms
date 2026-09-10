/**
 * ATS bulk upload — jobs and candidates (.xlsx or .csv).
 * Candidate source is required for reverse tracking. Duplicate rows are rejected.
 */
var ATS = ATS || {};

var AtsBulkService = (function () {
  var JOBS_TEMPLATE_VERSION_ = '1';
  var CAND_TEMPLATE_VERSION_ = '1';
  var MAX_ROWS_ = 100;
  var STAGE_TTL_SEC_ = 1800;
  var STAGE_PREFIX_JOBS_ = 'bulk_ats_jobs_';
  var STAGE_PREFIX_CANDS_ = 'bulk_ats_cands_';

  var JOB_HEADERS_ = [
    'title', 'department', 'location', 'employment_type', 'experience', 'education',
    'salary_range', 'description', 'responsibilities', 'requirements', 'skills',
    'openings', 'hiring_manager_employee_id', 'closing_date', 'notes_internal', 'publish'
  ];

  var JOB_REQUIRED_ = ['title'];

  var CAND_HEADERS_ = [
    'job_id', 'full_name', 'email', 'phone', 'location', 'education',
    'experience_summary', 'skills', 'source', 'cover_letter'
  ];

  var CAND_REQUIRED_ = ['job_id', 'full_name', 'email', 'phone', 'source'];

  var JOB_SAMPLE_ = {
    title: 'Sales Executive',
    department: 'Sales',
    location: 'Bangalore',
    employment_type: 'PERMANENT',
    experience: '2-4 years',
    education: 'Graduate',
    salary_range: 'As per company norms',
    description: 'Role summary',
    responsibilities: 'Key responsibilities',
    requirements: 'Requirements',
    skills: 'Communication, Excel',
    openings: '1',
    hiring_manager_employee_id: '',
    closing_date: '2026-12-31',
    notes_internal: '',
    publish: 'NO'
  };

  var CAND_SAMPLE_ = {
    job_id: 'JOB-0001',
    full_name: 'Priya Sharma',
    email: 'priya.sharma@example.com',
    phone: '9876543210',
    location: 'Bangalore',
    education: 'MBA',
    experience_summary: '3 years in retail',
    skills: 'Sales, CRM',
    source: 'NAUKRI',
    cover_letter: ''
  };

  function trim_(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
  }

  function normalizeHeader_(header) {
    return trim_(header).toLowerCase().replace(/\s+/g, '_');
  }

  function normalizeEmail_(email) {
    return trim_(email).toLowerCase();
  }

  function driveApiHint_() {
    return ' Enable Google Drive API in Apps Script → Services → Google Drive API.';
  }

  function exportSpreadsheetXlsx_(spreadsheetId) {
    if (typeof Drive === 'undefined' || !Drive.Files || !Drive.Files.export) {
      throw configurationError_('Google Drive advanced service is required.' + driveApiHint_());
    }
    return Drive.Files.export(spreadsheetId, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }

  function convertUploadToSheetId_(blob) {
    if (typeof Drive === 'undefined' || !Drive.Files) {
      throw configurationError_('Google Drive advanced service is required for Excel uploads.' + driveApiHint_());
    }
    var temp = DriveApp.createFile(blob);
    try {
      var resource = { name: 'bulk-ats-parse-' + Date.now(), mimeType: MimeType.GOOGLE_SHEETS };
      var converted = Drive.Files.create
        ? Drive.Files.create(resource, temp.getBlob(), { convert: true })
        : Drive.Files.insert(resource, temp.getBlob(), { convert: true });
      return converted.id;
    } finally {
      temp.setTrashed(true);
    }
  }

  function parseCsvRows_(text) {
    var rows = Utilities.parseCsv(text);
    if (!rows || rows.length < 2) return [];
    var headers = rows[0].map(function (h) { return normalizeHeader_(h).replace(/\*$/, ''); });
    var out = [];
    for (var r = 1; r < rows.length; r++) {
      var line = rows[r];
      if (!line || !line.length) continue;
      var allBlank = true;
      for (var c = 0; c < line.length; c++) {
        if (trim_(line[c])) allBlank = false;
      }
      if (allBlank) continue;
      var row = { rowNumber: r + 1 };
      for (var i = 0; i < headers.length; i++) {
        if (!headers[i]) continue;
        row[headers[i]] = trim_(line[i]);
      }
      out.push(row);
    }
    return out;
  }

  function parseSheetValues_(values) {
    if (!values || values.length < 2) return [];
    var headers = values[0].map(function (h) { return normalizeHeader_(h).replace(/\*$/, ''); });
    var out = [];
    for (var r = 1; r < values.length; r++) {
      var line = values[r];
      var allBlank = true;
      for (var c = 0; c < line.length; c++) {
        if (trim_(line[c])) allBlank = false;
      }
      if (allBlank) continue;
      var row = { rowNumber: r + 1 };
      for (var i = 0; i < headers.length; i++) {
        if (!headers[i]) continue;
        row[headers[i]] = trim_(line[i]);
      }
      out.push(row);
    }
    return out;
  }

  function parseUpload_(meta, sheetName) {
    meta = meta || {};
    var base64 = trim_(meta.base64);
    var fileName = trim_(meta.fileName).toLowerCase();
    var mimeType = trim_(meta.mimeType).toLowerCase();
    if (!base64) throw validationError_('Upload file is required.');

    var bytes = Utilities.base64Decode(base64);
    var blob = Utilities.newBlob(bytes, mimeType || 'application/octet-stream', fileName || 'upload');

    if (fileName.indexOf('.csv') >= 0 || mimeType.indexOf('csv') >= 0 || mimeType.indexOf('text/plain') >= 0) {
      return parseCsvRows_(blob.getDataAsString('UTF-8'));
    }

    if (fileName.indexOf('.xlsx') >= 0 || fileName.indexOf('.xls') >= 0 ||
        mimeType.indexOf('spreadsheet') >= 0 || mimeType.indexOf('officedocument') >= 0) {
      var sheetId = convertUploadToSheetId_(blob);
      try {
        var ss = SpreadsheetApp.openById(sheetId);
        var sheet = ss.getSheetByName(sheetName) || ss.getSheets()[0];
        return parseSheetValues_(sheet.getDataRange().getValues());
      } finally {
        try { DriveApp.getFileById(sheetId).setTrashed(true); } catch (ignore) {}
      }
    }

    throw validationError_('Upload a .csv or .xlsx file.');
  }

  function buildTemplateCsv_(headers, sample, required) {
    var esc = function (v) {
      v = v == null ? '' : String(v);
      if (v.indexOf(',') >= 0 || v.indexOf('"') >= 0 || v.indexOf('\n') >= 0) {
        return '"' + v.replace(/"/g, '""') + '"';
      }
      return v;
    };
    var headerLabels = headers.map(function (h) {
      return (required.indexOf(h) >= 0 ? h + '*' : h);
    });
    var lines = [headerLabels.map(esc).join(',')];
    lines.push(headers.map(function (h) { return esc(sample[h] || ''); }).join(','));
    return lines.join('\n');
  }

  function buildTemplateSpreadsheet_(title, sheetName, headers, sample, required, instructions) {
    var ss = SpreadsheetApp.create(title);
    var fileId = ss.getId();
    try {
      var info = ss.getSheets()[0];
      info.setName('Instructions');
      info.getRange(1, 1).setValue(title + ' — Instructions');
      var lines = instructions.map(function (line) { return [line]; });
      info.getRange(3, 1, 3 + lines.length - 1, 1).setValues(lines);
      var sheet = ss.insertSheet(sheetName);
      var headerLabels = headers.map(function (h) {
        return (required.indexOf(h) >= 0 ? h + '*' : h);
      });
      sheet.getRange(1, 1, 1, headers.length).setValues([headerLabels]);
      sheet.getRange(2, 1, 2, headers.length).setValues([headers.map(function (h) { return sample[h] || ''; })]);
      sheet.setFrozenRows(1);
      SpreadsheetApp.flush();
    } catch (e) {
      if (e.hrmsCode) throw e;
      throw configurationError_('Could not create template: ' + (e.message || e));
    }
    var blob;
    try {
      blob = exportSpreadsheetXlsx_(fileId);
    } finally {
      try { DriveApp.getFileById(fileId).setTrashed(true); } catch (ignoreTrash) {}
    }
    return blob;
  }

  function templateResponse_(blob, fileName, mimeType, version) {
    return {
      fileName: fileName,
      mimeType: mimeType,
      base64: Utilities.base64Encode(blob.getBytes()),
      templateVersion: version
    };
  }

  function downloadJobsTemplate() {
    AtsPermissionService.requireManage(AuthService.requireAuth());
    AtsSchemaService.ensureSheets();
    var instructions = [
      'Template version: ' + JOBS_TEMPLATE_VERSION_,
      'Upload .xlsx or .csv. Required columns are marked with *.',
      'Duplicate job titles in one file are rejected.',
      'publish: YES to publish immediately, otherwise job stays DRAFT.',
      'Valid source values are not used for jobs.',
      'Maximum ' + MAX_ROWS_ + ' rows per upload.'
    ];
    try {
      var blob = buildTemplateSpreadsheet_('HRMS ATS Jobs Upload', 'Jobs', JOB_HEADERS_, JOB_SAMPLE_, JOB_REQUIRED_, instructions);
      blob.setName('HRMS_ATS_Jobs_Upload_Template.xlsx');
      return templateResponse_(blob, 'HRMS_ATS_Jobs_Upload_Template.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', JOBS_TEMPLATE_VERSION_);
    } catch (e) {
      var csv = Utilities.newBlob(buildTemplateCsv_(JOB_HEADERS_, JOB_SAMPLE_, JOB_REQUIRED_), 'text/csv',
        'HRMS_ATS_Jobs_Upload_Template.csv');
      return templateResponse_(csv, 'HRMS_ATS_Jobs_Upload_Template.csv', 'text/csv', JOBS_TEMPLATE_VERSION_);
    }
  }

  function downloadCandidatesTemplate() {
    AtsPermissionService.requireManage(AuthService.requireAuth());
    AtsSchemaService.ensureSheets();
    var instructions = [
      'Template version: ' + CAND_TEMPLATE_VERSION_,
      'Upload .xlsx or .csv. source is required for reverse tracking.',
      'Valid source values: ' + ATS.SOURCES.join(', '),
      'Duplicate email or duplicate email+job_id rows in one file are rejected.',
      'Candidates already applied to the same job are rejected.',
      'Maximum ' + MAX_ROWS_ + ' rows per upload.'
    ];
    try {
      var blob = buildTemplateSpreadsheet_('HRMS ATS Candidates Upload', 'Candidates',
        CAND_HEADERS_, CAND_SAMPLE_, CAND_REQUIRED_, instructions);
      blob.setName('HRMS_ATS_Candidates_Upload_Template.xlsx');
      return templateResponse_(blob, 'HRMS_ATS_Candidates_Upload_Template.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', CAND_TEMPLATE_VERSION_);
    } catch (e) {
      var csv = Utilities.newBlob(buildTemplateCsv_(CAND_HEADERS_, CAND_SAMPLE_, CAND_REQUIRED_), 'text/csv',
        'HRMS_ATS_Candidates_Upload_Template.csv');
      return templateResponse_(csv, 'HRMS_ATS_Candidates_Upload_Template.csv', 'text/csv', CAND_TEMPLATE_VERSION_);
    }
  }

  function validateJobRows_(rows) {
    rows = rows || [];
    if (!rows.length) throw validationError_('No data rows found in the file.');
    if (rows.length > MAX_ROWS_) throw validationError_('Maximum ' + MAX_ROWS_ + ' rows per upload.');

    var seenTitles = {};
    var valid = [];
    var errors = [];

    rows.forEach(function (row) {
      var rowLabel = row.rowNumber;
      var rowErrors = [];
      var title = trim_(row.title);
      var titleKey = title.toLowerCase();

      if (!title) {
        rowErrors.push({ field: 'title', message: 'Job title is required.' });
      } else if (seenTitles[titleKey]) {
        rowErrors.push({ field: 'title', message: 'Duplicate job title in this file.' });
      }

      var payload = {};
      JOB_HEADERS_.forEach(function (h) {
        if (row.hasOwnProperty(h)) payload[h] = row[h];
      });

      try {
        var v = AtsEngine.validateJobPayload(payload, true);
        if (!v.ok) {
          Object.keys(v.errors).forEach(function (k) {
            rowErrors.push({ field: k, message: v.errors[k] });
          });
        }
      } catch (e) {
        rowErrors.push({ field: '_row', message: e.message || 'Invalid job row.' });
      }

      if (rowErrors.length) {
        errors.push({ rowNumber: rowLabel, title: title, messages: rowErrors });
      } else {
        seenTitles[titleKey] = rowLabel;
        valid.push({
          rowNumber: rowLabel,
          payload: payload,
          preview: { rowNumber: rowLabel, title: title, department: trim_(row.department), location: trim_(row.location) }
        });
      }
    });

    return {
      templateVersion: JOBS_TEMPLATE_VERSION_,
      totalRows: rows.length,
      validCount: valid.length,
      errorCount: errors.length,
      valid: valid.map(function (v) { return v.preview; }),
      errors: errors,
      validPayloads: valid.map(function (v) { return v.payload; })
    };
  }

  function validateCandidateRows_(rows) {
    rows = rows || [];
    if (!rows.length) throw validationError_('No data rows found in the file.');
    if (rows.length > MAX_ROWS_) throw validationError_('Maximum ' + MAX_ROWS_ + ' rows per upload.');

    var jobsById = {};
    AtsRepository.listJobs().forEach(function (j) {
      jobsById[j.job_id] = j;
    });

    var apps = AtsRepository.listApplications();
    var candidates = AtsRepository.listCandidates();

    var existingAppKeys = {};
    apps.forEach(function (a) {
      var cand = null;
      for (var ci = 0; ci < candidates.length; ci++) {
        if (candidates[ci].candidate_id === a.candidate_id) {
          cand = candidates[ci];
          break;
        }
      }
      if (cand && cand.email) {
        existingAppKeys[normalizeEmail_(cand.email) + '|' + a.job_id] = true;
      }
    });

    var seenAppKeys = {};
    var valid = [];
    var errors = [];

    rows.forEach(function (row) {
      var rowLabel = row.rowNumber;
      var rowErrors = [];
      var jobId = trim_(row.job_id);
      var email = normalizeEmail_(row.email);
      var appKey = email + '|' + jobId;

      if (!jobId) rowErrors.push({ field: 'job_id', message: 'job_id is required.' });
      else if (!jobsById[jobId]) rowErrors.push({ field: 'job_id', message: 'Job not found: ' + jobId });

      var name = trim_(row.full_name);
      if (!name) rowErrors.push({ field: 'full_name', message: 'full_name is required.' });
      else if (name.length > ATS.LIMITS.NAME_MAX) rowErrors.push({ field: 'full_name', message: 'Name is too long.' });

      if (!email) rowErrors.push({ field: 'email', message: 'email is required.' });
      else if (!/@/.test(email) || email.indexOf('.') < 0) {
        rowErrors.push({ field: 'email', message: 'Enter a valid email address.' });
      }

      var phone = trim_(row.phone).replace(/[^\d+]/g, '');
      var digits = phone.replace(/\D/g, '');
      if (!digits) rowErrors.push({ field: 'phone', message: 'phone is required.' });
      else if (digits.length < ATS.LIMITS.PHONE_MIN || digits.length > ATS.LIMITS.PHONE_MAX) {
        rowErrors.push({ field: 'phone', message: 'Enter a valid phone number.' });
      }

      var source = AtsEngine.upper(trim_(row.source));
      if (!source) {
        rowErrors.push({ field: 'source', message: 'source is required for reverse tracking.' });
      } else if (ATS.SOURCES.indexOf(source) < 0) {
        rowErrors.push({ field: 'source', message: 'source must be one of: ' + ATS.SOURCES.join(', ') });
      }

      if (email && jobId && seenAppKeys[appKey]) {
        rowErrors.push({ field: 'job_id', message: 'Duplicate application (same email and job) in this file.' });
      }
      if (email && jobId && existingAppKeys[appKey]) {
        rowErrors.push({ field: 'email', message: 'This candidate has already applied to this job.' });
      }

      if (rowErrors.length) {
        errors.push({
          rowNumber: rowLabel,
          email: email,
          job_id: jobId,
          full_name: name,
          messages: rowErrors
        });
      } else {
        seenAppKeys[appKey] = rowLabel;
        valid.push({
          rowNumber: rowLabel,
          payload: {
            job_id: jobId,
            full_name: name,
            email: email,
            phone: trim_(row.phone),
            location: trim_(row.location),
            education: trim_(row.education),
            experience_summary: trim_(row.experience_summary),
            skills: trim_(row.skills),
            source: source,
            cover_letter: trim_(row.cover_letter)
          },
          preview: {
            rowNumber: rowLabel,
            job_id: jobId,
            full_name: name,
            email: email,
            source: source
          }
        });
      }
    });

    return {
      templateVersion: CAND_TEMPLATE_VERSION_,
      totalRows: rows.length,
      validCount: valid.length,
      errorCount: errors.length,
      valid: valid.map(function (v) { return v.preview; }),
      errors: errors,
      validPayloads: valid.map(function (v) { return v.payload; })
    };
  }

  function stageKeyJobs_(uploadId) {
    return STAGE_PREFIX_JOBS_ + uploadId;
  }

  function stageKeyCands_(uploadId) {
    return STAGE_PREFIX_CANDS_ + uploadId;
  }

  function validateJobsUpload(meta) {
    var session = AuthService.requireAuth();
    AtsPermissionService.requireManage(session);
    var rows = parseUpload_(meta, 'Jobs');
    var result = validateJobRows_(rows);
    var uploadId = Utilities.getUuid();
    CacheService.getScriptCache().put(stageKeyJobs_(uploadId), JSON.stringify({
      actorEmail: session.email,
      validPayloads: result.validPayloads,
      createdAt: Date.now()
    }), STAGE_TTL_SEC_);
    return {
      uploadId: uploadId,
      templateVersion: result.templateVersion,
      totalRows: result.totalRows,
      validCount: result.validCount,
      errorCount: result.errorCount,
      valid: result.valid,
      errors: result.errors
    };
  }

  function validateCandidatesUpload(meta) {
    var session = AuthService.requireAuth();
    AtsPermissionService.requireManage(session);
    var rows = parseUpload_(meta, 'Candidates');
    var result = validateCandidateRows_(rows);
    var uploadId = Utilities.getUuid();
    CacheService.getScriptCache().put(stageKeyCands_(uploadId), JSON.stringify({
      actorEmail: session.email,
      validPayloads: result.validPayloads,
      createdAt: Date.now()
    }), STAGE_TTL_SEC_);
    return {
      uploadId: uploadId,
      templateVersion: result.templateVersion,
      totalRows: result.totalRows,
      validCount: result.validCount,
      errorCount: result.errorCount,
      valid: result.valid,
      errors: result.errors
    };
  }

  function shouldPublish_(value) {
    var v = AtsEngine.upper(trim_(value));
    return v === 'YES' || v === 'Y' || v === 'TRUE' || v === 'PUBLISH' || v === 'PUBLISHED';
  }

  function commitJobsUpload(uploadId) {
    var session = AuthService.requireAuth();
    AtsPermissionService.requireManage(session);
    uploadId = trim_(uploadId);
    if (!uploadId) throw validationError_('uploadId is required.');

    var cache = CacheService.getScriptCache();
    var raw = cache.get(stageKeyJobs_(uploadId));
    if (!raw) throw validationError_('Upload session expired. Validate the file again.');
    var staged = JSON.parse(raw);
    if (staged.actorEmail !== session.email) {
      throw authorizationError_('This upload session belongs to another user.');
    }
    var payloads = staged.validPayloads || [];
    if (!payloads.length) throw validationError_('No valid rows to import.');

    var created = [];
    var failed = [];

    return withScriptLock_(function () {
      payloads.forEach(function (payload, index) {
        try {
          var result = AtsService.createJob(session, payload);
          var job = result.job;
          if (shouldPublish_(payload.publish)) {
            result = AtsService.transitionJob(session, job.job_id, ATS.JOB_STATUS.PUBLISHED);
            job = result.job;
          }
          created.push({ rowNumber: index + 1, job_id: job.job_id, title: job.title, status: job.status });
        } catch (e) {
          failed.push({ title: payload.title || '', message: e.message || 'Create failed.' });
        }
      });
      cache.remove(stageKeyJobs_(uploadId));
      return { createdCount: created.length, failedCount: failed.length, created: created, failed: failed };
    });
  }

  function nextId_(seqKey, prefix) {
    var seq = DbService.nextSequenceAssumingLocked(seqKey);
    return AtsEngine.formatAtsId(prefix, seq, ATS.LIMITS.ID_PAD);
  }

  function commitCandidatesUpload(uploadId) {
    var session = AuthService.requireAuth();
    AtsPermissionService.requireManage(session);
    uploadId = trim_(uploadId);
    if (!uploadId) throw validationError_('uploadId is required.');

    var cache = CacheService.getScriptCache();
    var raw = cache.get(stageKeyCands_(uploadId));
    if (!raw) throw validationError_('Upload session expired. Validate the file again.');
    var staged = JSON.parse(raw);
    if (staged.actorEmail !== session.email) {
      throw authorizationError_('This upload session belongs to another user.');
    }
    var payloads = staged.validPayloads || [];
    if (!payloads.length) throw validationError_('No valid rows to import.');

    var created = [];
    var failed = [];
    var actor = session.email ? String(session.email).toLowerCase() : 'system';

    return withScriptLock_(function () {
      payloads.forEach(function (payload, index) {
        try {
          var now = new Date();
          var candidate = AtsRepository.findCandidateByEmail(payload.email);
          var createdCandidate = false;
          if (!candidate) {
            createdCandidate = true;
            candidate = {
              candidate_id: nextId_(ATS.SEQ.CANDIDATE, ATS.ID_PREFIX.CAND),
              full_name: payload.full_name,
              email: payload.email,
              phone: payload.phone,
              location: payload.location || '',
              education: payload.education || '',
              experience_summary: payload.experience_summary || '',
              skills: payload.skills || '',
              source: payload.source,
              resume_drive_file_id: '',
              resume_file_name: '',
              resume_mime_type: '',
              hired_employee_id: '',
              created_at: now,
              updated_at: now
            };
            AtsRepository.insertCandidate(candidate);
          } else {
            AtsRepository.updateCandidate(candidate.candidate_id, {
              full_name: payload.full_name || candidate.full_name,
              phone: payload.phone || candidate.phone,
              location: payload.location || candidate.location,
              education: payload.education || candidate.education,
              experience_summary: payload.experience_summary || candidate.experience_summary,
              skills: payload.skills || candidate.skills,
              source: payload.source,
              updated_at: now
            });
            candidate = AtsRepository.findCandidate(candidate.candidate_id);
          }

          var apps = AtsRepository.applicationsForJob(payload.job_id);
          var enriched = apps.map(function (a) {
            var c = AtsRepository.findCandidate(a.candidate_id);
            return { job_id: a.job_id, email: c ? c.email : '', stage: a.stage, application_id: a.application_id };
          });
          var dup = AtsEngine.findDuplicateApplication(enriched, payload.email, payload.job_id);
          if (dup) throw conflictError_('Candidate already applied to this job.');

          var application = {
            application_id: nextId_(ATS.SEQ.APPLICATION, ATS.ID_PREFIX.APP),
            job_id: payload.job_id,
            candidate_id: candidate.candidate_id,
            stage: ATS.STAGE.APPLIED,
            cover_letter: payload.cover_letter || '',
            source: payload.source,
            applied_at: now,
            updated_at: now,
            stage_changed_at: now,
            stage_changed_by_email: actor
          };
          AtsRepository.insertApplication(application);

          var activity = {
            activity_id: nextId_(ATS.SEQ.ACTIVITY, ATS.ID_PREFIX.ACT),
            candidate_id: candidate.candidate_id,
            application_id: application.application_id,
            job_id: payload.job_id,
            actor_email: actor,
            action: 'BULK_IMPORT',
            summary: 'Bulk import application for job ' + payload.job_id + ' (source: ' + payload.source + ')',
            created_at: now
          };
          AtsRepository.insertActivity(activity);

          created.push({
            rowNumber: index + 1,
            candidate_id: candidate.candidate_id,
            application_id: application.application_id,
            email: payload.email,
            source: payload.source,
            created_candidate: createdCandidate
          });
        } catch (e) {
          failed.push({ email: payload.email || '', job_id: payload.job_id || '', message: e.message || 'Import failed.' });
        }
      });
      cache.remove(stageKeyCands_(uploadId));
      return { createdCount: created.length, failedCount: failed.length, created: created, failed: failed };
    });
  }

  return {
    downloadJobsTemplate: downloadJobsTemplate,
    downloadCandidatesTemplate: downloadCandidatesTemplate,
    validateJobsUpload: validateJobsUpload,
    validateCandidatesUpload: validateCandidatesUpload,
    commitJobsUpload: commitJobsUpload,
    commitCandidatesUpload: commitCandidatesUpload,
    JOB_HEADERS: JOB_HEADERS_,
    CAND_HEADERS: CAND_HEADERS_,
    parseCsvRows: parseCsvRows_,
    validateJobRows: validateJobRows_,
    validateCandidateRows: validateCandidateRows_
  };
})();
