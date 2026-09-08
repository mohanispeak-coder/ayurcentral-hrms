/**
 * Module adapters — existing Leave/Payroll (and future PMS/ATS) call these
 * AFTER business commits succeed. Do not call from inside LockService.
 * Leave/Payroll files are not modified in this stream; wire later using
 * docs/NOTIFICATIONS_INTEGRATION_NOTES.md.
 */
var HRMS = HRMS || {};

var NotificationLeaveAdapter = (function () {
  function employeeHint_(emp) {
    emp = emp || {};
    return {
      employee_id: emp.employee_id,
      email: emp.work_email || emp.email,
      display_name: emp.display_name
    };
  }

  function notifySubmitted(leaveRequest, employee, manager) {
    try {
      var payload = NotificationEngine.payloads.leaveSubmitted(leaveRequest, employeeHint_(employee), employeeHint_(manager));
      payload.force_email = false;
      payload.force_in_app = true;
      return NotificationService.createNotification(payload);
    } catch (e) {
      Logger.log('NotificationLeaveAdapter.notifySubmitted: ' + (e.message || e));
      return { ok: false, error: String(e.message || e) };
    }
  }

  function notifyApproved(leaveRequest, employee) {
    try {
      var payload = NotificationEngine.payloads.leaveApproved(leaveRequest, employeeHint_(employee));
      payload.force_email = false;
      payload.force_in_app = true;
      return NotificationService.createNotification(payload);
    } catch (e) {
      Logger.log('NotificationLeaveAdapter.notifyApproved: ' + (e.message || e));
      return { ok: false, error: String(e.message || e) };
    }
  }

  function notifyRejected(leaveRequest, employee) {
    try {
      var payload = NotificationEngine.payloads.leaveRejected(leaveRequest, employeeHint_(employee));
      payload.force_email = false;
      payload.force_in_app = true;
      return NotificationService.createNotification(payload);
    } catch (e) {
      Logger.log('NotificationLeaveAdapter.notifyRejected: ' + (e.message || e));
      return { ok: false, error: String(e.message || e) };
    }
  }

  /**
   * Cancel: employee always; manager when the request had been SUBMITTED.
   */
  function notifyCancelled(leaveRequest, employee, manager, actorName) {
    var results = [];
    try {
      var empReq = {
        leave_request_id: leaveRequest.leave_request_id,
        employee_id: leaveRequest.employee_id,
        display_name: employee && employee.display_name,
        start_date: leaveRequest.start_date,
        end_date: leaveRequest.end_date
      };
      results.push(NotificationService.createNotification(
        NotificationEngine.payloads.leaveCancelled(empReq, employeeHint_(employee), actorName)
      ));
    } catch (e) {
      Logger.log('NotificationLeaveAdapter.notifyCancelled employee: ' + (e.message || e));
    }
    var prev = String(leaveRequest && leaveRequest.previous_status || leaveRequest && leaveRequest.status || '').toUpperCase();
    if (manager && manager.employee_id && prev === 'SUBMITTED' &&
        String(manager.employee_id) !== String(employee && employee.employee_id)) {
      try {
        var mgrPayload = NotificationEngine.payloads.leaveCancelled({
          leave_request_id: leaveRequest.leave_request_id,
          employee_id: leaveRequest.employee_id,
          display_name: employee && employee.display_name,
          start_date: leaveRequest.start_date,
          end_date: leaveRequest.end_date
        }, employeeHint_(manager), actorName);
        results.push(NotificationService.createNotification(mgrPayload));
      } catch (e2) {
        Logger.log('NotificationLeaveAdapter.notifyCancelled manager: ' + (e2.message || e2));
      }
    }
    return { ok: true, results: results };
  }

  return {
    notifySubmitted: notifySubmitted,
    notifyApproved: notifyApproved,
    notifyRejected: notifyRejected,
    notifyCancelled: notifyCancelled
  };
})();

