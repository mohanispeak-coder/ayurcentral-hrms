/**
 * Candidate offer letter email (plain text + simple PDF) when application reaches OFFER.
 */
var HRMS = HRMS || {};

var AtsOfferLetterService = (function () {
  function trim_(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
  }

  function company_() {
    try {
      return ConfigService.getCompanyName();
    } catch (e) {
      return 'AyurCentral HRMS';
    }
  }

  function buildContent_(candidate, job, application) {
    var map = {
      '{{candidate_name}}': trim_(candidate.full_name) || 'Candidate',
      '{{job_title}}': trim_(job.title) || 'Role',
      '{{company}}': company_(),
      '{{application_id}}': trim_(application.application_id)
    };
    if (typeof HrmsContentTemplateService !== 'undefined' && HrmsContentTemplateService.render) {
      return HrmsContentTemplateService.render('ats_offer', map);
    }
    return {
      subject: 'Offer of employment - ' + map['{{job_title}}'],
      body: [
        'Dear ' + map['{{candidate_name}}'] + ',',
        '',
        'Congratulations. We are pleased to offer you the position of ' + map['{{job_title}}'] + '.',
        '',
        'Please find your offer letter attached as a PDF.',
        '',
        'Regards,',
        'Human Resources',
        map['{{company}}']
      ].join('\n')
    };
  }

  function buildPdfBlob_(candidate, job, application, content) {
    var html = '<html><body style="font-family:Arial,sans-serif;padding:24px">' +
      '<h2>Offer of employment</h2>' +
      '<p><strong>' + company_() + '</strong></p>' +
      '<p>Candidate: ' + trim_(candidate.full_name) + '</p>' +
      '<p>Position: ' + trim_(job.title) + '</p>' +
      '<p>Application: ' + trim_(application.application_id) + '</p>' +
      '<hr/>' +
      '<pre style="white-space:pre-wrap;font-family:Arial,sans-serif">' +
      String(content.body || '').replace(/</g, '&lt;') +
      '</pre></body></html>';
    var blob = HtmlService.createHtmlOutput(html).getBlob().setName('Offer_Letter.pdf');
    try {
      blob = blob.getAs('application/pdf');
    } catch (ignore) {}
    blob.setName('Offer_Letter_' + trim_(application.application_id) + '.pdf');
    return blob;
  }

  function sendOfferLetter_(candidate, job, application) {
    var email = trim_(candidate.email);
    if (!email) {
      return { ok: false, status: 'NO_EMAIL', error: 'Candidate email is missing.' };
    }
    var content = buildContent_(candidate, job, application);
    var pdf = buildPdfBlob_(candidate, job, application, content);
    try {
      MailApp.sendEmail({
        to: email,
        subject: content.subject,
        body: content.body,
        attachments: [pdf]
      });
      try {
        AuditService.log('ATS_OFFER_LETTER', 'Application', application.application_id,
          'Offer letter emailed to ' + email, '');
      } catch (ignoreAudit) {}
      return { ok: true, status: 'SENT', to: email };
    } catch (e) {
      return { ok: false, status: 'FAILED', error: String(e.message || e) };
    }
  }

  function maybeSendOnStage_(targetStage, application, job, candidate) {
    if (String(targetStage).toUpperCase() !== ATS.STAGE.OFFER) return null;
    if (!candidate) candidate = AtsRepository.findCandidate(application.candidate_id);
    if (!candidate || !job) return null;
    return sendOfferLetter_(candidate, job, application);
  }

  return {
    sendOfferLetter: sendOfferLetter_,
    maybeSendOnStage: maybeSendOnStage_
  };
})();
