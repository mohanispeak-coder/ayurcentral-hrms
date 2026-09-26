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

  function buildLetterHtml_(opts) {
    opts = opts || {};
    var title = opts.title || 'Letter';
    var ref = opts.ref || '';
    var bodyHtml = opts.bodyHtml || '';
    return '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' +
      'body{font-family:Arial,Helvetica,sans-serif;color:#222;margin:0;padding:28px 32px;font-size:12px;line-height:1.55}' +
      '.hdr{border-bottom:2px solid #0d4a38;padding-bottom:12px;margin-bottom:18px}' +
      '.co{font-size:18px;font-weight:700;color:#0d4a38}' +
      '.addr{font-size:10px;color:#555;margin-top:4px}' +
      'h1{font-size:16px;color:#0d4a38;margin:16px 0 12px;text-transform:uppercase;letter-spacing:.04em}' +
      '.meta{font-size:11px;margin-bottom:14px}' +
      '.sign{margin-top:28px}' +
      '</style></head><body>' +
      '<div class="hdr"><div class="co">' + esc_(company_()) + '</div>' +
      (companyAddress_() ? '<div class="addr">' + esc_(companyAddress_()) + '</div>' : '') +
      '</div>' +
      '<h1>' + esc_(title) + '</h1>' +
      '<div class="meta">Date: ' + esc_(fmtDate_(new Date())) +
      (ref ? ' &nbsp;|&nbsp; Ref: ' + esc_(ref) : '') + '</div>' +
      bodyHtml +
      '<div class="sign"><p>For ' + esc_(company_()) + '</p>' +
      '<p><strong>Authorised Signatory</strong><br>Human Resources Department</p>' +
      '<p class="addr">This is a system-generated document and does not require a physical signature.</p></div>' +
      '</body></html>';
  }

  function offerBodyHtml_(candidate, job, application, comp) {
    comp = comp || {};
    return '<p>Dear ' + esc_(trim_(candidate.full_name) || 'Candidate') + ',</p>' +
      '<p>With reference to your application <strong>' + esc_(application.application_id) + '</strong>, ' +
      'we are pleased to offer you employment with <strong>' + esc_(company_()) + '</strong> ' +
      'in the position of <strong>' + esc_(trim_(job.title) || 'the role') + '</strong>' +
      (trim_(job.department) ? ' (' + esc_(job.department) + ')' : '') + '.</p>' +
      '<p><strong>Compensation</strong></p><ul>' +
      '<li>Salary structure: ' + esc_(comp.structure_name || comp.structure_id || '-') + '</li>' +
      '<li>Monthly CTC (Cost to Company): Rs. ' + esc_(money_(comp.monthly_salary)) + '</li>' +
      '<li>Location: ' + esc_(trim_(job.location) || trim_(candidate.location) || 'As communicated by HR') + '</li>' +
      '</ul>' +
      '<p>This offer is subject to satisfactory verification of documents, background checks, and company policies. ' +
      'Please confirm acceptance in writing. Your formal appointment letter will follow separately.</p>' +
      '<p>We look forward to welcoming you to our team.</p>';
  }

  function appointmentBodyHtml_(candidate, job, application, comp) {
    comp = comp || {};
    return '<p>Dear ' + esc_(trim_(candidate.full_name) || 'Candidate') + ',</p>' +
      '<p>Further to our offer of employment, this is to confirm your <strong>appointment</strong> ' +
      'with <strong>' + esc_(company_()) + '</strong> as <strong>' + esc_(trim_(job.title) || 'the role') + '</strong>.</p>' +
      '<p><strong>Terms of appointment</strong></p><ul>' +
      '<li>Employee name: ' + esc_(trim_(candidate.full_name)) + '</li>' +
      '<li>Designation: ' + esc_(trim_(job.title)) + '</li>' +
      '<li>Department: ' + esc_(trim_(job.department) || '-') + '</li>' +
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
    var html = buildLetterHtml_({
      title: 'Offer of Employment',
      ref: application.application_id,
      bodyHtml: offerBodyHtml_(candidate, job, application, comp)
    });
    return htmlToPdf_(html, 'Offer_Letter_' + trim_(application.application_id) + '.pdf');
  }

  function buildAppointmentPdf_(candidate, job, application) {
    var comp = compFromApplication_(application);
    var html = buildLetterHtml_({
      title: 'Appointment Letter',
      ref: application.application_id,
      bodyHtml: appointmentBodyHtml_(candidate, job, application, comp)
    });
    return htmlToPdf_(html, 'Appointment_Letter_' + trim_(application.application_id) + '.pdf');
  }

  return {
    buildOfferPdf: buildOfferPdf_,
    buildAppointmentPdf: buildAppointmentPdf_
  };
})();
