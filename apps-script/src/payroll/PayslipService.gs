/**
 * Payslip HTML redesign - A4 print-friendly layout.
 * One canonical generation path for Payroll, Employee Management, and My Payslips.
 */
var PayslipService = (function () {
  function empKey_(employeeId) {
    return String(employeeId || '').trim().toUpperCase();
  }

  function resolveEmployee_(employeesById, employeeId) {
    if (!employeesById || !employeeId) return {};
    var raw = String(employeeId);
    if (employeesById[raw]) return employeesById[raw];
    var norm = empKey_(raw);
    if (employeesById[norm]) return employeesById[norm];
    var found = null;
    Object.keys(employeesById).forEach(function (key) {
      if (empKey_(key) === norm) found = employeesById[key];
    });
    return found || {};
  }

  function driveApiHint_() {
    return ' Enable Google Drive API: Apps Script editor → Services (+) → Google Drive API (identifier: Drive), then redeploy.';
  }

  function payslipDriveFileOk_(doc) {
    var id = doc && doc.drive_file_id ? String(doc.drive_file_id).trim() : '';
    if (!id) return false;
    try {
      var f = DriveApp.getFileById(id);
      return !!(f && !f.isTrashed());
    } catch (ignore) {
      return false;
    }
  }

  function getArchiveFolder_(monthFolder) {
    var it = monthFolder.getFoldersByName('Archive');
    if (it.hasNext()) return it.next();
    return monthFolder.createFolder('Archive');
  }

  /** Move superseded payslip file into month/Archive (keeps history for audit). */
  function archiveDriveFile_(monthFolder, driveFileId) {
    if (!driveFileId) return;
    try {
      var f = DriveApp.getFileById(String(driveFileId));
      if (!f || f.isTrashed()) return;
      var archive = getArchiveFolder_(monthFolder);
      var tz = ConfigService.getTimezone() || 'Asia/Kolkata';
      var stamp = Utilities.formatDate(new Date(), tz, 'yyyyMMdd_HHmmss');
      var name = f.getName() || 'payslip';
      var dot = name.lastIndexOf('.');
      var base = dot >= 0 ? name.substring(0, dot) : name;
      var ext = dot >= 0 ? name.substring(dot) : '';
      f.setName(base + '-archived-' + stamp + ext);
      f.moveTo(archive);
    } catch (e) {
      Logger.log('archiveDriveFile_ failed: ' + (e.message || e));
    }
  }

  function isPayrollRunLocked_(runId) {
    if (!runId) return false;
    var run = DbService.findOne(HRMS.SHEETS.PAYROLL_RUNS, { payroll_run_id: String(runId) });
    return !!(run && String(run.status || '').toUpperCase() === HRMS.PAYROLL_STATUS.LOCKED);
  }

  function sortDocsByPayPeriodDesc_(docs) {
    function periodKey(doc) {
      if (!doc || !doc.payroll_run_id) return 0;
      var run = DbService.findOne(HRMS.SHEETS.PAYROLL_RUNS, { payroll_run_id: doc.payroll_run_id });
      if (!run) return 0;
      return Number(run.period_year) * 100 + Number(run.period_month);
    }
    return (docs || []).slice().sort(function (a, b) {
      return periodKey(b) - periodKey(a);
    });
  }

  function listForEmployee(employeeId, options) {
    options = options || {};
    employeeId = String(employeeId || '').trim();
    if (!employeeId) return [];
    var norm = empKey_(employeeId);
    var docs = (DbService.getAllRecords(HRMS.SHEETS.DOCUMENTS) || []).filter(function (d) {
      if (String(d.category || '').toUpperCase() !== HRMS.DOCUMENT_CATEGORY.PAYSLIP) return false;
      return empKey_(d.employee_id) === norm;
    });
    docs = dedupePayslipsByRun(docs);
    docs = dedupePayslipsByCalendarMonth_(docs);
    if (options.lockedRunsOnly) {
      docs = docs.filter(function (d) {
        return isPayrollRunLocked_(d.payroll_run_id);
      });
    }
    docs = sortDocsByPayPeriodDesc_(docs);
    return docs.map(function (d) {
      return enrichPayslipDoc_(d, employeeId);
    });
  }

  function generateForRun(run, records, employeesById, session, options) {
    options = options || {};
    var replaceExisting = options.replaceExisting === true;
    records = records || [];
    if (!records.length) return [];
    var folder = DriveService.getPayslipMonthFolder(run.period_year, run.period_month);
    var allDocs = DbService.findRecords(HRMS.SHEETS.DOCUMENTS, {
      category: HRMS.DOCUMENT_CATEGORY.PAYSLIP,
      payroll_run_id: run.payroll_run_id
    });
    var docsByEmp = {};
    allDocs.forEach(function (d) {
      var eid = String(d.employee_id);
      if (!docsByEmp[eid]) docsByEmp[eid] = [];
      docsByEmp[eid].push(d);
      var norm = empKey_(eid);
      if (!docsByEmp[norm]) docsByEmp[norm] = docsByEmp[eid];
    });
    var now = new Date();
    var periodLabel = monthLabel_(run.period_month) + ' ' + run.period_year;
    var inserts = [];
    var docUpdates = [];
    var recUpdates = [];
    var created = [];
    var failures = [];
    for (var i = 0; i < records.length; i++) {
      var rec = records[i];
      try {
        var emp = resolveEmployee_(employeesById, rec.employee_id);
        var existingDocs = docsByEmp[String(rec.employee_id)] || docsByEmp[empKey_(rec.employee_id)] || [];
        var reuse = findReusableDocument(existingDocs, rec);
        if (!replaceExisting && reuse && payslipDriveFileOk_(reuse)) {
          if (String(rec.payslip_document_id || '') !== String(reuse.document_id)) {
            recUpdates.push({
              pk: rec.payroll_record_id,
              updates: { payslip_document_id: reuse.document_id }
            });
          }
          rec.payslip_document_id = reuse.document_id;
          created.push({
            document_id: reuse.document_id,
            employee_id: rec.employee_id,
            drive_file_id: reuse.drive_file_id,
            reused: true,
            skipped: true
          });
          continue;
        }
        if (replaceExisting && reuse && payslipDriveFileOk_(reuse)) {
          archiveDriveFile_(folder, reuse.drive_file_id);
        }
        var file = writePayslipFile_(folder, run, rec, emp, { replaceExisting: replaceExisting });
        var documentId;
        if (reuse && reuse.document_id) {
          documentId = reuse.document_id;
          docUpdates.push({
            pk: documentId,
            updates: {
              title: 'Payslip - ' + periodLabel,
              drive_file_id: file.getId(),
              drive_folder_id: folder.getId(),
              uploaded_at: now,
              uploaded_by_email: session.email
            }
          });
        } else {
          documentId = DbService.generateId('DOC');
          inserts.push({
            document_id: documentId,
            employee_id: rec.employee_id,
            category: HRMS.DOCUMENT_CATEGORY.PAYSLIP,
            title: 'Payslip - ' + periodLabel,
            drive_file_id: file.getId(),
            drive_folder_id: folder.getId(),
            payroll_run_id: run.payroll_run_id,
            uploaded_at: now,
            uploaded_by_email: session.email
          });
        }
        recUpdates.push({
          pk: rec.payroll_record_id,
          updates: { payslip_document_id: documentId }
        });
        rec.payslip_document_id = documentId;
        created.push({
          document_id: documentId,
          employee_id: rec.employee_id,
          drive_file_id: file.getId(),
          reused: !!reuse
        });
      } catch (rowErr) {
        var rowMsg = rowErr.message || String(rowErr);
        Logger.log('Payslip row failed for ' + rec.employee_id + ': ' + rowMsg + '\n' + (rowErr.stack || ''));
        failures.push({ employee_id: rec.employee_id, message: rowMsg });
      }
    }
    if (inserts.length) DbService.insertRecords(HRMS.SHEETS.DOCUMENTS, inserts);
    if (docUpdates.length) DbService.updateRecords(HRMS.SHEETS.DOCUMENTS, 'document_id', docUpdates);
    if (recUpdates.length) DbService.updateRecords(HRMS.SHEETS.PAYROLL_RECORDS, 'payroll_record_id', recUpdates);
    if (!created.length && failures.length) {
      var detail = failures[0].message || 'Unknown error';
      if (failures.length > 1) {
        detail += ' (' + failures.length + ' employees failed)';
      }
      throw new Error(detail);
    }
    return created;
  }

  function generateForEmployee(run, record, employee, session, options) {
    if (!record) throw validationError_('Payroll record is required.');
    var byId = {};
    byId[record.employee_id] = employee || {};
    var norm = empKey_(record.employee_id);
    if (norm) byId[norm] = employee || {};
    var created = generateForRun(run, [record], byId, session, options || {});
    if (!created || !created.length) {
      throw new Error('Payslip file could not be created.');
    }
    return created[0];
  }

  function findReusableDocument(docs, rec) {
    docs = docs || [];
    var wantId = rec && rec.payslip_document_id ? String(rec.payslip_document_id) : '';
    if (wantId) {
      for (var i = 0; i < docs.length; i++) {
        if (String(docs[i].document_id) === wantId) return docs[i];
      }
    }
    if (!docs.length) return null;
    var sorted = docs.slice().sort(function (a, b) {
      return new Date(b.uploaded_at || 0) - new Date(a.uploaded_at || 0);
    });
    return sorted[0];
  }

  function dedupePayslipsByRun(docs) {
    var byKey = {};
    (docs || []).forEach(function (d) {
      var key = String(d.payroll_run_id || '') || String(d.document_id);
      var prev = byKey[key];
      if (!prev || new Date(d.uploaded_at || 0) > new Date(prev.uploaded_at || 0)) {
        byKey[key] = d;
      }
    });
    return Object.keys(byKey).map(function (k) { return byKey[k]; }).sort(function (a, b) {
      return new Date(b.uploaded_at || 0) - new Date(a.uploaded_at || 0);
    });
  }

  /** One row per calendar month when multiple document rows exist for the same period. */
  function dedupePayslipsByCalendarMonth_(docs) {
    var byMonth = {};
    (docs || []).forEach(function (d) {
      var key = calendarMonthKeyForDoc_(d);
      var prev = byMonth[key];
      if (!prev || new Date(d.uploaded_at || 0) > new Date(prev.uploaded_at || 0)) {
        byMonth[key] = d;
      }
    });
    return Object.keys(byMonth).map(function (k) { return byMonth[k]; });
  }

  function isPdfBytes_(bytes) {
    if (!bytes || bytes.length < 5) return false;
    return bytes[0] === 37 && bytes[1] === 80 && bytes[2] === 68 && bytes[3] === 70 && bytes[4] === 45;
  }

  function calendarMonthKeyForDoc_(d) {
    var emp = empKey_(d.employee_id);
    if (d.payroll_run_id) {
      var run = DbService.findOne(HRMS.SHEETS.PAYROLL_RUNS, { payroll_run_id: String(d.payroll_run_id) });
      if (run) {
        return emp + '|' + Number(run.period_year) + '|' + Number(run.period_month);
      }
    }
    return emp + '|doc|' + String(d.document_id || '');
  }

  function exportDriveFileAsPdf_(fileId) {
    fileId = String(fileId || '');
    if (!fileId) throw new Error('Missing Google Doc id for PDF export.');

    function assertPdfBlob_(blob) {
      if (!blob || typeof blob.getBytes !== 'function' || !blob.getBytes().length) {
        throw new Error('PDF export returned empty.');
      }
      if (!isPdfBytes_(blob.getBytes())) {
        throw new Error('PDF export returned non-PDF bytes.');
      }
      return blob;
    }

    var exportMime = encodeURIComponent('application/pdf');
    var url = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) +
      '/export?mimeType=' + exportMime;
    var resp = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() === 200) {
      try {
        return assertPdfBlob_(resp.getBlob());
      } catch (urlBlobErr) {
        Logger.log('UrlFetch export blob invalid: ' + (urlBlobErr.message || urlBlobErr));
      }
    } else {
      Logger.log('UrlFetch PDF export HTTP ' + resp.getResponseCode() + ': ' +
        String(resp.getContentText()).substring(0, 400));
    }

    if (typeof Drive !== 'undefined' && Drive.Files && Drive.Files.export) {
      return assertPdfBlob_(Drive.Files.export(fileId, 'application/pdf'));
    }
    throw new Error('Could not export payslip as PDF.' + driveApiHint_());
  }

  /** Client download payload with correct MIME/extension (fixes HTML mislabeled as PDF). */
  function payslipIntent_(intent) {
    var s = String(intent || '').trim().toLowerCase();
    return s === 'view' ? 'view' : 'download';
  }

  function payslipPayload_(bytes, doc, opts) {
    opts = opts || {};
    var isPdf = opts.is_pdf != null ? !!opts.is_pdf : isPdfBytes_(bytes);
    var rawName = opts.fileName || (doc && doc.title) || 'payslip';
    var base = String(rawName).replace(/\.(pdf|html?)$/i, '');
    var fileName = isPdf ? base + '.pdf' : base + '.html';
    return {
      document_id: doc.document_id,
      employee_id: doc.employee_id,
      title: doc.title,
      fileName: fileName,
      mimeType: isPdf ? 'application/pdf' : 'text/html; charset=utf-8',
      is_pdf: isPdf,
      base64: Utilities.base64Encode(bytes)
    };
  }

  /** View: serve stored HTML in browser. Download: PDF when possible from HTML source. */
  function packagePayslipFileForClient_(blob, doc, options) {
    options = options || {};
    var intent = payslipIntent_(options.intent);
    var bytes = blob.getBytes();
    if (isPdfBytes_(bytes)) {
      return payslipPayload_(bytes, doc, { is_pdf: true, fileName: blob.getName() });
    }
    var html = '';
    try {
      html = blob.getDataAsString();
    } catch (readErr) {
      Logger.log('packagePayslipFileForClient_ read: ' + (readErr.message || readErr));
    }
    var looksHtml = html && /<\s*html/i.test(html);
    if (intent === 'view' && looksHtml) {
      return payslipPayload_(bytes, doc, { is_pdf: false, fileName: blob.getName() });
    }
    if (looksHtml) {
      var base = String(blob.getName() || (doc && doc.title) || 'payslip').replace(/\.(pdf|html?)$/i, '');
      try {
        var pdfBlob = htmlToPdfBlob_(html, base + '.pdf');
        if (pdfBlob && isPdfBytes_(pdfBlob.getBytes())) {
          return payslipPayload_(pdfBlob.getBytes(), doc, { is_pdf: true, fileName: base + '.pdf' });
        }
      } catch (convErr) {
        Logger.log('packagePayslipFileForClient_ PDF convert: ' + (convErr.message || convErr));
      }
      return payslipPayload_(bytes, doc, { is_pdf: false, fileName: blob.getName() });
    }
    return payslipPayload_(bytes, doc, { is_pdf: isPdfBytes_(bytes), fileName: blob.getName() });
  }

  function htmlFallbackBlob_(html, fileName) {
    var base = String(fileName || 'payslip.pdf').replace(/\.pdf$/i, '');
    return Utilities.newBlob(html, 'text/html', base + '.html');
  }

  function htmlToPdfBlob_(html, fileName) {
    fileName = fileName || 'payslip.pdf';
    if (typeof Drive === 'undefined' || !Drive.Files) {
      throw new Error('Google Drive API is required for PDF payslips.' + driveApiHint_());
    }
    var htmlBlob = Utilities.newBlob(html, 'text/html', 'payslip-export.html');
    var tempId = null;
    try {
      var resource = {
        name: 'HRMS Payslip Export ' + Date.now(),
        mimeType: 'application/vnd.google-apps.document'
      };
      var docFile;
      if (Drive.Files.create) {
        docFile = Drive.Files.create(resource, htmlBlob);
      } else if (Drive.Files.insert) {
        docFile = Drive.Files.insert({
          title: resource.name,
          mimeType: resource.mimeType
        }, htmlBlob, { convert: true });
      } else {
        throw new Error('Drive file create is unavailable.' + driveApiHint_());
      }
      tempId = docFile.id;
      if (!tempId) throw new Error('Could not create temporary Google Doc for PDF export.');
      Utilities.sleep(600);
      var pdfBlob = exportDriveFileAsPdf_(tempId);
      return pdfBlob.setName(fileName);
    } catch (e) {
      Logger.log('htmlToPdfBlob_ failed: ' + (e.message || e));
      throw e;
    } finally {
      if (tempId) {
        try { DriveApp.getFileById(tempId).setTrashed(true); } catch (ignore) {}
      }
    }
  }

  function trashOrphanPayslipFiles_(folder, baseName) {
    ['.pdf', '.html'].forEach(function (ext) {
      var existing = folder.getFilesByName(baseName + ext);
      while (existing.hasNext()) {
        existing.next().setTrashed(true);
      }
    });
  }

  function writePayslipFile_(folder, run, rec, emp, writeOpts) {
    writeOpts = writeOpts || {};
    var html = buildHtml_(run, rec, emp);
    var baseName = rec.employee_id + '-' + run.payroll_run_id + '-payslip';
    var htmlName = baseName + '.html';
    if (writeOpts.replaceExisting) {
      trashOrphanPayslipFiles_(folder, baseName);
    } else {
      var htmlIt = folder.getFilesByName(htmlName);
      if (htmlIt.hasNext()) return htmlIt.next();
      var pdfIt = folder.getFilesByName(baseName + '.pdf');
      if (pdfIt.hasNext()) {
        var existingPdf = pdfIt.next();
        try {
          if (isPdfBytes_(existingPdf.getBlob().getBytes())) return existingPdf;
        } catch (ignorePdf) {}
      }
    }
    return folder.createFile(Utilities.newBlob(html, 'text/html; charset=utf-8', htmlName));
  }

  function enrichPayslipDoc_(doc, employeeId) {
    var runId = String(doc.payroll_run_id || '');
    var periodLabel = doc.title || 'Payslip';
    var netPay = null;
    if (runId) {
      var run = DbService.findOne(HRMS.SHEETS.PAYROLL_RUNS, { payroll_run_id: runId });
      if (run) {
        periodLabel = monthLabel_(run.period_month) + ' ' + run.period_year;
      }
      var rec = DbService.findOne(HRMS.SHEETS.PAYROLL_RECORDS, {
        payroll_run_id: runId,
        employee_id: employeeId
      });
      if (rec) netPay = rec.net_pay;
    }
    return {
      document_id: String(doc.document_id || ''),
      title: String(doc.title || ''),
      period_label: String(periodLabel || ''),
      payroll_run_id: runId,
      net_pay: netPay == null || netPay === '' ? null : Number(netPay),
      uploaded_at: serializeDateTime_(doc.uploaded_at),
      generated_at: serializeDateTime_(doc.uploaded_at)
    };
  }

  function serializeDateTime_(value) {
    if (value === null || value === undefined || value === '') return '';
    if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
      return value.toISOString();
    }
    return String(value);
  }

  function getPayslipForDownload(documentId, intent) {
    var session = PermissionService.require(HRMS.ACTIONS.VIEW_OWN_PAYSLIP);
    var doc = DbService.findOne(HRMS.SHEETS.DOCUMENTS, { document_id: documentId });
    if (!doc || String(doc.category).toUpperCase() !== HRMS.DOCUMENT_CATEGORY.PAYSLIP) {
      throw notFoundError_('Payslip not found.');
    }
    if (!PermissionService.isHrOrAdmin(session)) {
      if (empKey_(doc.employee_id) !== empKey_(session.employee_id)) {
        throw authorizationError_('You can only download your own payslip.');
      }
      if (!isPayrollRunLocked_(doc.payroll_run_id)) {
        throw authorizationError_('This payslip is not available until payroll is finalized for that month.');
      }
    }
    var file = DriveApp.getFileById(doc.drive_file_id);
    return packagePayslipFileForClient_(file.getBlob(), doc, { intent: payslipIntent_(intent) });
  }

  function listOwnPayslips() {
    var session = PermissionService.require(HRMS.ACTIONS.VIEW_OWN_PAYSLIP);
    var employeeId = String(session.employee_id || '').trim();
    if (!employeeId) return [];
    return listForEmployee(employeeId, { lockedRunsOnly: true });
  }

  function daysInMonth_(year, month) {
    return new Date(Number(year), Number(month), 0).getDate();
  }

  function formatDate_(value) {
    if (!value) return '-';
    var d = toDate_(value);
    if (!d) return String(value);
    return Utilities.formatDate(d, ConfigService.getTimezone(), 'dd MMM yyyy');
  }

  function toDate_(v) {
    if (!v && v !== 0) return null;
    if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) return v;
    var s = String(v).substring(0, 10);
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    var d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  var EARNING_ROWS_ = [
    { label: 'Basic', codes: ['BASIC', 'BP', 'BASIC_DA', 'BASIC+DA'] },
    { label: 'HRA', codes: ['HRA'] },
    { label: 'Conveyance', codes: ['CONV', 'CONVEYANCE', 'CA', 'CONVEYANCE_ALLOWANCE'] },
    { label: 'Medical Allowance', codes: ['MEDICAL', 'MED', 'MA', 'MEDICAL_ALL', 'MEDICAL_ALLOWANCE'] },
    { label: 'Special Allowance', codes: ['SA', 'SPECIAL', 'SPECIAL_ALLOWANCE'] },
    { label: 'Other Allowance', codes: ['OTHER', 'OTHER_ALLOWANCE', 'OA', 'OTHER_EARNING'] },
    { label: 'Arrears', codes: ['ARREARS', 'ARR'] }
  ];

  var DEDUCTION_ROWS_ = [
    { label: 'Provident Fund (PF)', codes: ['PF', 'EPF'] },
    { label: 'Professional Tax', codes: ['PT', 'PROFESSIONAL_TAX'] },
    { label: 'TDS', codes: ['TDS'] },
    { label: 'ESI', codes: ['ESI', 'ESIC'] },
    { label: 'Advance', codes: ['ADVANCE', 'ADV'] },
    { label: 'Loan / Cash Deduction (LCD)', codes: ['LCD', 'LOAN'] },
    { label: 'Leave Without Pay (LWF)', codes: ['LWF', 'LOP', 'LOP_DED'] }
  ];

  function round2_(n) {
    var x = Number(n);
    if (!isFinite(x)) x = 0;
    return Math.round(x * 100) / 100;
  }

  function pickFromLines_(lines, codes, field) {
    var set = {};
    (codes || []).forEach(function (c) { set[String(c).toUpperCase()] = true; });
    var total = 0;
    var hit = false;
    (lines || []).forEach(function (ln) {
      var code = String(ln.component_code || '').toUpperCase();
      if (!set[code]) return;
      hit = true;
      total = round2_(total + (Number(ln[field]) || 0));
    });
    return hit ? total : null;
  }

  function sumFromLines_(lines, codes, field) {
    var v = pickFromLines_(lines, codes, field);
    return v == null ? 0 : v;
  }

  function resolveEmployerBlock_(emp, employeeId) {
    var name = ConfigService.getCompanyName();
    var addr = String(ConfigService.getSetting('company_address', '') || '').trim();
    var vertical = '';
    if (typeof PayslipLogoService !== 'undefined' && PayslipLogoService.resolveVertical) {
      vertical = PayslipLogoService.resolveVertical(emp, employeeId);
    }
    if (!vertical) vertical = String(emp.vertical_name || '').trim().toUpperCase();
    if (!vertical && employeeId) {
      vertical = String(employeeId).split('-')[0].trim().toUpperCase();
    }
    if (vertical && typeof EmployeeRepository !== 'undefined' && EmployeeRepository.listVerticalCatalog) {
      var catalog = EmployeeRepository.listVerticalCatalog() || [];
      for (var i = 0; i < catalog.length; i++) {
        var row = catalog[i];
        if (String(row.vertical_name || '').toUpperCase() !== vertical) continue;
        if (row.legal_name) name = row.legal_name;
        var parts = [];
        if (row.address_line1) parts.push(String(row.address_line1).trim());
        if (row.address_line2) parts.push(String(row.address_line2).trim());
        if (parts.length) addr = parts.join(', ');
        break;
      }
    }
    var logoSrc = '';
    var logoClass = 'logo';
    if (typeof PayslipLogoService !== 'undefined' && PayslipLogoService.dataUriForEmployee) {
      logoSrc = PayslipLogoService.dataUriForEmployee(emp, employeeId);
      logoClass = PayslipLogoService.logoCssClassForVertical(vertical);
    }
    if (!logoSrc) {
      logoSrc = String(ConfigService.getSetting('payslip_logo_url', '') || '').trim();
    }
    return {
      name: name,
      address: addr,
      vertical: vertical,
      logoSrc: logoSrc,
      logoClass: logoClass
    };
  }

  function periodLabelUpper_(run) {
    return monthLabel_(run.period_month).toUpperCase() + ' - ' + run.period_year;
  }

  function formatDojPayslip_(value) {
    var d = toDate_(value);
    if (!d) return value ? String(value) : '-';
    var names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return d.getDate() + '-' + names[d.getMonth()] + '-' + d.getFullYear();
  }

  function formatGeneratedDatePayslip_() {
    return Utilities.formatDate(new Date(), ConfigService.getTimezone(), 'dd-MMM-yyyy');
  }

  function moneyPayslip_(n) {
    var x = Number(n);
    if (!isFinite(x)) x = 0;
    return Math.round(x).toLocaleString('en-IN');
  }

  function amountInWordsPayslip_(amount) {
    return amountInWords_(amount).replace(/\s*Rupees\s*/i, ' ').replace(/\s+/g, ' ').trim();
  }

  function dashOr_(value) {
    var s = value == null ? '' : String(value).trim();
    return s ? s : '-';
  }

  function amountInWords_(amount) {
    var n = Math.round(Number(amount) || 0);
    if (n === 0) return 'Zero Rupees Only';
    var ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
      'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    var tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    function twoDigits(num) {
      if (num < 20) return ones[num];
      return tens[Math.floor(num / 10)] + (num % 10 ? ' ' + ones[num % 10] : '');
    }
    function threeDigits(num) {
      var h = Math.floor(num / 100);
      var rest = num % 100;
      return (h ? ones[h] + ' Hundred' + (rest ? ' ' : '') : '') + (rest ? twoDigits(rest) : '');
    }
    var parts = [];
    var crore = Math.floor(n / 10000000);
    n %= 10000000;
    var lakh = Math.floor(n / 100000);
    n %= 100000;
    var thousand = Math.floor(n / 1000);
    n %= 1000;
    if (crore) parts.push(threeDigits(crore) + ' Crore');
    if (lakh) parts.push(twoDigits(lakh) + ' Lakh');
    if (thousand) parts.push(twoDigits(thousand) + ' Thousand');
    if (n) parts.push(threeDigits(n));
    return parts.join(' ') + ' Rupees Only';
  }

  function buildHtml_(run, rec, emp) {
    var employer = resolveEmployerBlock_(emp, rec.employee_id);
    var periodUpper = periodLabelUpper_(run);
    var breakdown = {};
    try {
      breakdown = JSON.parse(rec.component_breakdown || '{}');
    } catch (ignore) {
      breakdown = {};
    }
    var meta = breakdown.meta || {};
    var lines = breakdown.lines || [];
    var name = meta.display_name || emp.display_name || rec.employee_id;
    var dept = meta.department || emp.department || '';
    var desig = meta.designation || emp.designation || '';
    var location = emp.location || meta.location || '';
    var joiningDate = formatDojPayslip_(emp.joining_date || meta.joining_date);
    var bankName = emp.bank_name || meta.bank_name || '';
    var bankAccount = emp.bank_account_number || meta.bank_account_number || '';
    var bankDisplay = bankAccount ? String(bankAccount) : (meta.bank_masked || PayrollEngine.maskBank(bankAccount));
    var ifsc = emp.bank_ifsc || meta.bank_ifsc || '';
    var pfNo = emp.pf_no || meta.pf_no || '';
    var uan = emp.uan_no || meta.uan_no || emp.uan || meta.uan || '';
    var esiNo = emp.esi_no || meta.esi_no || '';

    var workingDays = rec.working_days != null && rec.working_days !== '' ? rec.working_days : 0;
    var paidDays = rec.paid_days != null && rec.paid_days !== '' ? rec.paid_days : 0;
    var lopDays = rec.lop_days != null && rec.lop_days !== '' ? rec.lop_days : 0;
    var dim = daysInMonth_(run.period_year, run.period_month);
    var effectiveDays = workingDays != null && workingDays !== '' ? workingDays : paidDays;

    var earnRows = '';
    EARNING_ROWS_.forEach(function (row) {
      var rate = sumFromLines_(lines, row.codes, 'contractual');
      var actual = sumFromLines_(lines, row.codes, 'amount');
      if (row.label === 'Other Allowance') {
        actual = round2_(actual + (Number(rec.bonus) || 0) + (Number(rec.incentive) || 0) +
          (Number(rec.other_earnings) || 0));
      }
      earnRows += '<tr><td>' + esc_(row.label) + '</td><td class="num">' + moneyPayslip_(rate) +
        '</td><td class="num">' + moneyPayslip_(actual) + '</td></tr>';
    });

    var dedRows = '';
    DEDUCTION_ROWS_.forEach(function (row) {
      var actual = sumFromLines_(lines, row.codes, 'amount');
      if (row.label === 'TDS' && !actual) actual = Number(rec.tds_amount) || 0;
      if (row.label === 'Advance') actual = round2_(actual + (Number(rec.other_deductions) || 0));
      dedRows += '<tr><td>' + esc_(row.label) + '</td><td class="num">' + moneyPayslip_(actual) + '</td></tr>';
    });

    var grossA = Number(rec.gross_earnings) || 0;
    var grossB = Number(rec.total_deductions) || 0;
    var netPay = Number(rec.net_pay) || 0;
    var generated = formatGeneratedDatePayslip_();
    var logoHtml = employer.logoSrc
      ? '<img class="' + esc_(employer.logoClass || 'logo') + '" src="' + esc_(employer.logoSrc) + '" alt="Company logo"/>'
      : '<div class="logo-placeholder"></div>';

    return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>PAY SLIP - ' + esc_(periodUpper) +
      '</title><style>' +
      '@page{size:A4;margin:12mm}' +
      'body{font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#222;margin:0;padding:18px;background:#fff;font-size:12px}' +
      '.sheet{max-width:820px;margin:0 auto;border:1px solid #d8dde3;padding:16px 18px}' +
      '.top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:12px}' +
      '.brand{display:flex;gap:12px;align-items:flex-start;flex:1}' +
      '.logo{height:42px;width:auto;object-fit:contain;display:block}' +
      '.logo-sapl{height:40px;max-width:150px}' +
      '.logo-ayurvedaone{height:52px;max-width:220px}' +
      '.logo-placeholder{width:42px;height:42px;border:1px dashed #c5cec8;border-radius:4px}' +
      '.company-name{font-size:18px;font-weight:700;color:#2f5f3f;margin:0 0 4px}' +
      '.company-addr{font-size:11px;color:#4a5568;line-height:1.45;max-width:420px}' +
      '.title-block{text-align:right;min-width:160px}' +
      '.pay-slip-badge{background:#2f5f3f;color:#fff;font-weight:700;font-size:14px;padding:10px 18px;letter-spacing:.06em}' +
      '.period-label{margin-top:8px;font-size:13px;font-weight:600;color:#2f5f3f}' +
      '.info{border:1px solid #e2e6ea;display:flex;margin-bottom:0}' +
      '.info-col{flex:1;padding:10px 12px}' +
      '.info-col:first-child{border-right:1px solid #e2e6ea}' +
      '.info-row{display:flex;margin-bottom:5px;font-size:11px}' +
      '.info-row label{width:118px;color:#5c6670;font-weight:600}' +
      '.info-row span{flex:1;color:#111}' +
      '.attn{background:#eceff2;border:1px solid #e2e6ea;border-top:none;padding:8px 12px;font-size:11px;font-weight:600;color:#333}' +
      '.tables{display:flex;gap:0;border:1px solid #e2e6ea;border-top:none}' +
      '.tbl-wrap{flex:1}' +
      '.tbl-wrap:first-child{border-right:1px solid #e2e6ea}' +
      'table{width:100%;border-collapse:collapse}' +
      'th{background:#2f5f3f;color:#fff;font-size:10px;font-weight:600;padding:7px 8px;text-align:left}' +
      'th.num{text-align:right}' +
      'td{padding:6px 8px;border-bottom:1px solid #eef1f4;font-size:11px}' +
      'td.num{text-align:right;font-variant-numeric:tabular-nums}' +
      'tr.total td{font-weight:700;color:#2f5f3f;border-top:2px solid #2f5f3f;border-bottom:none}' +
      '.net-wrap{margin-top:14px;display:flex;border:1px solid #c8e6d0;background:#f4faf6}' +
      '.net-left{flex:1;padding:14px 16px;display:flex;align-items:center;gap:12px}' +
      '.net-coins{font-size:22px;line-height:1}' +
      '.net-amt-label{font-size:11px;font-weight:600;color:#2f5f3f}' +
      '.net-amt{font-size:26px;font-weight:700;color:#1f4330;margin-top:2px}' +
      '.net-right{flex:1;padding:14px 16px;border-left:1px solid #c8e6d0}' +
      '.words-label{font-size:10px;color:#5c6670;font-weight:600;text-transform:uppercase}' +
      '.words-val{margin-top:6px;font-size:14px;font-weight:700;color:#2f5f3f}' +
      '.foot{display:flex;justify-content:space-between;margin-top:16px;font-size:10px;color:#5c6670;gap:20px}' +
      '.notes{flex:1;line-height:1.5}' +
      '.gen-date{text-align:right;white-space:nowrap}' +
      '@media print{body{padding:0}.sheet{border:none}.net-wrap{-webkit-print-color-adjust:exact;print-color-adjust:exact}th{-webkit-print-color-adjust:exact;print-color-adjust:exact}}' +
      '</style></head><body><div class="sheet">' +
      '<div class="top"><div class="brand">' + logoHtml +
      '<div><div class="company-name">' + esc_(employer.name) + '</div>' +
      (employer.address ? '<div class="company-addr">' + esc_(employer.address) + '</div>' : '') +
      '</div></div><div class="title-block"><div class="pay-slip-badge">PAY SLIP</div>' +
      '<div class="period-label">' + esc_(periodUpper) + '</div></div></div>' +
      '<div class="info"><div class="info-col">' +
      infoRow_('Name', name) + infoRow_('Employee ID', rec.employee_id) +
      infoRow_('Designation', desig) + infoRow_('Department', dept) +
      infoRow_('Date of Joining', joiningDate) + infoRow_('Location', location) +
      '</div><div class="info-col">' +
      infoRow_('Bank Name', bankName) + infoRow_('Account No.', bankDisplay) +
      infoRow_('IFSC', ifsc) + infoRow_('PF No.', pfNo) +
      infoRow_('UAN', uan) + infoRow_('ESI No.', esiNo) +
      '</div></div>' +
      '<div class="attn">Effective Work Days : ' + esc_(effectiveDays) + ' &nbsp;|&nbsp; Days in Month : ' +
      esc_(dim) + ' &nbsp;|&nbsp; LOP Days : ' + esc_(lopDays) + ' &nbsp;|&nbsp; Paid Days : ' + esc_(paidDays) +
      '</div>' +
      '<div class="tables"><div class="tbl-wrap"><table><thead><tr>' +
      '<th>EARNINGS</th><th class="num">RATE (Rs.)</th><th class="num">ACTUAL (Rs.)</th></tr></thead><tbody>' +
      earnRows +
      '<tr class="total"><td>TOTAL EARNINGS (A)</td><td class="num"></td><td class="num">' + moneyPayslip_(grossA) +
      '</td></tr></tbody></table></div><div class="tbl-wrap"><table><thead><tr>' +
      '<th>DEDUCTIONS</th><th class="num">ACTUAL (Rs.)</th></tr></thead><tbody>' +
      dedRows +
      '<tr class="total"><td>TOTAL DEDUCTIONS (B)</td><td class="num">' + moneyPayslip_(grossB) + '</td></tr>' +
      '</tbody></table></div></div>' +
      '<div class="net-wrap"><div class="net-left"><div class="net-coins" aria-hidden="true">🪙</div><div>' +
      '<div class="net-amt-label">NET PAY (A - B)</div><div class="net-amt">Rs. ' + moneyPayslip_(netPay) + '</div></div></div>' +
      '<div class="net-right"><div class="words-label">IN WORDS</div><div class="words-val">' +
      esc_(amountInWordsPayslip_(netPay)) + '</div></div></div>' +
      '<div class="foot"><div class="notes"><strong>Note:</strong><br>' +
      '1. This is a system-generated payslip and does not require a signature.<br>' +
      '2. All payments are subject to statutory deductions and company policies.<br>' +
      '3. For any queries, please contact the HR Department.</div>' +
      '<div class="gen-date">Generated on : ' + esc_(generated) + '</div></div>' +
      '</div></body></html>';
  }

  function infoRow_(label, value) {
    return '<div class="info-row"><label>' + esc_(label) + ' :</label><span>' + esc_(dashOr_(value)) + '</span></div>';
  }

  function field_(label, value) {
    return '<div class="field"><label>' + esc_(label) + '</label><div>' + esc_(value == null || value === '' ? '-' : value) + '</div></div>';
  }

  function moneyDisplay_(n) {
    var x = Number(n);
    if (!isFinite(x)) x = 0;
    return x.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function money_(n) {
    return moneyDisplay_(n);
  }

  function esc_(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function monthLabel_(month) {
    var names = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    return names[Number(month) - 1] || '';
  }

  return {
    generateForRun: generateForRun,
    generateForEmployee: generateForEmployee,
    getPayslipForDownload: getPayslipForDownload,
    listOwnPayslips: listOwnPayslips,
    listForEmployee: listForEmployee,
    findReusableDocument: findReusableDocument,
    dedupePayslipsByRun: dedupePayslipsByRun,
    enrichPayslipDoc: enrichPayslipDoc_,
    payslipDriveFileOk: payslipDriveFileOk_,
    packagePayslipFileForClient: packagePayslipFileForClient_
  };
})();
