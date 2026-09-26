/**
 * Corporate-style offer / appointment letter PDFs for ATS hire workflow.
 */
var AtsLetterPdfService = (function () {
  function trim_(v) {
    return v == null ? '' : String(v).trim();
  }

  function company_() {
    try {
      return ConfigService.getCompanyName();
    } catch (e) {
      return 'AyurCentral HRMS';
    }
  }

  function companyAddress_() {
    try {
      return trim_(ConfigService.getSetting('company_address', ''));
    } catch (e) {
      return '';
    }
  }

  function fmtDate_(d) {
    if (!d) d = new Date();
    if (Object.prototype.toString.call(d) === '[object Date]' && !isNaN(d.getTime())) {
      return Utilities.formatDate(d, ConfigService.getTimezone(), 'dd MMMM yyyy');
    }
    return trim_(d);
  }

  function money_(n) {
    var x = Number(n);
    if (!isFinite(x)) x = 0;
    return Math.round(x).toLocaleString('en-IN');
  }

  function esc_(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function resolveLetterBranding_(application) {
    var vertical = '';
    var structureId = trim_(application.hire_salary_structure_id);
    if (structureId) {
      var row = DbService.findOne(HRMS.SHEETS.SALARY_STRUCTURES, { salary_structure_id: structureId });
      if (row && trim_(row.vertical_name)) vertical = trim_(row.vertical_name).toUpperCase();
    }
    var brandTitle = company_();
    var addr = companyAddress_();
    if (vertical && typeof EmployeeRepository !== 'undefined' && EmployeeRepository.listVerticalCatalog) {
      var catalog = EmployeeRepository.listVerticalCatalog() || [];
      for (var i = 0; i < catalog.length; i++) {
        if (String(catalog[i].vertical_name || '').toUpperCase() !== vertical) continue;
        if (catalog[i].legal_name) brandTitle = catalog[i].legal_name;
        var parts = [];
        if (catalog[i].address_line1) parts.push(String(catalog[i].address_line1).trim());
        if (catalog[i].address_line2) parts.push(String(catalog[i].address_line2).trim());
        if (parts.length) addr = parts.join(', ');
        break;
      }
    }
    var payslipAddr = (typeof HRMS !== 'undefined' && HRMS.PAYSLIP_ADDRESS_BY_VERTICAL)
      ? HRMS.PAYSLIP_ADDRESS_BY_VERTICAL[vertical] : '';
    if (payslipAddr) addr = payslipAddr;
    var logoSrc = '';
    if (typeof PayslipLogoService !== 'undefined' && PayslipLogoService.dataUriForVertical) {
      logoSrc = PayslipLogoService.dataUriForVertical(vertical);
    }
    return {
      vertical: vertical,
      brandTitle: brandTitle,
      legalName: brandTitle,
      address: addr,
      logoSrc: logoSrc
    };
  }

  function buildLetterHtml_(opts) {
    opts = opts || {};
    var title = opts.title || 'Letter';
    var ref = opts.ref || '';
    var bodyHtml = opts.bodyHtml || '';
    var brand = opts.branding || {};
    var brandTitle = brand.brandTitle || company_();
    var addr = brand.address || companyAddress_();
    var logoSrc = brand.logoSrc || '';
    var logoHtml = logoSrc
      ? '<img src="' + esc_(logoSrc) + '" alt="Logo" style="height:44px;max-width:160px;display:block;margin-bottom:6px"/>'
      : '';
    return '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' +
      'body{font-family:Arial,Helvetica,sans-serif;color:#222;margin:0;padding:28px 32px;font-size:12px;line-height:1.55}' +
      '.hdr{border-bottom:2px solid #0d4a38;padding-bottom:12px;margin-bottom:18px}' +
      '.co{font-size:18px;font-weight:700;color:#0d4a38}' +
      '.addr{font-size:10px;color:#555;margin-top:4px;max-width:480px}' +
      'h1{font-size:16px;color:#0d4a38;margin:16px 0 12px;text-transform:uppercase;letter-spacing:.04em}' +
      '.meta{font-size:11px;margin-bottom:14px}' +
      '.sign{margin-top:28px}' +
      'table.sal{width:100%;border-collapse:collapse;margin:10px 0 14px;font-size:11px}' +
      'table.sal th,table.sal td{border:1px solid #ccc;padding:5px 8px;text-align:left}' +
      'table.sal th{background:#f4f6f5;font-weight:600}' +
      'table.sal td.amt{text-align:right;font-variant-numeric:tabular-nums}' +
      '</style></head><body>' +
      '<div class="hdr">' + logoHtml +
      '<div class="co">' + esc_(brandTitle) + '</div>' +
      (addr ? '<div class="addr">' + esc_(addr) + '</div>' : '') +
      '</div>' +
      '<h1>' + esc_(title) + '</h1>' +
      '<div class="meta">Date: ' + esc_(fmtDate_(new Date())) +
      (ref ? ' &nbsp;|&nbsp; Ref: ' + esc_(ref) : '') + '</div>' +
      bodyHtml +
      '<div class="sign"><p>For ' + esc_(brandTitle) + '</p>' +
      '<p><strong>Authorised Signatory</strong><br>Human Resources Department</p>' +
      '<p class="addr">This is a system-generated document and does not require a physical signature.</p></div>' +
      '</body></html>';
  }

  function salaryBreakupTableHtml_(application) {
    var structureId = trim_(application.hire_salary_structure_id);
    var ctc = Number(application.hire_monthly_salary);
    if (!structureId || !isFinite(ctc) || ctc <= 0) return '';
    var components = [];
    if (typeof CompensationService !== 'undefined' && CompensationService.expandTypeTemplateComponents) {
      components = CompensationService.expandTypeTemplateComponents(structureId, ctc) || [];
    }
    if (!components.length) return '';
    var calc = null;
    if (typeof PayrollEngine !== 'undefined' && PayrollEngine.calculateEmployee) {
      calc = PayrollEngine.calculateEmployee({
        structure: { salary_structure_id: structureId },
        components: components,
        inputs: { working_days: 30, paid_days: 30 },
        settings: { payroll_round: 'NEAREST_RUPEE' },
        employee: { employee_id: 'OFFER' }
      });
    }
    var lines = [];
    if (calc && calc.component_breakdown) {
      try {
        var parsed = JSON.parse(calc.component_breakdown);
        lines = parsed.lines || [];
      } catch (ignore) {}
    }
    if (!lines.length) return '';
    var earnings = [];
    var deductions = [];
    lines.forEach(function (ln) {
      var kind = String(ln.component_kind || '').toUpperCase();
      if (kind === 'EMPLOYER') return;
      var row = '<tr><td>' + esc_(ln.component_name || ln.component_code) + '</td>' +
        '<td class="amt">Rs. ' + esc_(money_(ln.contractual != null ? ln.contractual : ln.amount)) + '</td></tr>';
      if (kind === 'DEDUCTION') deductions.push(row);
      else earnings.push(row);
    });
    var html = '<p><strong>Monthly salary breakup</strong> (based on selected structure and CTC)</p>' +
      '<table class="sal"><thead><tr><th>Component</th><th class="amt">Amount (Rs.)</th></tr></thead><tbody>';
    if (earnings.length) {
      html += '<tr><td colspan="2"><strong>Earnings</strong></td></tr>' + earnings.join('');
    }
    if (deductions.length) {
      html += '<tr><td colspan="2"><strong>Deductions</strong></td></tr>' + deductions.join('');
    }
    html += '<tr><td><strong>Net pay (indicative)</strong></td><td class="amt"><strong>Rs. ' +
      esc_(money_(calc.net_pay)) + '</strong></td></tr>';
    html += '</tbody></table>' +
      '<p class="addr">Breakup is computed from the salary structure template at full-month attendance. ' +
      'Actual payroll may vary with attendance, statutory rules, and revisions.</p>';
    return html;
  }

  function offerBodyHtml_(candidate, job, application, comp, branding) {
    comp = comp || {};
    branding = branding || {};
    var org = branding.brandTitle || company_();
    return '<p>Dear ' + esc_(trim_(candidate.full_name) || 'Candidate') + ',</p>' +
      '<p>With reference to your application <strong>' + esc_(application.application_id) + '</strong>, ' +
      'we are pleased to offer you employment with <strong>' + esc_(org) + '</strong> ' +
      'in the position of <strong>' + esc_(trim_(job.title) || 'the role') + '</strong>' +
      (trim_(job.department) ? ' (' + esc_(job.department) + ')' : '') + '.</p>' +
      '<p><strong>Compensation summary</strong></p><ul>' +
      '<li>Salary structure: ' + esc_(comp.structure_name || comp.structure_id || '-') + '</li>' +
      '<li>Monthly CTC (Cost to Company): Rs. ' + esc_(money_(comp.monthly_salary)) + '</li>' +
      '<li>Location: ' + esc_(trim_(job.location) || trim_(candidate.location) || 'As communicated by HR') + '</li>' +
      '</ul>' +
      salaryBreakupTableHtml_(application) +
      '<p>This offer is subject to satisfactory verification of documents, background checks, and company policies. ' +
      'Please confirm acceptance in writing. Your formal appointment letter will follow separately.</p>' +
      '<p>We look forward to welcoming you to our team.</p>';
  }

  function fmtJoiningDate_(application) {
    var raw = trim_(application.hire_joining_date);
    if (!raw) return '-';
    try {
      var parts = raw.split('-');
      if (parts.length === 3) {
        var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        if (!isNaN(d.getTime())) return fmtDate_(d);
      }
    } catch (ignore) {}
    return raw;
  }

  function appointmentBodyHtml_(candidate, job, application, comp, branding) {
    comp = comp || {};
    branding = branding || {};
    var org = branding.brandTitle || company_();
    return '<p>Dear ' + esc_(trim_(candidate.full_name) || 'Candidate') + ',</p>' +
      '<p>Further to our offer of employment, this is to confirm your <strong>appointment</strong> ' +
      'with <strong>' + esc_(org) + '</strong> as <strong>' + esc_(trim_(job.title) || 'the role') + '</strong>.</p>' +
      '<p><strong>Terms of appointment</strong></p><ul>' +
      '<li>Employee name: ' + esc_(trim_(candidate.full_name)) + '</li>' +
      '<li>Designation: ' + esc_(trim_(job.title)) + '</li>' +
      '<li>Department: ' + esc_(trim_(job.department) || '-') + '</li>' +
      '<li>Date of joining: ' + esc_(fmtJoiningDate_(application)) + '</li>' +
      '<li>Salary structure: ' + esc_(comp.structure_name || '-') + '</li>' +
      '<li>Monthly CTC: Rs. ' + esc_(money_(comp.monthly_salary)) + '</li>' +
      '<li>Place of work: ' + esc_(trim_(job.location) || 'As per company requirement') + '</li>' +
      '</ul>' +
      '<p>You are required to comply with all applicable company policies, code of conduct, and statutory obligations. ' +
      'Your employment may be governed by the terms and conditions shared during onboarding.</p>' +
      '<p>We wish you a successful career with us.</p>';
  }

  function htmlToPdf_(html, fileName) {
    fileName = fileName || 'letter.pdf';
    try {
      var blob = HtmlService.createHtmlOutput(html).setWidth(794).setHeight(1123).getAs('application/pdf');
      if (blob && blob.getBytes && blob.getBytes().length) return blob.setName(fileName);
    } catch (ignore) {}
    return HtmlService.createHtmlOutput(html).getBlob().setName(fileName.replace(/\.pdf$/i, '.html'));
  }

  function compFromApplication_(application) {
    var structureId = trim_(application.hire_salary_structure_id);
    var name = structureId;
    if (typeof AtsHireWorkflowService !== 'undefined' && AtsHireWorkflowService.structureLabel) {
      name = AtsHireWorkflowService.structureLabel(structureId);
    }
    return {
      structure_id: structureId,
      structure_name: name,
      monthly_salary: application.hire_monthly_salary
    };
  }

  function buildOfferPdf_(candidate, job, application) {
    var comp = compFromApplication_(application);
    var branding = resolveLetterBranding_(application);
    var html = buildLetterHtml_({
      title: 'Offer of Employment',
      ref: application.application_id,
      branding: branding,
      bodyHtml: offerBodyHtml_(candidate, job, application, comp, branding)
    });
    return htmlToPdf_(html, 'Offer_Letter_' + trim_(application.application_id) + '.pdf');
  }

  function buildAppointmentPdf_(candidate, job, application) {
    var comp = compFromApplication_(application);
    var branding = resolveLetterBranding_(application);
    var html = buildLetterHtml_({
      title: 'Appointment Letter',
      ref: application.application_id,
      branding: branding,
      bodyHtml: appointmentBodyHtml_(candidate, job, application, comp, branding)
    });
    return htmlToPdf_(html, 'Appointment_Letter_' + trim_(application.application_id) + '.pdf');
  }

  return {
    buildOfferPdf: buildOfferPdf_,
    buildAppointmentPdf: buildAppointmentPdf_
  };
})();
