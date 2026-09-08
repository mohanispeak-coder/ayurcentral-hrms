/**
 * Client-callable Notification Center APIs.
 * Recipients see only their inbox. Announcements and email log are HR/ADMIN.
 */

function apiGetNotifications(query, sessionToken) {
  return hrmsRun_(function () {
    var session = PermissionService.require(HRMS.ACTIONS.ACCESS_APP);
    return NotificationService.getNotifications(session, query || {});
  }, sessionToken);
}

function apiGetUnreadNotificationCount(sessionToken) {
  return hrmsRun_(function () {
    var session = PermissionService.require(HRMS.ACTIONS.ACCESS_APP);
    return { unread_count: NotificationService.getUnreadCount(session) };
  }, sessionToken);
}

function apiGetNotificationBellState(sessionToken) {
  return hrmsRun_(function () {
    var session = PermissionService.require(HRMS.ACTIONS.ACCESS_APP);
    return NotificationService.getBellState(session, 8);
  }, sessionToken);
}

function apiMarkNotificationRead(notificationId, sessionToken) {
  return hrmsRun_(function () {
    var session = PermissionService.require(HRMS.ACTIONS.ACCESS_APP);
    return NotificationService.markNotificationRead(session, notificationId);
  }, sessionToken);
}

function apiMarkAllNotificationsRead(sessionToken) {
  return hrmsRun_(function () {
    var session = PermissionService.require(HRMS.ACTIONS.ACCESS_APP);
    return NotificationService.markAllNotificationsRead(session);
  }, sessionToken);
}

function apiGetNotificationPreferences(sessionToken) {
  return hrmsRun_(function () {
    var session = PermissionService.require(HRMS.ACTIONS.ACCESS_APP);
    return {
      preferences: NotificationService.getPreferences(session),
      catalog: NotificationService.catalogForClient(session)
    };
  }, sessionToken);
}

function apiSaveNotificationPreferences(patches, sessionToken) {
  return hrmsRun_(function () {
    var session = PermissionService.require(HRMS.ACTIONS.ACCESS_APP);
    return NotificationService.savePreferences(session, patches);
  }, sessionToken);
}

function apiCreateHrAnnouncement(payload, sessionToken) {
  return hrmsRun_(function () {
    var session = PermissionService.require(HRMS.ACTIONS.ACCESS_APP);
    return NotificationService.createAnnouncement(session, payload || {});
  }, sessionToken);
}

function apiListNotificationEmailLog(query, sessionToken) {
  return hrmsRun_(function () {
    var session = PermissionService.require(HRMS.ACTIONS.ACCESS_APP);
    return NotificationService.listEmailLog(session, query || {});
  }, sessionToken);
}

function apiRetryNotificationEmail(emailLogId, sessionToken) {
  return hrmsRun_(function () {
    var session = PermissionService.require(HRMS.ACTIONS.ACCESS_APP);
    return NotificationService.retryEmail(session, emailLogId);
  }, sessionToken);
}

function apiGetNotificationCatalog(sessionToken) {
  return hrmsRun_(function () {
    var session = PermissionService.require(HRMS.ACTIONS.ACCESS_APP);
    return NotificationService.catalogForClient(session);
  }, sessionToken);
}

function apiEnsureNotificationSchema(sessionToken) {
  return hrmsRun_(function () {
    var session = PermissionService.require(HRMS.ACTIONS.ACCESS_APP);
    if (!NotificationEngine.canAnnounce(session) && !NotificationEngine.isAdmin(session)) {
      throw authorizationError_('Only HR or Admin can set up Notification Center sheets.');
    }
    return NotificationSchema.ensureSheets();
  }, sessionToken);
}

function apiRunNotificationDailyJob(sessionToken) {
  return hrmsRun_(function () {
    PermissionService.require(HRMS.ACTIONS.RUN_SETUP);
    return NotificationLifecycleAdapter.runDailyJob({ source: 'admin' });
  }, sessionToken);
}

/** Spreadsheet menu: HRMS → Ensure notification sheets */
function menuEnsureNotificationSchema() {
  if (typeof NotificationSchema === 'undefined' || !NotificationSchema.ensureSheets) {
    SpreadsheetApp.getUi().alert('Notification module is not available in this project.');
    return;
  }
  var session = AuthService.requireAuth();
  if (!NotificationEngine.canAnnounce(session) && !NotificationEngine.isAdmin(session)) {
    SpreadsheetApp.getUi().alert('HR or Admin permission required.');
    return;
  }
  var result = NotificationSchema.ensureSheets();
  SpreadsheetApp.getUi().alert('Notification Center sheets ready.');
  return result;
}