var NotificationPayrollAdapter = (function () {
  function hrRecipients_() {
    return NotificationService.listHrAdminRecipients();
  }

  function notifyReadyForReview(run) {
    try {
      var inputs = hrRecipients_().map(function (r) {
        return NotificationEngine.payloads.payrollReadyReview(run, r);
      });
      return NotificationService.createNotifications(inputs);
    } catch (e) {
      Logger.log('NotificationPayrollAdapter.notifyReadyForReview: ' + (e.message || e));
      return { ok: false, error: String(e.message || e) };
    }
  }

  function notifyApproved(run) {
    try {
      var inputs = hrRecipients_().map(function (r) {
        return NotificationEngine.payloads.payrollApproved(run, r);
      });
      return NotificationService.createNotifications(inputs);
    } catch (e) {
      Logger.log('NotificationPayrollAdapter.notifyApproved: ' + (e.message || e));
      return { ok: false, error: String(e.message || e) };
    }
  }

  function notifyLocked(run) {
    try {
      var inputs = hrRecipients_().map(function (r) {
        return NotificationEngine.payloads.payrollLocked(run, r);
      });
      return NotificationService.createNotifications(inputs);
    } catch (e) {
      Logger.log('NotificationPayrollAdapter.notifyLocked: ' + (e.message || e));
      return { ok: false, error: String(e.message || e) };
    }
  }

  /**
   * Per-employee payslip notice. Call AFTER lock + payslip files.
   * Subjects never include net pay.
   * @param {Object} run
   * @param {Array.<Object>} records PayrollRecords rows
   * @param {Object=} employeeMap employee_id → { employee_id, work_email, display_name }
   */
  function notifyPayslipsAvailable(run, records, employeeMap) {
    try {
      employeeMap = employeeMap || {};
      var inputs = [];
      (records || []).forEach(function (row) {
        var emp = employeeMap[row.employee_id] || NotificationService.resolveRecipient({ employee_id: row.employee_id });
        if (!emp) return;
        var payload = NotificationEngine.payloads.payslipAvailable(row, emp, run);
        if (NotificationEngine.payslipContainsNet(payload.title) ||
            NotificationEngine.payslipContainsNet(payload.email_subject)) {
          Logger.log('Skipped payslip notification — subject contained net pay');
          return;
        }
        inputs.push(payload);
      });
      return NotificationService.createNotifications(inputs);
    } catch (e) {
      Logger.log('NotificationPayrollAdapter.notifyPayslipsAvailable: ' + (e.message || e));
      return { ok: false, error: String(e.message || e) };
    }
  }

  return {
    notifyReadyForReview: notifyReadyForReview,
    notifyApproved: notifyApproved,
    notifyLocked: notifyLocked,
    notifyPayslipsAvailable: notifyPayslipsAvailable
  };
})();

var NotificationPmsAdapter = (function () {
  function safe_(name, fn) {
    try {
      return fn();
    } catch (e) {
      Logger.log('NotificationPmsAdapter.' + name + ': ' + (e.message || e));
      return { ok: false, error: String(e.message || e) };
    }
  }

  function notifyCycleOpen(cycle, recipients) {
    return safe_('notifyCycleOpen', function () {
      var inputs = (recipients || []).map(function (r) {
        return NotificationEngine.payloads.pmsCycleOpen(cycle, r);
      });
      return NotificationService.createNotifications(inputs);
    });
  }

  function notifySelfAssessmentDue(cycle, recipient) {
    return safe_('notifySelfAssessmentDue', function () {
      return NotificationService.createNotification(
        NotificationEngine.payloads.pmsSelfAssessmentDue(cycle, recipient)
      );
    });
  }

  function notifyManagerReviewPending(cycle, manager, employeeName) {
    return safe_('notifyManagerReviewPending', function () {
      return NotificationService.createNotification(
        NotificationEngine.payloads.pmsManagerReviewPending(cycle, manager, employeeName)
      );
    });
  }

  function notifyFinalized(cycle, recipient) {
    return safe_('notifyFinalized', function () {
      return NotificationService.createNotification(
        NotificationEngine.payloads.pmsFinalized(cycle, recipient)
      );
    });
  }

  return {
    notifyCycleOpen: notifyCycleOpen,
    notifySelfAssessmentDue: notifySelfAssessmentDue,
    notifyManagerReviewPending: notifyManagerReviewPending,
    notifyFinalized: notifyFinalized
  };
})();

