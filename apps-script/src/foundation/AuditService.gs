/**
 * Lightweight audit logging — no sensitive payloads.
 */
var HRMS = HRMS || {};

var AuditService = (function () {
  /**
   * @param {string} action
   * @param {string} entityType
   * @param {string} entityId
   * @param {string} summary
   * @param {string=} employeeIdScope Affected employee_id.
   */
  function log(action, entityType, entityId, summary, employeeIdScope) {
    var session = AuthService.resolveSession();
    var actorEmail = session.email || Session.getActiveUser().getEmail().toLowerCase() || 'system';
    var actorEmployeeId = session.employee_id || '';
    var safeSummary = String(summary || '').substring(0, 500);
    DbService.insertRecord(HRMS.SHEETS.AUDIT_LOG, {
      audit_id: DbService.generateId('AUD'),
      at: new Date(),
      actor_email: actorEmail,
      actor_employee_id: actorEmployeeId,
      action: action,
      entity_type: entityType,
      entity_id: String(entityId || ''),
      employee_id: employeeIdScope || '',
      summary: safeSummary
    });
  }

  function getRecent(limit) {
    var n = limit || 20;
    var rows = DbService.getAllRecords(HRMS.SHEETS.AUDIT_LOG);
    rows.sort(function (a, b) {
      return new Date(b.at) - new Date(a.at);
    });
    return rows.slice(0, n);
  }

  return {
    log: log,
    getRecent: getRecent
  };
})();
