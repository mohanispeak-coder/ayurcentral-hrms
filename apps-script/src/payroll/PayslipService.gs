/**
 * Payslip HTML redesign — A4 print-friendly layout.
 * One canonical generation path for Payroll, Employee Management, and My Payslips.
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

  function generateForEmployee(run, record, employee, session) {
    if (!record) throw validationError_('Payroll record is required.');
    return createPayslip_(run, record, employee || {}, session);
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
    var periodLabel = monthLabel_(run.period_month) + ' ' + run.period_year;
    if (reuse && reuse.document_id) {
      documentId = reuse.document_id;
      DbService.updateRecord(HRMS.SHEETS.DOCUMENTS, 'document_id', documentId, {
        title: 'Payslip — ' + periodLabel,
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
        title: 'Payslip — ' + periodLabel,
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
      document_id: doc.document_id,
      title: doc.title,
      period_label: periodLabel,
      payroll_run_id: doc.payroll_run_id || '',
      net_pay: netPay,
      uploaded_at: doc.uploaded_at,
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
      return enrichPayslipDoc_(d, session.employee_id);
    });
  }

  function daysInMonth_(year, month) {
    return new Date(Number(year), Number(month), 0).getDate();
  }

  function formatDate_(value) {
    if (!value) return '—';
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
    var company = ConfigService.getCompanyName();
    var companyAddress = ConfigService.getSetting('company_address', '');
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
    var location = emp.location || meta.location || '';
    var joiningDate = formatDate_(emp.joining_date || meta.joining_date);
    var bankName = emp.bank_name || meta.bank_name || '';
    var bankAccount = emp.bank_account_number || '';
    var bankMasked = meta.bank_masked || PayrollEngine.maskBank(bankAccount);
    var pan = emp.pan || meta.pan || '';
    var workingDays = rec.working_days != null ? rec.working_days : '';
    var paidDays = rec.paid_days != null ? rec.paid_days : '';
    var lopDays = rec.lop_days != null ? rec.lop_days : '';
    var dim = daysInMonth_(run.period_year, run.period_month);
    var lines = breakdown.lines || [];
    var earnRows = '';
    var dedRows = '';
    var pfNumber = '';
    var uan = '';
    var esi = '';
    lines.forEach(function (line) {
      var code = String(line.component_code || '').toUpperCase();
      var row = '<tr><td>' + esc_(line.component_name || line.component_code) +
        '</td><td class="num">' + moneyDisplay_(line.amount) + '</td></tr>';
      if (line.component_kind === 'EARNING') earnRows += row;
      else if (line.component_kind === 'DEDUCTION') {
        dedRows += row;
        if (code === 'PF' || code.indexOf('PF') >= 0) pfNumber = pfNumber || 'On record';
        if (code === 'ESI') esi = esi || moneyDisplay_(line.amount);
      }
    });
    if (Number(rec.bonus) > 0) {
      earnRows += '<tr><td>Bonus</td><td class="num">' + moneyDisplay_(rec.bonus) + '</td></tr>';
    }
    if (Number(rec.incentive) > 0) {
      earnRows += '<tr><td>Incentive</td><td class="num">' + moneyDisplay_(rec.incentive) + '</td></tr>';
    }
    if (Number(rec.other_earnings) > 0) {
      earnRows += '<tr><td>Other earnings</td><td class="num">' + moneyDisplay_(rec.other_earnings) + '</td></tr>';
    }
    if (Number(rec.tds_amount) > 0) {
      dedRows += '<tr><td>TDS</td><td class="num">' + moneyDisplay_(rec.tds_amount) + '</td></tr>';
    }
    if (Number(rec.other_deductions) > 0) {
      dedRows += '<tr><td>Other deductions</td><td class="num">' + moneyDisplay_(rec.other_deductions) + '</td></tr>';
    }

    var generated = Utilities.formatDate(new Date(), ConfigService.getTimezone(), 'dd MMM yyyy HH:mm');
    var netPay = Number(rec.net_pay) || 0;

    return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Payslip — ' + esc_(period) +
      '</title><style>' +
      '@page{size:A4;margin:16mm}' +
      'body{font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1a1a1a;margin:0;padding:24px;background:#fff}' +
      '.sheet{max-width:780px;margin:0 auto}' +
      '.header{border-bottom:3px solid #2d5a3d;padding-bottom:16px;margin-bottom:20px}' +
      '.company{font-size:22px;font-weight:700;color:#2d5a3d;margin:0}' +
      '.address{font-size:12px;color:#5a6b5e;margin-top:4px;white-space:pre-line}' +
      '.title-row{display:flex;justify-content:space-between;align-items:flex-end;margin:18px 0 12px}' +
      '.title{font-size:18px;font-weight:600;margin:0}' +
      '.period{font-size:13px;color:#5a6b5e}' +
      '.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 24px;margin-bottom:18px}' +
      '.field label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;margin-bottom:2px}' +
      '.field div{font-size:14px;font-weight:500}' +
      '.section{margin-top:18px}' +
      '.section h3{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#2d5a3d;margin:0 0 8px;border-bottom:1px solid #e5e7eb;padding-bottom:4px}' +
      'table{width:100%;border-collapse:collapse;font-size:13px}' +
      'th,td{padding:8px 10px;border-bottom:1px solid #eef0f2;text-align:left}' +
      'th{font-size:11px;text-transform:uppercase;color:#6b7280;font-weight:600}' +
      '.num{text-align:right;font-variant-numeric:tabular-nums}' +
      '.totals td{font-weight:700;border-top:2px solid #2d5a3d}' +
      '.net-box{margin-top:20px;padding:16px 18px;background:#f3faf5;border:1px solid #c8e6d0;border-radius:8px}' +
      '.net-label{font-size:12px;color:#2d5a3d;text-transform:uppercase;letter-spacing:.05em}' +
      '.net-value{font-size:28px;font-weight:700;color:#1f4330;margin-top:4px}' +
      '.words{font-size:12px;color:#4b5563;margin-top:6px;font-style:italic}' +
      '.statutory{margin-top:16px;font-size:12px;color:#374151}' +
      '.footer{margin-top:28px;padding-top:12px;border-top:1px dashed #d1d5db;font-size:11px;color:#6b7280}' +
      '@media print{body{padding:0}.net-box{-webkit-print-color-adjust:exact;print-color-adjust:exact}}' +
      '</style></head><body><div class="sheet">' +
      '<header class="header"><h1 class="company">' + esc_(company) + '</h1>' +
      (companyAddress ? '<div class="address">' + esc_(companyAddress) + '</div>' : '') +
      '</header>' +
      '<div class="title-row"><h2 class="title">Salary Payslip</h2><div class="period">' + esc_(period) + '</div></div>' +
      '<div class="grid">' +
      field_('Employee name', name) + field_('Employee ID', rec.employee_id) +
      field_('Designation', desig) + field_('Department', dept) +
      field_('Location', location) + field_('Date of joining', joiningDate) +
      field_('Days in month', dim) + field_('Effective work days', paidDays) +
      field_('Working days', workingDays) + field_('LOP days', lopDays) +
      '</div>' +
      '<div class="section"><h3>Earnings</h3><table><thead><tr><th>Component</th><th class="num">Amount (₹)</th></tr></thead><tbody>' +
      (earnRows || '<tr><td colspan="2">None</td></tr>') +
      '<tr class="totals"><td>Total earnings</td><td class="num">' + moneyDisplay_(rec.gross_earnings) + '</td></tr></tbody></table></div>' +
      '<div class="section"><h3>Deductions</h3><table><thead><tr><th>Component</th><th class="num">Amount (₹)</th></tr></thead><tbody>' +
      (dedRows || '<tr><td colspan="2">None</td></tr>') +
      '<tr class="totals"><td>Total deductions</td><td class="num">' + moneyDisplay_(rec.total_deductions) + '</td></tr></tbody></table></div>' +
      '<div class="net-box"><div class="net-label">Net pay</div><div class="net-value">₹ ' + moneyDisplay_(netPay) + '</div>' +
      '<div class="words">' + esc_(amountInWords_(netPay)) + '</div></div>' +
      '<div class="statutory"><strong>Bank &amp; statutory details</strong><br>' +
      'Bank: ' + esc_(bankName || '—') + ' · Account: ' + esc_(bankMasked || '—') + '<br>' +
      'PAN: ' + esc_(pan || '—') + ' · PF: ' + esc_(pfNumber || '—') + ' · UAN: ' + esc_(uan || '—') +
      (esi ? ' · ESI: ₹ ' + esc_(esi) : '') +
      '</div>' +
      '<div class="footer">This is a system-generated payslip. Generated on ' + esc_(generated) +
      '. Confidential — for the intended recipient only.</div>' +
      '</div></body></html>';
  }

  function field_(label, value) {
    return '<div class="field"><label>' + esc_(label) + '</label><div>' + esc_(value == null || value === '' ? '—' : value) + '</div></div>';
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
    findReusableDocument: findReusableDocument,
    dedupePayslipsByRun: dedupePayslipsByRun,
    enrichPayslipDoc: enrichPayslipDoc_
  };
})();