var NotificationAtsAdapter = (function () {
  function safe_(name, fn) {
    try {
      return fn();
    } catch (e) {
      Logger.log('NotificationAtsAdapter.' + name + ': ' + (e.message || e));
      return { ok: false, error: String(e.message || e) };
    }
  }

  function notifyInternal(type, application, recipients) {
    return safe_('notifyInternal', function () {
      var inputs = (recipients || []).map(function (r) {
        return NotificationEngine.payloads.atsInternal(type, application, r);
      });
      return NotificationService.createNotifications(inputs);
    });
  }

  function notifyNewApplication(application, recipients) {
    return notifyInternal(NotificationEngine.TYPE.ATS_NEW_APPLICATION, application, recipients);
  }

  function notifyShortlisted(application, recipients) {
    return notifyInternal(NotificationEngine.TYPE.ATS_SHORTLISTED, application, recipients);
  }

  function notifyInterviewScheduled(application, recipients) {
    return notifyInternal(NotificationEngine.TYPE.ATS_INTERVIEW_SCHEDULED, application, recipients);
  }

  function notifyFeedbackPending(application, recipients) {
    return notifyInternal(NotificationEngine.TYPE.ATS_FEEDBACK_PENDING, application, recipients);
  }

  function notifySelected(application, recipients) {
    return notifyInternal(NotificationEngine.TYPE.ATS_SELECTED, application, recipients);
  }

  /**
   * Candidate-facing MailApp only. Never writes NotificationInbox.
   * Do not pass internal HRMS URLs, employee_id, or salary.
   */
  function notifyCandidate(type, candidate, extra) {
    return safe_('notifyCandidate', function () {
      var built = NotificationEngine.payloads.atsCandidateEmail(type, candidate, extra || {});
      if (!built.ok) throw validationError_(built.errors.join(' '));
      return NotificationService.sendCandidateEmail(built);
    });
  }

  return {
    notifyNewApplication: notifyNewApplication,
    notifyShortlisted: notifyShortlisted,
    notifyInterviewScheduled: notifyInterviewScheduled,
    notifyFeedbackPending: notifyFeedbackPending,
    notifySelected: notifySelected,
    notifyCandidate: notifyCandidate
  };
})();

var NotificationLifecycleAdapter = (function () {
  function isoDate_(value) {
    if (value === null || value === undefined || value === '') return '';
    var tz = 'Asia/Kolkata';
    try {
      tz = ConfigService.getTimezone();
    } catch (ignore) {}
    if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
      return Utilities.formatDate(value, tz, 'yyyy-MM-dd');
    }
    var s = String(value);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
    var d = new Date(s);
    if (!isNaN(d.getTime())) return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
    return '';
  }

  function activeEmployees_() {
    return (DbService.getAllRecords(HRMS.SHEETS.EMPLOYEES) || []).filter(function (e) {
      return String(e.status || '').toUpperCase() === 'ACTIVE';
    });
  }

  function todayInZone_() {
    var tz = 'Asia/Kolkata';
    try {
      tz = ConfigService.getTimezone();
    } catch (ignore) {}
    var iso = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    var parts = iso.split('-');
    return {
      iso: iso,
      date: new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])),
      year: Number(parts[0])
    };
  }

  function runBirthdayAndAnniversary() {
    NotificationService.ensureSchema();
    var today = todayInZone_();
    var employees = activeEmployees_();
    var birthdayInputs = [];
    var anniversaryInputs = [];
    employees.forEach(function (emp) {
      var rec = {
        employee_id: emp.employee_id,
        email: emp.work_email,
        display_name: emp.display_name || emp.employee_id
      };
      if (NotificationEngine.birthdayMatches(isoDate_(emp.date_of_birth), today.iso)) {
        birthdayInputs.push(NotificationEngine.payloads.happyBirthday(rec, today.year));
      }
      if (NotificationEngine.anniversaryMatches(isoDate_(emp.joining_date), today.iso)) {
        var years = NotificationEngine.anniversaryYears(isoDate_(emp.joining_date), today.iso);
        anniversaryInputs.push(NotificationEngine.payloads.workAnniversary(rec, years, today.year));
      }
    });
    var b = birthdayInputs.length ? NotificationService.createNotifications(birthdayInputs) : { created: 0 };
    var a = anniversaryInputs.length ? NotificationService.createNotifications(anniversaryInputs) : { created: 0 };
    var created = (b.created || 0) + (a.created || 0);
    if (created) {
      try {
        AuditService.log(
          'NOTIFICATION_LIFECYCLE',
          'NotificationInbox',
          today.iso,
          'Birthday ' + (b.created || 0) + ', anniversary ' + (a.created || 0),
          ''
        );
      } catch (ignore) {}
    }
    return {
      ok: true,
      date: today.iso,
      birthdays: b.created || 0,
      anniversaries: a.created || 0,
      birthday_duplicates: b.duplicates || 0,
      anniversary_duplicates: a.duplicates || 0
    };
  }

  function runDailyJob(opts) {
    opts = opts || {};
    var cache;
    try {
      cache = CacheService.getScriptCache();
      if (opts.source === 'trigger' && cache.get('ntf_daily_job_lock')) {
        return { ok: true, skipped: true, reason: 'rate_limited' };
      }
      if (opts.source === 'trigger') {
        cache.put('ntf_daily_job_lock', '1', 3600);
      }
    } catch (ignore) {}
    var life = runBirthdayAndAnniversary();
    var pending = NotificationService.processPendingEmails({ limit: NotificationService.EMAIL_BATCH_LIMIT });
    return { ok: true, lifecycle: life, pending_email: pending };
  }

  return {
    runBirthdayAndAnniversary: runBirthdayAndAnniversary,
    runDailyJob: runDailyJob
  };
})();
