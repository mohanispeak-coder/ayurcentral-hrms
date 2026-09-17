/**
 * Employee HRMS welcome message (email + Telegram). Template C with professional welcome line.
 */
var HRMS = HRMS || {};

var EmployeeWelcomeService = (function () {
  function trim_(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
  }

  function displayName_(record) {
    return trim_(record.display_name) || (trim_(record.first_name) + ' ' + trim_(record.last_name)).trim();
  }

  function buildWelcomeContent(record, loginEmail) {
    record = record || {};
    loginEmail = trim_(loginEmail);
    var company = ConfigService.getCompanyName();
    var displayName = displayName_(record) || 'Colleague';
    var webappUrl = ConfigService.getHrmsWebAppUrl();
    var portalLine = webappUrl || '(ask HR for the HRMS portal link)';
    var department = trim_(record.department) || '—';
    var subject = company + ' — Welcome — HRMS access for ' + record.employee_id;
    var body = [
      'Dear ' + displayName + ',',
      '',
      'Welcome to ' + company + '. We are pleased to welcome you to our organisation.',
      '',
      'An account has been created for you on the organisation HRMS portal.',
      '',
      'Portal: ' + portalLine,
      'Login email: ' + loginEmail,
      'Employee ID: ' + record.employee_id,
      'Department: ' + department,
      '',
      'Please use this portal for self-service HR requests. Do not share your login details.',
      '',
      'Regards,',
      'Human Resources',
      company
    ].join('\n');
    return {
      subject: subject,
      body: body,
      webappUrl: webappUrl,
      loginEmail: loginEmail,
      displayName: displayName,
      company: company
    };
  }

  function telegramEnabled_() {
    try {
      return ConfigService.getSetting('notification_telegram_welcome', false) === true ||
        String(ConfigService.getSetting('notification_telegram_welcome', 'false')).toUpperCase() === 'TRUE';
    } catch (e) {
      return false;
    }
  }

  function emailEnabled_() {
    try {
      return ConfigService.getSetting('notification_employee_welcome', true) === true ||
        String(ConfigService.getSetting('notification_employee_welcome', 'true')).toUpperCase() === 'TRUE';
    } catch (e) {
      return true;
    }
  }

  function requireEditor_(session, employeeId) {
    if (!PermissionService.isHrOrAdmin(session)) {
      throw authorizationError_('You do not have permission to send welcome messages.');
    }
    if (session.employee_id && String(session.employee_id) === String(employeeId)) {
      throw authorizationError_('You cannot send a welcome message to yourself.');
    }
  }

  function loadTarget_(employeeId) {
    var emp = EmployeeRepository.findById(employeeId);
    if (!emp) throw notFoundError_('Employee not found.');
    var user = EmployeeRepository.findUserByEmployeeId(employeeId);
    if (!user) {
      throw validationError_('This employee does not have a login yet.', {
        fields: { google_email: 'Create a Google login first.' }
      });
    }
    return { employee: emp, user: user, loginEmail: trim_(user.google_email) };
  }

  function sendEmail_(content, employeeId, loginEmail, orgSettingKey) {
    if (typeof NotificationService === 'undefined' || !NotificationService.sendOrgEventEmail) {
      return { ok: false, status: 'UNAVAILABLE', error: 'NotificationService unavailable' };
    }
    var mailOpts = {
      event_type: 'EMPLOYEE_WELCOME',
      to: loginEmail,
      subject: content.subject,
      body: content.body,
      employee_id: employeeId,
      related_entity_type: 'Employees',
      related_entity_id: employeeId
    };
    if (orgSettingKey) mailOpts.orgSettingKey = orgSettingKey;
    var result = NotificationService.sendOrgEventEmail(mailOpts);
    var ok = result && (result.status === 'SENT');
    return {
      attempted: true,
      ok: ok,
      status: result ? result.status : 'FAILED',
      error: result ? result.error_message : ''
    };
  }

  function logTelegramWelcome_(employeeId, chatId, tg) {
    try {
      AuditService.log(
        'EMPLOYEE_WELCOME_TELEGRAM',
        'Users',
        'telegram:' + trim_(chatId),
        (tg && tg.ok ? 'Sent' : (tg ? tg.status : 'FAILED')) + (tg && tg.error ? ' — ' + tg.error : ''),
        employeeId || ''
      );
    } catch (ignore) {}
  }

  function sendTelegram_(content, chatId, employeeId) {
    if (typeof TelegramService === 'undefined' || !TelegramService.sendMessage) {
      return { ok: false, status: 'UNAVAILABLE', error: 'TelegramService unavailable' };
    }
    if (!TelegramService.isConfigured()) {
      return { ok: false, status: 'NOT_CONFIGURED', error: 'TELEGRAM_BOT_TOKEN not set' };
    }
    var tg = TelegramService.sendMessage(chatId, content.body, content.webappUrl);
    logTelegramWelcome_(employeeId, chatId, tg);
    return tg;
  }

  function welcomeWarnings_(out, autoCreate) {
    var list = [];
    if (!out) return list;
    if (autoCreate && out.telegram && !out.telegram.attempted) {
      list.push('Telegram: enable “Send welcome on Telegram when login is created” in Settings, or send manually from Login & role.');
    }
    if (out.telegram && out.telegram.attempted && !out.telegram.ok) {
      if (out.telegram.status === 'NOT_CONFIGURED') {
        list.push('Telegram: add TELEGRAM_BOT_TOKEN in Apps Script → Project settings → Script properties.');
      } else if (out.telegram.status === 'NO_CHAT') {
        list.push('Telegram: save the employee chat ID on Login & role (they must tap Start on your bot first).');
      } else if (out.telegram.status === 'SKIPPED' && !out.telegram.attempted) {
        list.push('Telegram: enable “Send welcome on Telegram” in Settings.');
      } else if (out.telegram.status === 'SKIPPED') {
        list.push('Telegram: not sent (disabled in Settings or not requested).');
      } else {
        list.push('Telegram: ' + (out.telegram.error || out.telegram.status || 'failed'));
      }
    }
    if (out.email && out.email.attempted && !out.email.ok && out.email.status !== 'SKIPPED') {
      list.push('Welcome email: ' + (out.email.error || out.email.status || 'not sent'));
    }
    return list;
  }

  /**
   * @param {Object} session HR/Admin session (required unless options.autoCreate)
   * @param {string} employeeId
   * @param {Object} options { email: boolean, telegram: boolean, autoCreate: boolean }
   */
  function sendWelcome(session, employeeId, options) {
    options = options || {};
    var autoCreate = !!options.autoCreate;
    if (!autoCreate) {
      requireEditor_(session, employeeId);
    }
    var target = loadTarget_(employeeId);
    var content = buildWelcomeContent(target.employee, target.loginEmail);
    var wantEmail = options.email === true || (autoCreate && emailEnabled_());
    var wantTelegram = options.telegram === true || (autoCreate && telegramEnabled_());
    if (!autoCreate) {
      if (options.email === undefined && options.telegram === undefined) {
        wantEmail = true;
        wantTelegram = true;
      } else {
        wantEmail = options.email === true;
        wantTelegram = options.telegram === true;
      }
    }
    var out = {
      employee_id: employeeId,
      email: { attempted: wantEmail, ok: false, status: 'SKIPPED' },
      telegram: { attempted: wantTelegram, ok: false, status: 'SKIPPED' }
    };
    if (wantEmail) {
      var emailKey = autoCreate ? 'notification_employee_welcome' : null;
      out.email = sendEmail_(content, employeeId, target.loginEmail, emailKey);
      out.email.attempted = true;
    }
    if (wantTelegram) {
      var chatId = trim_(target.user.telegram_chat_id);
      out.telegram.attempted = true;
      if (!chatId) {
        out.telegram = { attempted: true, ok: false, status: 'NO_CHAT', error: 'No Telegram chat ID on user' };
      } else {
        var tg = sendTelegram_(content, chatId, employeeId);
        out.telegram = {
          attempted: true,
          ok: !!tg.ok,
          status: tg.status || (tg.ok ? 'SENT' : 'FAILED'),
          error: tg.error || ''
        };
      }
    }
    if (!autoCreate) {
      AuditService.log(
        'EMPLOYEE_WELCOME_SEND',
        'Employees',
        employeeId,
        'Welcome sent (email=' + out.email.status + ', telegram=' + out.telegram.status + ')',
        session.employee_id || ''
      );
    }
    out.warnings = welcomeWarnings_(out, autoCreate);
    return out;
  }

  function sendWelcomeOnCreate(record, loginEmail) {
    if (!loginEmail) return { email: { attempted: false }, telegram: { attempted: false } };
    try {
      var out = sendWelcome(null, record.employee_id, { autoCreate: true });
      out.warnings = welcomeWarnings_(out, true);
      return out;
    } catch (e) {
      return {
        email: { attempted: false, ok: false, status: 'ERROR', error: String(e.message || e) },
        telegram: { attempted: false, ok: false, status: 'ERROR', error: String(e.message || e) },
        warnings: [String(e.message || e)]
      };
    }
  }

  function statusForClient_() {
    var botUser = '';
    try {
      botUser = trim_(ConfigService.getSetting('telegram_bot_username', ''));
    } catch (ignore) {}
    return {
      telegram_configured: typeof TelegramService !== 'undefined' && TelegramService.isConfigured(),
      telegram_welcome_enabled: telegramEnabled_(),
      email_welcome_enabled: emailEnabled_(),
      telegram_bot_username: botUser
    };
  }

  return {
    buildWelcomeContent: buildWelcomeContent,
    sendWelcome: sendWelcome,
    sendWelcomeOnCreate: sendWelcomeOnCreate,
    statusForClient: statusForClient_
  };
})();
