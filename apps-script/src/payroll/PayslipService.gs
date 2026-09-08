/**
 * Payslip HTML files on Drive — Payslips/{year}/{month}. No public links.
 * Regeneration is idempotent: same Drive file name is replaced; Documents row is reused.
 */
var PayslipService = (function () {
  function generateForRun(run, records, employeesById, session) {
    var created = [];
    for (var i = 0; i < records.length; i++) {
      var rec = records[i];
      var emp = employeesById[rec.employee_id] || {};
      var doc = createPayslip_(run, rec, emp, session);
      created.push(doc);
    }
    return created;
  }

  /**
   * Prefer the record's payslip_document_id, else the latest Documents row for that employee+run.
   * Pure helper — used by generate and tests.
   */
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

  /**
   * One payslip row per payroll_run_id (latest upload wins).
   */
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

  function createPayslip_(run, rec, emp, session) {
    var html = buildHtml_(run, rec, emp);
    var folder = DriveService.getPayslipMonthFolder(run.period_year, run.period_month);
    var fileName = rec.employee_id + '-' + run.payroll_run_id + '-payslip.html';
    var existing = folder.getFilesByName(fileName);
    while (existing.hasNext()) {
      existing.next().setTrashed(true);
    }
    var blob = Utilities.newBlob(html, 'text/html', fileName);
    var file = folder.createFile(blob);
    var now = new Date();
    var existingDocs = DbService.findRecords(HRMS.SHEETS.DOCUMENTS, {
      employee_id: rec.employee_id,
      category: HRMS.DOCUMENT_CATEGORY.PAYSLIP,
      payroll_run_id: run.payroll_run_id
    });
    var reuse = findReusableDocument(existingDocs, rec);
    var documentId;
    if (reuse && reuse.document_id) {
      documentId = reuse.document_id;
      DbService.updateRecord(HRMS.SHEETS.DOCUMENTS, 'document_id', documentId, {
        title: 'Payslip ' + run.payroll_run_id + ' ' + rec.employee_id,
        drive_file_id: file.getId(),
        drive_folder_id: folder.getId(),
        uploaded_at: now,
        uploaded_by_email: session.email
      });
    } else {
      documentId = DbService.generateId('DOC');
      DbService.insertRecord(HRMS.SHEETS.DOCUMENTS, {
        document_id: documentId,
        employee_id: rec.employee_id,
        category: HRMS.DOCUMENT_CATEGORY.PAYSLIP,
        title: 'Payslip ' + run.payroll_run_id + ' ' + rec.employee_id,
        drive_file_id: file.getId(),
        drive_folder_id: folder.getId(),
        payroll_run_id: run.payroll_run_id,
        uploaded_at: now,
        uploaded_by_email: session.email
      });
    }
    DbService.updateRecord(HRMS.SHEETS.PAYROLL_RECORDS, 'payroll_record_id', rec.payroll_record_id, {
      payslip_document_id: documentId
    });
    rec.payslip_document_id = documentId;
    return { document_id: documentId, employee_id: rec.employee_id, drive_file_id: file.getId(), reused: !!reuse };
  }

  function getPayslipForDownload(documentId) {
    var session = PermissionService.require(HRMS.ACTIONS.VIEW_OWN_PAYSLIP);
    var doc = DbService.findOne(HRMS.SHEETS.DOCUMENTS, { document_id: documentId });
    if (!doc || String(doc.category).toUpperCase() !== HRMS.DOCUMENT_CATEGORY.PAYSLIP) {
      throw notFoundError_('Payslip not found.');
    }
    if (!PermissionService.isHrOrAdmin(session)) {
      if (String(doc.employee_id) !== String(session.employee_id)) {
        throw authorizationError_('You can only download your own payslip.');
      }
    }
    var file = DriveApp.getFileById(doc.drive_file_id);
    var blob = file.getBlob();
    return {
      document_id: doc.document_id,
      employee_id: doc.employee_id,
      title: doc.title,
      fileName: blob.getName() || doc.title,
      mimeType: blob.getContentType() || 'text/html',
      base64: Utilities.base64Encode(blob.getBytes())
    };
  }

  function listOwnPayslips() {
    var session = PermissionService.require(HRMS.ACTIONS.VIEW_OWN_PAYSLIP);
    var docs = DbService.findRecords(HRMS.SHEETS.DOCUMENTS, {
      employee_id: session.employee_id,
      category: HRMS.DOCUMENT_CATEGORY.PAYSLIP
    });
    return dedupePayslipsByRun(docs).map(function (d) {
      return {
        document_id: d.document_id,
        title: d.title,
        payroll_run_id: d.payroll_run_id,
        uploaded_at: d.uploaded_at
      };
    });
  }

  function buildHtml_(run, rec, emp) {
    var company = ConfigService.getCompanyName();
    var period = monthLabel_(run.period_month) + ' ' + run.period_year;
    var breakdown = {};
    try {
      breakdown = JSON.parse(rec.component_breakdown || '{}');
    } catch (ignore) {
      breakdown = {};
    }
    var meta = breakdown.meta || {};
    var name = meta.display_name || emp.display_name || rec.employee_id;
    var dept = meta.department || emp.department || '';
    var desig = meta.designation || emp.designation || '';
    var bankMasked = meta.bank_masked || PayrollEngine.maskBank(emp.bank_account_number);
    var lines = breakdown.lines || [];
    var earnRows = '';
    var dedRows = '';
    lines.forEach(function (line) {
      var row = '<tr><td>' + esc_(line.component_name || line.component_code) +
        '</td><td class="num">' + money_(line.amount) + '</td></tr>';
      if (line.component_kind === 'EARNING') earnRows += row;
      else if (line.component_kind === 'DEDUCTION') dedRows += row;
    });
    if (Number(rec.bonus) > 0) {
      earnRows += '<tr><td>Bonus</td><td class="num">' + money_(rec.bonus) + '</td></tr>';
    }
    if (Number(rec.incentive) > 0) {
      earnRows += '<tr><td>Incentive</td><td class="num">' + money_(rec.incentive) + '</td></tr>';
    }
    if (Number(rec.other_earnings) > 0) {
      earnRows += '<tr><td>Other earnings</td><td class="num">' + money_(rec.other_earnings) + '</td></tr>';
    }
    if (Number(rec.tds_amount) > 0) {
      dedRows += '<tr><td>TDS</td><td class="num">' + money_(rec.tds_amount) + '</td></tr>';
    }
    if (Number(rec.other_deductions) > 0) {
      dedRows += '<tr><td>Other deductions</td><td class="num">' + money_(rec.other_deductions) + '</td></tr>';
    }

    var generated = Utilities.formatDate(new Date(), ConfigService.getTimezone(), 'yyyy-MM-dd HH:mm');
    return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Payslip ' + esc_(run.payroll_run_id) +
      '</title><style>body{font-family:Segoe UI,Arial,sans-serif;color:#2c2c2c;margin:24px}' +
      'h1{font-size:18px;color:#2d5a3d}table{width:100%;border-collapse:collapse;margin:12px 0}' +
      'th,td{border:1px solid #ddd5c8;padding:8px;text-align:left}.num{text-align:right;font-variant-numeric:tabular-nums}' +
      '.meta{color:#6b7f6e;font-size:13px}.total{font-weight:700}</style></head><body>' +
      '<h1>' + esc_(company) + '</h1><p class="meta">Payslip — ' + esc_(period) + ' (' + esc_(run.payroll_run_id) + ')</p>' +
      '<table><tr><th>Employee ID</th><td>' + esc_(rec.employee_id) + '</td><th>Name</th><td>' + esc_(name) + '</td></tr>' +
      '<tr><th>Department</th><td>' + esc_(dept) + '</td><th>Designation</th><td>' + esc_(desig) + '</td></tr>' +
      '<tr><th>Working days</th><td class="num">' + esc_(rec.working_days) + '</td><th>Paid days</th><td class="num">' + esc_(rec.paid_days) + '</td></tr>' +
      '<tr><th>LOP days</th><td class="num">' + esc_(rec.lop_days) + '</td><th>Bank</th><td>' + esc_(bankMasked) + '</td></tr></table>' +
      '<h2>Earnings</h2><table><thead><tr><th>Component</th><th class="num">Amount (INR)</th></tr></thead><tbody>' +
      (earnRows || '<tr><td colspan="2">None</td></tr>') +
      '<tr class="total"><td>Gross earnings</td><td class="num">' + money_(rec.gross_earnings) + '</td></tr></tbody></table>' +
      '<h2>Deductions</h2><table><thead><tr><th>Component</th><th class="num">Amount (INR)</th></tr></thead><tbody>' +
      (dedRows || '<tr><td colspan="2">None</td></tr>') +
      '<tr class="total"><td>Total deductions</td><td class="num">' + money_(rec.total_deductions) + '</td></tr></tbody></table>' +
      '<p class="total">Net pay: INR ' + money_(rec.net_pay) + '</p>' +
      '<p class="meta">Employer contributions (not in net): INR ' + money_(rec.employer_contributions) + '</p>' +
      '<p class="meta">Generated at ' + esc_(generated) + '. This document is confidential.</p></body></html>';
  }

  function money_(n) {
    var x = Number(n);
    if (!isFinite(x)) x = 0;
    return x.toFixed(2);
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
    getPayslipForDownload: getPayslipForDownload,
    listOwnPayslips: listOwnPayslips,
    findReusableDocument: findReusableDocument,
    dedupePayslipsByRun: dedupePayslipsByRun
  };
})();
