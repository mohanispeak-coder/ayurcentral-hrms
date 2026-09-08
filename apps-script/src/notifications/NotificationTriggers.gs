/**
 * Time-driven birthday/anniversary + pending-email drain.
 * Do not add to Index.html. Register from the Apps Script editor or a future
 * Main.gs menu — see docs/NOTIFICATIONS_INTEGRATION_NOTES.md.
 *
 * Trigger handler name must stay: runNotificationDailyJob
 */

var NOTIFICATION_TRIGGER_HANDLER_ = 'runNotificationDailyJob';

function denyAnonymousWeb_() {
  try {
    var session = AuthService.resolveSession();
    if (session && session.authorized && !PermissionService.isAdmin(session)) {
      throw authorizationError_('Only an administrator can manage notification triggers.');
    }
    if (session && !session.authorized && session.reason === 'NO_IDENTITY') {
      throw authorizationError_('Not allowed.');
    }
  } catch (e) {
    if (e && e.hrmsCode) throw e;
  }
}

function runNotificationDailyJob() {
  return NotificationLifecycleAdapter.runDailyJob({ source: 'trigger' });
}

function installNotificationDailyTrigger() {
  denyAnonymousWeb_();
  uninstallNotificationDailyTriggers();
  var tb = ScriptApp.newTrigger(NOTIFICATION_TRIGGER_HANDLER_)
    .timeBased()
    .everyDays(1)
    .atHour(6);
  if (typeof tb.inTimezone === 'function') {
    tb.inTimezone('Asia/Kolkata');
  }
  tb.create();
  return { ok: true, handler: NOTIFICATION_TRIGGER_HANDLER_, hour: 6, timezone: 'Asia/Kolkata' };
}

function uninstallNotificationDailyTriggers() {
  denyAnonymousWeb_();
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === NOTIFICATION_TRIGGER_HANDLER_) {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  return { ok: true, removed: removed };
}

function listNotificationTriggers() {
  return ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === NOTIFICATION_TRIGGER_HANDLER_; })
    .map(function (t) {
      return {
        handler: t.getHandlerFunction(),
        uniqueId: t.getUniqueId(),
        eventType: String(t.getEventType())
      };
    });
}
