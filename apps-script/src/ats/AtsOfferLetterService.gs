/**
 * Offer letter email + PDF (manual send from HIRED hire workflow).
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

  function buildEmail_(candidate, job, application) {
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
      subject: 'Offer of employment - ' + map['{{job_title}}'] + ' - ' + map['{{company}}'],
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

  function sendOfferLetterForHire_(session, applicationId) {
    var ctx = AtsHireWorkflowService.loadHireContext(session, applicationId);
    var appFresh = AtsRepository.findApplication(applicationId);
    AtsHireWorkflowService.assertHireCompensationReady(appFresh || ctx.application);
    var email = trim_(ctx.candidate.email);
    if (!email) throw validationError_('Candidate email is missing.');
    var appRow = appFresh || ctx.application;
    var content = buildEmail_(ctx.candidate, ctx.job, appRow);
    var pdf = AtsLetterPdfService.buildOfferPdf(ctx.candidate, ctx.job, appRow);
    MailApp.sendEmail({
      to: email,
      subject: content.subject,
      body: content.body,
      attachments: [pdf]
    });
    var now = new Date();
    AtsRepository.updateApplication(applicationId, {
      offer_letter_sent_at: now,
      updated_at: now
    });
    try {
      AuditService.log(ATS.AUDIT.HIRE_OFFER, 'Application', applicationId,
        'Offer letter emailed to ' + email, '');
    } catch (ignore) {}
    return { ok: true, status: 'SENT', to: email, sent_at: now.toISOString() };
  }

  /** Legacy hook - offer letters are sent manually from the HIRED workflow. */
  function maybeSendOnStage_(targetStage, application, job, candidate) {
    return null;
  }

  return {
    sendOfferLetterForHire: sendOfferLetterForHire_,
    maybeSendOnStage: maybeSendOnStage_
  };
})();
