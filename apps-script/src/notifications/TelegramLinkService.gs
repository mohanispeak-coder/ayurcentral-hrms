/**
 * Link employee Users.telegram_chat_id when staff tap t.me/bot?start=hrms_<employee_id>.
 * Telegram bots cannot message users until they tap Start once — this removes manual chat ID entry.
 */
var HRMS = HRMS || {};

var TelegramLinkService = (function () {
  var START_PREFIX_ = 'hrms_';
  var PENDING_CACHE_PREFIX_ = 'tg_welcome_pending_';
  var PENDING_TTL_SEC_ = 1209600; // 14 days

  function trim_(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
  }

  function botUsernameFromSettings_() {
    try {
      return trim_(ConfigService.getSetting('telegram_bot_username', '')).replace(/^@/, '');
    } catch (e) {
      return '';
    }
  }

  function fetchBotUsernameFromApi_() {
    if (typeof TelegramService === 'undefined' || !TelegramService.isConfigured()) return '';
    try {
      var cache = CacheService.getScriptCache();
      var cached = cache.get('tg_bot_username');
      if (cached) return trim_(cached);
    } catch (ignoreCache) {}
    var token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
    if (!token) return '';
    try {
      var response = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getMe', {
        muteHttpExceptions: true
      });
      var json = JSON.parse(response.getContentText() || '{}');
      if (json.ok && json.result && json.result.username) {
        var username = trim_(json.result.username);
        try {
          CacheService.getScriptCache().put('tg_bot_username', username, 3600);
        } catch (ignorePut) {}
        try {
          var existing = botUsernameFromSettings_();
          if (!existing && username && typeof DbService !== 'undefined') {
            var row = DbService.findOne(HRMS.SHEETS.SETTINGS, { setting_key: 'telegram_bot_username' });
            if (row) {
              DbService.updateRecord(HRMS.SHEETS.SETTINGS, 'setting_key', 'telegram_bot_username', {
                setting_value: username,
                updated_at: new Date(),
                updated_by_email: 'system'
              });
              ConfigService.clearSettingsCache();
            }
          }
        } catch (ignoreSave) {}
        return username;
      }
    } catch (ignoreApi) {}
    return '';
  }

  function resolveBotUsername_() {
    var fromSettings = botUsernameFromSettings_();
    if (fromSettings) return fromSettings;
    return fetchBotUsernameFromApi_();
  }

  function startParamForEmployee_(employeeId) {
    employeeId = trim_(employeeId);
    if (!employeeId) return '';
    var param = START_PREFIX_ + employeeId;
    if (param.length > 64) return '';
    return param;
  }

  function employeeIdFromStartParam_(param) {
    param = trim_(param);
    if (!param || param.indexOf(START_PREFIX_) !== 0) return '';
    return trim_(param.substring(START_PREFIX_.length));
  }

  function buildConnectUrl(employeeId) {
    var bot = resolveBotUsername_();
    var param = startParamForEmployee_(employeeId);
    if (!bot || !param) return '';
    return 'https://t.me/' + bot + '?start=' + encodeURIComponent(param);
  }

  function buildConnectLine_(employeeId) {
    var link = buildConnectUrl(employeeId);
    if (link) {
      return 'Get HR updates on Telegram (tap Start once — no chat ID needed):\n' + link;
    }
    if (typeof TelegramService !== 'undefined' && TelegramService.isConfigured()) {
      return 'Telegram: your HR team will share a bot link separately. (HR: set telegram_bot_username in Settings or ensure TELEGRAM_BOT_TOKEN is valid.)';
    }
    return '';
  }

  function queueWelcomeForLink_(employeeId, content) {
    employeeId = trim_(employeeId);
    if (!employeeId || !content) return;
    try {
      CacheService.getScriptCache().put(
        PENDING_CACHE_PREFIX_ + employeeId,
        JSON.stringify({
          body: content.body || '',
          webappUrl: content.webappUrl || '',
          queuedAt: Date.now()
        }),
        PENDING_TTL_SEC_
      );
    } catch (ignore) {}
  }

  function linkChatToEmployee_(employeeId, chatId) {
    employeeId = trim_(employeeId);
    chatId = trim_(chatId);
    if (!employeeId || !chatId) return { ok: false, error: 'INVALID' };
    var user = EmployeeRepository.findUserByEmployeeId(employeeId);
    if (!user) return { ok: false, error: 'NO_LOGIN' };
    if (typeof UserAccessService !== 'undefined' && UserAccessService.ensureColumns) {
      UserAccessService.ensureColumns();
    }
    EmployeeRepository.updateUser(user.google_email, {
      telegram_chat_id: chatId,
      updated_at: new Date()
    });
    if (typeof AuthService !== 'undefined' && AuthService.invalidateIdentitySnapshots) {
      AuthService.invalidateIdentitySnapshots();
    }
    try {
      AuditService.log('TELEGRAM_LINK', 'Users', chatId, 'Linked Telegram for ' + employeeId, employeeId);
    } catch (ignore) {}
    return { ok: true };
  }

  function deliverPendingWelcome_(employeeId, chatId) {
    var key = PENDING_CACHE_PREFIX_ + trim_(employeeId);
    var raw = '';
    try {
      raw = CacheService.getScriptCache().get(key);
    } catch (ignore) {}
    if (raw) {
      try {
        var pending = JSON.parse(raw);
        if (typeof TelegramService !== 'undefined' && TelegramService.sendMessage) {
          TelegramService.sendMessage(chatId, pending.body, pending.webappUrl);
        }
        CacheService.getScriptCache().remove(key);
        return { ok: true, source: 'queued' };
      } catch (ignoreSend) {}
    }
    if (typeof EmployeeWelcomeService !== 'undefined' && EmployeeWelcomeService.sendWelcome) {
      try {
        var sent = EmployeeWelcomeService.sendWelcome(null, employeeId, { email: false, telegram: true });
        if (sent && sent.telegram && sent.telegram.ok) {
          return { ok: true, source: 'welcome' };
        }
      } catch (ignoreWelcome) {}
    }
    return { ok: false, source: 'none' };
  }

  function reply_(chatId, text, buttonUrl) {
    if (typeof TelegramService === 'undefined' || !TelegramService.sendMessage) return;
    TelegramService.sendMessage(chatId, text, buttonUrl);
  }

  function processUpdate(update) {
    update = update || {};
    var msg = update.message || update.edited_message;
    if (!msg || !msg.chat) return { ok: false, reason: 'no_message' };
    var chatId = String(msg.chat.id);
    var text = trim_(msg.text || '');
    if (!text) return { ok: false, reason: 'empty' };

    var payload = '';
    if (text.indexOf('/start') === 0) {
      var parts = text.split(/\s+/);
      payload = parts.length > 1 ? trim_(parts[1]) : '';
    } else {
      return { ok: false, reason: 'not_start' };
    }

    var employeeId = employeeIdFromStartParam_(payload);
    if (!employeeId) {
      reply_(chatId, 'Welcome. Use the personal link from your HR welcome email to connect this chat to your employee record.');
      return { ok: true, linked: false };
    }

    var emp = EmployeeRepository.findById(employeeId);
    if (!emp) {
      reply_(chatId, 'Employee code "' + employeeId + '" was not found. Ask HR for a new Telegram link.');
      return { ok: true, linked: false };
    }

    var linked = linkChatToEmployee_(employeeId, chatId);
    if (!linked.ok) {
      reply_(chatId, 'Could not link this chat yet (no HRMS login on file). Contact HR.');
      return { ok: true, linked: false };
    }

    var company = 'your organisation';
    try {
      company = ConfigService.getCompanyName();
    } catch (ignore) {}
    var webapp = '';
    try {
      webapp = ConfigService.getHrmsWebAppUrl();
    } catch (ignore2) {}

    deliverPendingWelcome_(employeeId, chatId);
    reply_(
      chatId,
      'You are connected to ' + company + ' HRMS on Telegram. Important HR messages will appear here.',
      webapp
    );
    return { ok: true, linked: true, employee_id: employeeId };
  }

  function webhookUrl_() {
    try {
      return ScriptApp.getService().getUrl() || '';
    } catch (e) {
      return '';
    }
  }

  function installWebhook() {
    if (typeof TelegramService === 'undefined' || !TelegramService.isConfigured()) {
      throw configurationError_('Set TELEGRAM_BOT_TOKEN in Script properties first.');
    }
    var url = webhookUrl_();
    if (!url) {
      throw configurationError_('Deploy the web app first, then install the Telegram webhook.');
    }
    var token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
    var response = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/setWebhook', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ url: url, allowed_updates: ['message'] }),
      muteHttpExceptions: true
    });
    var json = JSON.parse(response.getContentText() || '{}');
    if (!json.ok) {
      throw configurationError_('Telegram setWebhook failed: ' + (json.description || response.getContentText()));
    }
    return { ok: true, url: url };
  }

  function webhookStatus() {
    if (!TelegramService.isConfigured()) {
      return { configured: false, webhook_url: '', matches_deployment: false };
    }
    var token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
    var response = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getWebhookInfo', {
      muteHttpExceptions: true
    });
    var json = JSON.parse(response.getContentText() || '{}');
    var info = json.result || {};
    var deploy = webhookUrl_();
    return {
      configured: true,
      webhook_url: info.url || '',
      matches_deployment: !!(deploy && info.url === deploy),
      pending_update_count: info.pending_update_count || 0
    };
  }

  function appendConnectLineToBody_(body, employeeId) {
    body = String(body || '');
    var line = buildConnectLine_(employeeId);
    if (!line) return body;
    if (body.indexOf(line) >= 0) return body;
    var link = buildConnectUrl(employeeId);
    if (link && body.indexOf(link) >= 0) return body;
    if (body.indexOf('{{telegram_connect') >= 0) return body;
    return body + '\n\n---\n' + line;
  }

  return {
    buildConnectUrl: buildConnectUrl,
    buildConnectLine: buildConnectLine_,
    resolveBotUsername: resolveBotUsername_,
    startParamForEmployee: startParamForEmployee_,
    employeeIdFromStartParam: employeeIdFromStartParam_,
    queueWelcomeForLink: queueWelcomeForLink_,
    processUpdate: processUpdate,
    installWebhook: installWebhook,
    webhookStatus: webhookStatus,
    appendConnectLineToBody: appendConnectLineToBody_
  };
})();
