/**
 * Notification Center tests — engine is always runnable; sheet cases skip without DB.
 * Run testNotifications_All from the Apps Script editor.
 */

function testNotifications_Engine() {
  var results = [];
  function check(name, cond, detail) {
    results.push({ name: name, passed: !!cond, detail: detail || '' });
    Logger.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ': ' + detail : ''));
  }

  var emp = { authorized: true, email: 'ada@client.com', employee_id: 'EMP003', role: 'EMPLOYEE' };
  var other = { authorized: true, email: 'bob@client.com', employee_id: 'EMP004', role: 'EMPLOYEE' };
  var manager = { authorized: true, email: 'mgr@client.com', employee_id: 'EMP002', role: 'MANAGER' };
  var hr = { authorized: true, email: 'hr@client.com', employee_id: 'EMP001', role: 'HR' };
  var n = 0;
  function opts() {
    return {
      now: new Date('2026-08-29T10:00:00Z'),
      idFactory: function () { n += 1; return 'INB-TEST-' + n; },
      preferences: [],
      orgSettings: { notification_leave: true, notification_payroll: true }
    };
  }

  var leaveReq = {
    leave_request_id: 'LR-100', employee_id: 'EMP003',
    start_date: '2026-09-01', end_date: '2026-09-03', total_days: 3
  };
  var employeeRec = { employee_id: 'EMP003', display_name: 'Ada Employee', email: 'ada@client.com' };
  var managerRec = { employee_id: 'EMP002', display_name: 'Mo Manager', email: 'mgr@client.com' };

  n = 0;
  var store = NotificationEngine.memoryStore();
  var created = NotificationEngine.inbox.create(
    store,
    NotificationEngine.payloads.leaveSubmitted(leaveReq, employeeRec, managerRec),
    opts()
  );
  check('create', created.ok && created.created);
  check('unread', NotificationEngine.isUnread(created.record));
  check('unread-count', NotificationEngine.inbox.unreadCount(store, manager) === 1);
  check('rbac-other-list', NotificationEngine.inbox.list(store, emp, {}).total === 0);
  var marked = NotificationEngine.inbox.markRead(store, created.record.notification_id, manager, new Date());
  check('mark-read', marked.ok && marked.changed);
  check('rbac-other-mark', NotificationEngine.inbox.markRead(store, created.record.notification_id, other).forbidden === true);

  n = 0;
  store = NotificationEngine.memoryStore();
  NotificationEngine.inbox.create(store, NotificationEngine.payloads.leaveApproved(leaveReq, employeeRec), opts());
  NotificationEngine.inbox.create(store, NotificationEngine.payloads.leaveRejected({
    leave_request_id: 'LR-101', employee_id: 'EMP003', start_date: '2026-09-08', end_date: '2026-09-08'
  }, employeeRec), opts());
  check('mark-all', NotificationEngine.inbox.markAllRead(store, emp, new Date()).changed === 2);

  n = 0;
  store = NotificationEngine.memoryStore();
  var payload = NotificationEngine.payloads.leaveSubmitted(leaveReq, employeeRec, managerRec);
  NotificationEngine.inbox.create(store, payload, opts());
  var dup = NotificationEngine.inbox.create(store, payload, opts());
  check('duplicate', dup.duplicate === true && store.list().length === 1);

  var run = { payroll_run_id: 'PR-1', period_year: 2026, period_month: 8 };
  var slip = NotificationEngine.payloads.payslipAvailable(
    { payroll_record_id: 'PREC-1', net_pay: 88000 },
    employeeRec,
    run
  );
  check('payslip-no-net', slip.email_subject.indexOf('88000') < 0 && !NotificationEngine.payslipContainsNet(slip.title));
  check('hr-email-log', NotificationEngine.canViewEmailLog(hr) && !NotificationEngine.canViewEmailLog(emp));
  check('birthday', NotificationEngine.birthdayMatches('1990-08-29', '2026-08-29'));
  check('anniversary-skip-join-year', !NotificationEngine.anniversaryMatches('2026-08-29', '2026-08-29'));
  check('pms', NotificationEngine.payloads.pmsCycleOpen({ cycle_id: 'C1', name: 'H1' }, emp).type === 'PMS_CYCLE_OPEN');
  check('ats-candidate-not-inbox', NotificationEngine.isCandidateType('ATS_CANDIDATE_INTERVIEW'));

  var failed = results.filter(function (r) { return !r.passed; });
  Logger.log('Notification engine tests: ' + (results.length - failed.length) + '/' + results.length + ' passed');
  return { results: results, allPassed: failed.length === 0, failedCount: failed.length };
}

function testNotifications_All() {
  var engine = testNotifications_Engine();
  var sheet = { skipped: true, allPassed: true, results: [] };
  try {
    if (ConfigService.getScriptProperty(HRMS.PROPS.SPREADSHEET_ID)) {
      sheet = testNotifications_SheetSmoke();
    }
  } catch (e) {
    sheet = { allPassed: false, results: [{ name: 'sheet-smoke', passed: false, detail: e.message }] };
  }
  return {
    engine: engine,
    sheet: sheet,
    allPassed: engine.allPassed && sheet.allPassed
  };
}

function testNotifications_SheetSmoke() {
  var results = [];
  function record(name, passed, detail) {
    results.push({ name: name, passed: !!passed, detail: detail || '' });
    Logger.log((passed ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ': ' + detail : ''));
  }
  var ensured = NotificationSchema.ensureSheets();
  record('ensure-sheets', !!(ensured && ensured.ok));
  var session = AuthService.resolveSession();
  if (!session.authorized) {
    record('auth', true, 'skipped — not authorized in editor');
    return { results: results, allPassed: true, skipped: true };
  }
  var listed = NotificationService.getNotifications(session, { limit: 5 });
  record('list-shape', listed && Object.prototype.toString.call(listed.items) === '[object Array]');
  var count = NotificationService.getUnreadCount(session);
  record('unread-count-number', typeof count === 'number');
  record('email-log-rbac', NotificationEngine.canViewEmailLog(session)
    ? true
    : (function () {
      try {
        NotificationService.listEmailLog(session, { limit: 1 });
        return false;
      } catch (e) {
        return e.hrmsCode === HRMS.ERROR_CODES.AUTHORIZATION;
      }
    })());
  var failed = results.filter(function (r) { return !r.passed; });
  return { results: results, allPassed: failed.length === 0, failedCount: failed.length };
}
