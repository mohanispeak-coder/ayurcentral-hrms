/**
 * Manual appointment letter email when HR triggers from HIRED workflow.
 */
var AtsAppointmentLetterService = (function () {
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

  function buildEmail_(candidate, job, application) {
    var map = {
      '{{candidate_name}}': trim_(candidate.full_name) || 'Candidate',
      '{{job_title}}': trim_(job.title) || 'Role',
      '{{company}}': company_(),
      '{{application_id}}': trim_(application.application_id)
    };
    if (typeof HrmsContentTemplateService !== 'undefined' && HrmsContentTemplateService.render) {
      var rendered = HrmsContentTemplateService.render('ats_appointment', map);
      if (rendered) return rendered;
    }
    return {
      subject: 'Appointment letter - ' + map['{{job_title}}'] + ' - ' + map['{{company}}'],
      body: [
        'Dear ' + map['{{candidate_name}}'] + ',',
        '',
        'Please find attached your appointment letter for the position of ' + map['{{job_title}}'] + '.',
        '',
        'Regards,',
        'Human Resources',
        map['{{company}}']
      ].join('\n')
    };
  }

  function sendAppointmentLetter_(session, applicationId) {
    var ctx = AtsHireWorkflowService.loadHireContext(session, applicationId);
    var appFresh = AtsRepository.findApplication(applicationId);
    AtsHireWorkflowService.assertHireCompensationReady(appFresh || ctx.application);
    var email = trim_(ctx.candidate.email);
    if (!email) throw validationError_('Candidate email is missing.');
    var appRow = appFresh || ctx.application;
    var content = buildEmail_(ctx.candidate, ctx.job, appRow);
    var pdf = AtsLetterPdfService.buildAppointmentPdf(ctx.candidate, ctx.job, appRow);
    MailApp.sendEmail({
      to: email,
      subject: content.subject,
      body: content.body,
      attachments: [pdf]
    });
    var now = new Date();
    AtsRepository.updateApplication(applicationId, {
      appointment_letter_sent_at: now,
      updated_at: now
    });
    try {
      AuditService.log(ATS.AUDIT.HIRE_APPOINTMENT, 'Application', applicationId,
        'Appointment letter emailed to ' + email, '');
    } catch (ignore) {}
    return { ok: true, status: 'SENT', to: email, sent_at: now.toISOString() };
  }

  return {
    sendAppointmentLetter: sendAppointmentLetter_
  };
})();
