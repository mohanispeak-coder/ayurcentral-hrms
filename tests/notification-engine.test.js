/**
 * Local NotificationEngine tests (inbox, RBAC, duplicates, leave/PMS/ATS/birthday).
 * Run: node tests/notification-engine.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = path.join(__dirname, '..', 'apps-script', 'src');
const context = {
  HRMS: {},
  Logger: { log: function () {} }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(src, 'foundation', 'Constants.gs'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(src, 'notifications', 'NotificationEngine.gs'), 'utf8'), context);

const E = context.NotificationEngine;
const failures = [];

function check(name, cond, detail) {
  if (cond) {
    console.log('PASS ' + name + (detail ? ' — ' + detail : ''));
  } else {
    failures.push(name + (detail ? ': ' + detail : ''));
    console.log('FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}

const emp = {
  authorized: true,
  email: 'ada@client.com',
  employee_id: 'EMP003',
  role: 'EMPLOYEE'
};
const other = {
  authorized: true,
  email: 'bob@client.com',
  employee_id: 'EMP004',
  role: 'EMPLOYEE'
};
const manager = {
  authorized: true,
  email: 'mgr@client.com',
  employee_id: 'EMP002',
  role: 'MANAGER'
};
const hr = {
  authorized: true,
  email: 'hr@client.com',
  employee_id: 'EMP001',
  role: 'HR'
};
const unauth = { authorized: false, email: '', employee_id: '', role: '' };

function opts(extra) {
  extra = extra || {};
  let n = 0;
  return Object.assign({
    now: new Date('2026-08-29T10:00:00Z'),
    idFactory: function () {
      n += 1;
      return 'INB-TEST-' + n;
    },
    preferences: extra.preferences || [],
    orgSettings: extra.orgSettings || { notification_leave: true, notification_payroll: true }
  }, extra);
}

const leaveReq = {
  leave_request_id: 'LR-100',
  employee_id: 'EMP003',
  start_date: '2026-09-01',
  end_date: '2026-09-03',
  total_days: 3
};
const employeeRec = { employee_id: 'EMP003', display_name: 'Ada Employee', email: 'ada@client.com', work_email: 'ada@client.com' };
const managerRec = { employee_id: 'EMP002', display_name: 'Mo Manager', email: 'mgr@client.com' };

// --- create / unread / read / mark all ---
{
  const store = E.memoryStore();
  const o = opts();
  const submitted = E.payloads.leaveSubmitted(leaveReq, employeeRec, managerRec);
  const created = E.inbox.create(store, submitted, o);
  check('NTF-create', created.ok && created.created && created.record.notification_id === 'INB-TEST-1');
  check('NTF-unread-status', E.isUnread(created.record) && E.statusOf(created.record) === 'UNREAD');
  check('NTF-unread-count-owner', E.inbox.unreadCount(store, manager) === 1);
  check('NTF-unread-count-other', E.inbox.unreadCount(store, emp) === 0, 'submit goes to manager');

  const listed = E.inbox.list(store, manager, {});
  check('NTF-list-owner', listed.total === 1 && listed.items[0].title.indexOf('Ada') >= 0);
  check('NTF-list-other-empty', E.inbox.list(store, emp, {}).total === 0);

  const marked = E.inbox.markRead(store, 'INB-TEST-1', manager, new Date('2026-08-29T11:00:00Z'));
  check('NTF-mark-read', marked.ok && marked.changed && marked.record.status === 'READ');
  check('NTF-mark-read-unread-count', marked.unread_count === 0);
  check('NTF-unread-after-read', E.inbox.unreadCount(store, manager) === 0);

  const approved = E.payloads.leaveApproved(leaveReq, employeeRec);
  E.inbox.create(store, approved, o);
  const rejected = E.payloads.leaveRejected(Object.assign({}, leaveReq, { leave_request_id: 'LR-101' }), employeeRec);
  E.inbox.create(store, rejected, o);
  check('NTF-employee-unread-two', E.inbox.unreadCount(store, emp) === 2);

  let manyCalls = 0;
  const origMany = store.updateMany;
  store.updateMany = function (ids, fields) {
    manyCalls += 1;
    return origMany.call(store, ids, fields);
  };
  const all = E.inbox.markAllRead(store, emp, new Date('2026-08-29T12:00:00Z'));
  check('NTF-mark-all', all.ok && all.changed === 2);
  check('NTF-mark-all-one-batch', manyCalls === 1);
  check('NTF-mark-all-unread-count', all.unread_count === 0);
  check('NTF-mark-all-zero', E.inbox.unreadCount(store, emp) === 0);
  check('NTF-mark-all-does-not-touch-others', E.inbox.unreadCount(store, manager) === 0);
}

// --- RBAC ---
{
  const store = E.memoryStore();
  E.inbox.create(store, E.payloads.leaveApproved(leaveReq, employeeRec), opts());
  check('NTF-rbac-other-cannot-list', E.inbox.list(store, other, {}).total === 0);
  check('NTF-rbac-other-cannot-mark', E.inbox.markRead(store, 'INB-TEST-1', other).forbidden === true);
  check('NTF-rbac-unauth-cannot-list', E.inbox.list(store, unauth, {}).total === 0);
  check('NTF-rbac-hr-cannot-see-others-inbox', E.inbox.list(store, hr, {}).total === 0, 'inbox is recipient-scoped');
  check('NTF-rbac-hr-email-log', E.canViewEmailLog(hr) === true);
  check('NTF-rbac-emp-email-log', E.canViewEmailLog(emp) === false);
  check('NTF-rbac-hr-announce', E.canAnnounce(hr) === true);
  check('NTF-rbac-emp-announce', E.canAnnounce(emp) === false);
  check('NTF-rbac-manager-announce', E.canAnnounce(manager) === false);
}

// --- duplicates ---
{
  const store = E.memoryStore();
  const payload = E.payloads.leaveSubmitted(leaveReq, employeeRec, managerRec);
  const a = E.inbox.create(store, payload, opts());
  const b = E.inbox.create(store, payload, opts());
  check('NTF-dup-second', b.duplicate === true && b.created === false);
  check('NTF-dup-same-id', b.record.notification_id === a.record.notification_id);
  check('NTF-dup-store-one', store.list().length === 1);

  const many = E.inbox.createMany(store, [payload, payload], opts());
  check('NTF-dup-batch', many[0].duplicate && many[1].duplicate);
}

// --- leave cancel payloads ---
{
  const cancelledEmp = E.payloads.leaveCancelled(Object.assign({ display_name: 'Ada Employee' }, leaveReq), employeeRec, 'HR');
  check('NTF-leave-cancel-emp', cancelledEmp.type === 'LEAVE_CANCELLED' && cancelledEmp.recipient_employee_id === 'EMP003');
  const cancelledMgr = E.payloads.leaveCancelled(Object.assign({ display_name: 'Ada Employee' }, leaveReq), managerRec, 'HR');
  check('NTF-leave-cancel-mgr', cancelledMgr.recipient_employee_id === 'EMP002');
  check('NTF-leave-submit-route', E.payloads.leaveSubmitted(leaveReq, employeeRec, managerRec).action_route === 'leave-approvals');
}

// --- payroll / payslip no net ---
{
  const run = { payroll_run_id: 'PR-1', period_year: 2026, period_month: 8 };
  const rec = { payroll_record_id: 'PREC-1', employee_id: 'EMP003', net_pay: 99999 };
  const slip = E.payloads.payslipAvailable(rec, employeeRec, run);
  check('NTF-payslip-subject', slip.email_subject === 'Payslip available — August 2026');
  check('NTF-payslip-no-net-title', !E.payslipContainsNet(slip.title) && slip.title.indexOf('99999') < 0);
  check('NTF-payslip-no-net-body', !E.payslipContainsNet(slip.email_body) && String(slip.email_body).indexOf('99999') < 0);
  check('NTF-payslip-route', slip.action_route === 'my-payslips');

  const review = E.payloads.payrollReadyReview(run, hr);
  check('NTF-payroll-review', review.type === 'PAYROLL_READY_REVIEW' && review.title.indexOf('August') >= 0);
  const locked = E.payloads.payrollLocked(run, hr);
  check('NTF-payroll-locked-email-default-off', E.getTypeDef('PAYROLL_LOCKED').emailDefault === false);

  const bad = E.validateCreate(Object.assign({}, slip, { title: 'Payslip net pay ₹1000', email_subject: 'Payslip net pay ₹1000' }));
  check('NTF-payslip-reject-net', bad.indexOf('Payslip notifications must not include net pay.') >= 0);
}

// --- PMS / ATS ---
{
  const cycle = { cycle_id: 'CY-1', name: 'FY26 H1' };
  check('NTF-pms-open', E.payloads.pmsCycleOpen(cycle, emp).type === 'PMS_CYCLE_OPEN');
  check('NTF-pms-self', E.payloads.pmsSelfAssessmentDue(cycle, emp).priority === 'HIGH');
  check('NTF-pms-mgr', E.payloads.pmsManagerReviewPending(cycle, manager, 'Ada').message.indexOf('Ada') >= 0);
  check('NTF-pms-final', E.payloads.pmsFinalized(cycle, emp).type === 'PMS_FINALIZED');

  const appn = { application_id: 'APP-9', candidate_name: 'Riya', requisition_title: 'Pharmacist' };
  check('NTF-ats-new', E.payloads.atsInternal('ATS_NEW_APPLICATION', appn, hr).title.indexOf('New application') >= 0);
  check('NTF-ats-shortlist', E.payloads.atsInternal('ATS_SHORTLISTED', appn, hr).type === 'ATS_SHORTLISTED');
  check('NTF-ats-interview', E.payloads.atsInternal('ATS_INTERVIEW_SCHEDULED', appn, hr).type === 'ATS_INTERVIEW_SCHEDULED');
  check('NTF-ats-feedback', E.payloads.atsInternal('ATS_FEEDBACK_PENDING', appn, hr).type === 'ATS_FEEDBACK_PENDING');
  check('NTF-ats-selected', E.payloads.atsInternal('ATS_SELECTED', appn, hr).type === 'ATS_SELECTED');

  const cand = E.payloads.atsCandidateEmail('ATS_CANDIDATE_APPLICATION', {
    candidate_email: 'riya@example.com',
    candidate_name: 'Riya',
    application_id: 'APP-9',
    requisition_title: 'Pharmacist'
  });
  check('NTF-ats-candidate-email', cand.ok && cand.internal === false && cand.to === 'riya@example.com');
  check('NTF-ats-candidate-no-hrms', String(cand.body).indexOf('employee_id') < 0 && String(cand.body).indexOf('/exec') < 0);

  const store = E.memoryStore();
  const candCreate = E.inbox.create(store, {
    type: 'ATS_CANDIDATE_APPLICATION',
    title: 'x',
    recipient_email: 'riya@example.com'
  }, opts());
  check('NTF-ats-candidate-not-inbox', candCreate.candidateEmail === true && store.list().length === 0);
}

// --- birthday / anniversary ---
{
  check('NTF-bday-match', E.birthdayMatches('1990-08-29', '2026-08-29') === true);
  check('NTF-bday-other', E.birthdayMatches('1990-08-28', '2026-08-29') === false);
  check('NTF-bday-leap-nonleap', E.birthdayMatches('1992-02-29', '2026-02-28') === true);
  check('NTF-bday-leap-year', E.birthdayMatches('1992-02-29', '2024-02-29') === true);
  check('NTF-anniv-first-year-skip', E.anniversaryMatches('2026-08-29', '2026-08-29') === false);
  check('NTF-anniv-match', E.anniversaryMatches('2020-08-29', '2026-08-29') === true);
  check('NTF-anniv-years', E.anniversaryYears('2020-08-29', '2026-08-29') === 6);

  const store = E.memoryStore();
  const b1 = E.payloads.happyBirthday(employeeRec, 2026);
  const c1 = E.inbox.create(store, b1, opts());
  const c2 = E.inbox.create(store, E.payloads.happyBirthday(employeeRec, 2026), opts());
  check('NTF-bday-dedupe-year', c1.created && c2.duplicate);
  const c3 = E.inbox.create(store, E.payloads.happyBirthday(employeeRec, 2027), opts());
  check('NTF-bday-next-year', c3.created === true);
}

// --- preferences / org email kill switch ---
{
  const def = E.getTypeDef('LEAVE_SUBMITTED');
  const channels = E.resolveChannels(def, { in_app_enabled: true, email_enabled: false }, { notification_leave: true }, {});
  check('NTF-pref-email-off', channels.inApp === true && channels.email === false);
  const orgOff = E.resolveChannels(def, null, { notification_leave: false }, {});
  check('NTF-org-leave-email-off', orgOff.email === false && orgOff.inApp === true);
  const store = E.memoryStore();
  const skipped = E.inbox.create(store, E.payloads.leaveSubmitted(leaveReq, employeeRec, managerRec), opts({
    preferences: [{ employee_id: 'EMP002', notification_type: 'LEAVE_SUBMITTED', in_app_enabled: false, email_enabled: false }]
  }));
  check('NTF-both-channels-off', skipped.skipped === true && store.list().length === 0);
}

// --- batch createMany ---
{
  const store = E.memoryStore();
  const run = { payroll_run_id: 'PR-9', period_year: 2026, period_month: 3 };
  const inputs = ['EMP003', 'EMP004'].map(function (id) {
    return E.payloads.payslipAvailable(
      { payroll_record_id: 'R-' + id, employee_id: id },
      { employee_id: id, email: id.toLowerCase() + '@client.com', display_name: id },
      run
    );
  });
  const results = E.inbox.createMany(store, inputs, opts());
  check('NTF-batch-two', results.length === 2 && results.every(function (r) { return r.created; }));
  check('NTF-batch-store', store.list().length === 2);
}

check('NTF-schema-types', E.catalog().length >= 20);

if (failures.length) {
  console.error('\n' + failures.length + ' failed:\n' + failures.join('\n'));
  process.exit(1);
}
console.log('\nAll notification engine tests passed.');
