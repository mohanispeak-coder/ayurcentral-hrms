/**
 * Outbound Telegram Bot API (server-side only). Token in Script Properties — never expose to browser.
 */
var HRMS = HRMS || {};

var TelegramService = (function () {
  var PROP_TOKEN_ = 'TELEGRAM_BOT_TOKEN';

  function trim_(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
  }

  function getBotToken_() {
    try {
      return trim_(PropertiesService.getScriptProperties().getProperty(PROP_TOKEN_));
    } catch (e) {
      return '';
    }
  }

  function isConfigured() {
    return !!getBotToken_();
  }

  function parseApiResponse_(response) {
    var code = response.getResponseCode();
    var raw = response.getContentText() || '';
    var json = null;
    try {
      json = JSON.parse(raw);
    } catch (ignore) {}
    if (code >= 200 && code < 300 && json && json.ok) {
      return { ok: true, result: json.result };
    }
    var desc = (json && json.description) ? json.description : ('HTTP ' + code);
    return { ok: false, error: desc };
  }

  /**
   * @param {string} chatId Telegram chat id (numeric string)
   * @param {string} text Plain-text message
   * @param {string} [buttonUrl] HTTPS URL for inline "Open HRMS portal" button
   */
  function sendMessage(chatId, text, buttonUrl) {
    chatId = trim_(chatId);
    text = trim_(text);
    if (!chatId) return { ok: false, status: 'NO_CHAT', error: 'NO_CHAT' };
    if (!text) return { ok: false, status: 'EMPTY', error: 'EMPTY_MESSAGE' };
    var token = getBotToken_();
    if (!token) return { ok: false, status: 'NOT_CONFIGURED', error: 'TELEGRAM_BOT_TOKEN missing' };

    var body = {
      chat_id: chatId,
      text: text,
      disable_web_page_preview: false
    };
    var url = trim_(buttonUrl);
    if (url && /^https:\/\//i.test(url)) {
      body.reply_markup = {
        inline_keyboard: [[{ text: 'Open HRMS portal', url: url }]]
      };
    }
    var response = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
    var parsed = parseApiResponse_(response);
    if (parsed.ok) return { ok: true, status: 'SENT' };
    return { ok: false, status: 'FAILED', error: parsed.error };
  }

  return {
    isConfigured: isConfigured,
    sendMessage: sendMessage,
    /** @deprecated use HRMS.PROPS.TELEGRAM_BOT_TOKEN */
    PROP_TOKEN: PROP_TOKEN_
  };
})();
