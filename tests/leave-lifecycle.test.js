/**
 * Leave year lifecycle: allocation continues from joining year through later years.
 * Run: node tests/leave-lifecycle.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', 'apps-script', 'src');
const context = {
  HRMS: {},
  Logger: { log: function () {} }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'foundation', 'Constants.gs'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'leave', 'LeaveEngine.gs'), 'utf8'), context);

const LeaveEngine = context.LeaveEngine;
const failures = [];

function check(name, cond, detail) {
  if (cond) {
    console.log('PASS ' + name + (detail ? ' — ' + detail : ''));
  } else {
    failures.push(name + (detail ? ': ' + detail : ''));
    console.log('FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}

const CL = { leave_type_id: 'LT001', annual_entitlement_days: 12, carry_forward_max_days: 5, requires_balance: true };
const SL = { leave_type_id: 'LT002', annual_entitlement_days: 6, carry_forward_max_days: 0, requires_balance: true };
const LOP = { leave_type_id: 'LT003', annual_entitlement_days: 0, carry_forward_max_days: 0, requires_balance: false };

function plan(opts) {
  return LeaveEngine.planBalanceGrants(Object.assign({
    startMonth: 1,
    types: [CL, SL, LOP]
  }, opts));
}

function yearsFor(planRows, typeId) {
  return planRows.filter(function (r) { return r.leave_type_id === typeId; })
    .map(function (r) { return r.leave_year; });
}

function persistSimulator() {
  var store = [];
  function existingFor(employeeId) {
    return store.filter(function (b) { return b.employee_id === employeeId; })
      .map(function (b) { return { leave_type_id: b.leave_type_id, leave_year: b.leave_year }; });
  }
  function find(employeeId, typeId, year) {
    for (var i = 0; i < store.length; i++) {
      var b = store[i];
      if (b.employee_id === employeeId && b.leave_type_id === typeId && String(b.leave_year) === String(year)) {
        return b;
      }
    }
    return null;
  }
  function grant(emp, types, asOf, targetYear) {
    var planned = LeaveEngine.planBalanceGrants({
      joiningDate: emp.joining_date,
      asOfDate: asOf,
      startMonth: 1,
      targetYear: targetYear,
      types: types,
      existing: existingFor(emp.employee_id)
    });
    planned.forEach(function (item) {
      var type = types.filter(function (t) { return t.leave_type_id === item.leave_type_id; })[0];
      var prev = find(emp.employee_id, item.leave_type_id, LeaveEngine.previousLeaveYear(item.leave_year));
      var cf = LeaveEngine.carryForwardDays(prev, type.carry_forward_max_days);
      var entitled = LeaveEngine.entitledDaysForLeaveYear
        ? LeaveEngine.entitledDaysForLeaveYear(emp.joining_date, item.leave_year, 1, type.annual_entitlement_days)
        : type.annual_entitlement_days;
      store.push({
        employee_id: emp.employee_id,
        leave_type_id: item.leave_type_id,
        leave_year: String(item.leave_year),
        entitled_days: entitled,
        used_days: 0,
        pending_days: 0,
        carried_forward_days: cf,
        available_days: LeaveEngine.availableDays({
          entitled_days: entitled,
          used_days: 0,
          pending_days: 0,
          carried_forward_days: cf
        })
      });
    });
    return planned;
  }
  function apply(employeeId, typeId, year, days) {
    var bal = find(employeeId, typeId, year);
    if (!bal) throw new Error('no balance ' + year);
    var available = LeaveEngine.availableDays(bal);
    if (available + 1e-9 < days) throw new Error('Insufficient leave balance.');
    bal.pending_days += days;
    bal.available_days = LeaveEngine.availableDays(bal);
    return bal;
  }
  function approve(employeeId, typeId, year, days) {
    var bal = find(employeeId, typeId, year);
    bal.pending_days -= days;
    bal.used_days += days;
    bal.available_days = LeaveEngine.availableDays(bal);
    return bal;
  }
  function reject(employeeId, typeId, year, days) {
    var bal = find(employeeId, typeId, year);
    bal.pending_days -= days;
    bal.available_days = LeaveEngine.availableDays(bal);
    return bal;
  }
  function cancelApproved(employeeId, typeId, year, days) {
    var bal = find(employeeId, typeId, year);
    bal.used_days -= days;
    bal.available_days = LeaveEngine.availableDays(bal);
    return bal;
  }
  function syncEntitlement(employeeId, typeId, year, policyDays) {
    var bal = find(employeeId, typeId, year);
    if (!bal || policyDays <= 0) return bal;
    if (LeaveEngine.toNumber(bal.used_days) > 0 || LeaveEngine.toNumber(bal.pending_days) > 0) return bal;
    if (LeaveEngine.toNumber(bal.entitled_days) === policyDays) return bal;
    bal.entitled_days = policyDays;
    bal.available_days = LeaveEngine.availableDays(bal);
    return bal;
  }
  return { store: store, grant: grant, find: find, apply: apply, approve: approve, reject: reject, cancelApproved: cancelApproved, syncEntitlement: syncEntitlement };
}

const hireCurrent = plan({
  joiningDate: '2026-04-01',
  asOfDate: '2026-09-15',
  existing: []
});
check('hire current year allocates that year', yearsFor(hireCurrent, 'LT001').join(',') === '2026');
check('lop type not balance-planned', yearsFor(hireCurrent, 'LT003').length === 0);

var proRataJoin = LeaveEngine.entitledDaysForLeaveYear('2024-07-01', '2024', 1, 12);
check('join-year pro-rata entitlement', proRataJoin > 5 && proRataJoin < 7, 'got ' + proRataJoin);
var fullAfterJoin = LeaveEngine.entitledDaysForLeaveYear('2024-07-01', '2025', 1, 12);
check('year after join full entitlement', fullAfterJoin === 12);

const hirePrevious = plan({
  joiningDate: '2025-03-01',
  asOfDate: '2026-09-15',
  existing: []
});
check('hire previous year backfills through current', yearsFor(hirePrevious, 'LT001').join(',') === '2025,2026');

const hireSeveral = plan({
  joiningDate: '2023-07-01',
  asOfDate: '2026-02-01',
  existing: []
});
check('hire several years ago backfills all years', yearsFor(hireSeveral, 'LT001').join(',') === '2023,2024,2025,2026');

const hireYearEnd = plan({
  joiningDate: '2025-12-31',
  asOfDate: '2026-01-02',
  existing: []
});
check('join 31 Dec then next year', yearsFor(hireYearEnd, 'LT001').join(',') === '2025,2026');

const hireYearStart = plan({
  joiningDate: '2026-01-01',
  asOfDate: '2026-01-01',
  existing: []
});
check('join 1 Jan current year only', yearsFor(hireYearStart, 'LT001').join(',') === '2026');

const future = plan({
  joiningDate: '2027-01-15',
  asOfDate: '2026-09-15',
  existing: []
});
check('future joiner not granted yet', future.length === 0);

const alreadyHasJoinYear = plan({
  joiningDate: '2024-06-01',
  asOfDate: '2026-09-15',
  existing: [
    { leave_type_id: 'LT001', leave_year: '2024' },
    { leave_type_id: 'LT002', leave_year: '2024' },
    { leave_type_id: 'LT003', leave_year: '2024' }
  ]
});
check('existing join-year continues to later years', yearsFor(alreadyHasJoinYear, 'LT001').join(',') === '2025,2026');
check('continuity does not duplicate join year', yearsFor(alreadyHasJoinYear, 'LT001').indexOf('2024') < 0);

const idempotent = plan({
  joiningDate: '2024-06-01',
  asOfDate: '2026-09-15',
  existing: [
    { leave_type_id: 'LT001', leave_year: '2024' },
    { leave_type_id: 'LT001', leave_year: '2025' },
    { leave_type_id: 'LT001', leave_year: '2026' },
    { leave_type_id: 'LT002', leave_year: '2024' },
    { leave_type_id: 'LT002', leave_year: '2025' },
    { leave_type_id: 'LT002', leave_year: '2026' },
    { leave_type_id: 'LT003', leave_year: '2024' },
    { leave_type_id: 'LT003', leave_year: '2025' },
    { leave_type_id: 'LT003', leave_year: '2026' }
  ]
});
check('re-grant is idempotent', idempotent.length === 0);

const newType = plan({
  joiningDate: '2024-06-01',
  asOfDate: '2026-09-15',
  types: [CL, SL, { leave_type_id: 'LT099', annual_entitlement_days: 3, carry_forward_max_days: 1 }],
  existing: [
    { leave_type_id: 'LT001', leave_year: '2024' },
    { leave_type_id: 'LT001', leave_year: '2025' },
    { leave_type_id: 'LT001', leave_year: '2026' },
    { leave_type_id: 'LT002', leave_year: '2024' },
    { leave_type_id: 'LT002', leave_year: '2025' },
    { leave_type_id: 'LT002', leave_year: '2026' }
  ]
});
check('new leave type granted for current year only', yearsFor(newType, 'LT099').join(',') === '2026');
check('new type not backfilled into closed years', yearsFor(newType, 'LT099').indexOf('2024') < 0);

const policyRespect = plan({
  joiningDate: '2025-01-01',
  asOfDate: '2026-01-01',
  types: [{ leave_type_id: 'LT-CUSTOM', annual_entitlement_days: 18, carry_forward_max_days: 7 }]
});
check('custom policy days are not hard-coded', yearsFor(policyRespect, 'LT-CUSTOM').join(',') === '2025,2026');

const fyApril = plan({
  joiningDate: '2026-03-15',
  asOfDate: '2026-04-10',
  startMonth: 4,
  existing: []
});
check('FY April join in March spans two leave years', yearsFor(fyApril, 'LT001').join(',') === '2025,2026');

const twoEmployees = ['2024-02-01', '2026-11-01'].map(function (join) {
  return yearsFor(plan({ joiningDate: join, asOfDate: '2026-12-01', existing: [] }), 'LT001');
});
check('multiple join years stay independent', twoEmployees[0].join(',') === '2024,2025,2026' && twoEmployees[1].join(',') === '2026');

const sim = persistSimulator();
const emp = { employee_id: 'SAPL-1001', joining_date: '2024-01-10' };
const types = [CL, SL];

sim.grant(emp, types, '2024-06-01', '2024');
const y2024 = sim.find('SAPL-1001', 'LT001', '2024');
var y2024Entitled = LeaveEngine.entitledDaysForLeaveYear('2024-01-10', '2024', 1, 12);
check('year X entitled from policy', y2024 && y2024.entitled_days === y2024Entitled && y2024.available_days === y2024Entitled);

sim.apply('SAPL-1001', 'LT001', '2024', 3);
sim.approve('SAPL-1001', 'LT001', '2024', 3);
check('year X after approve', sim.find('SAPL-1001', 'LT001', '2024').used_days === 3 &&
  sim.find('SAPL-1001', 'LT001', '2024').available_days === y2024Entitled - 3);

sim.grant(emp, types, '2025-01-05', '2025');
const y2025 = sim.find('SAPL-1001', 'LT001', '2025');
check('year X+1 allocation exists', !!y2025 && y2025.entitled_days === 12);
check('year X+1 carry-forward unused capped', y2025.carried_forward_days === 5 && y2025.available_days === 17);

sim.apply('SAPL-1001', 'LT001', '2025', 2);
sim.reject('SAPL-1001', 'LT001', '2025', 2);
check('reject restores pending', sim.find('SAPL-1001', 'LT001', '2025').pending_days === 0 &&
  sim.find('SAPL-1001', 'LT001', '2025').available_days === 17);

sim.apply('SAPL-1001', 'LT001', '2025', 1);
sim.approve('SAPL-1001', 'LT001', '2025', 1);
sim.cancelApproved('SAPL-1001', 'LT001', '2025', 1);
check('cancel approved restores used', sim.find('SAPL-1001', 'LT001', '2025').used_days === 0 &&
  sim.find('SAPL-1001', 'LT001', '2025').available_days === 17);

sim.grant(emp, types, '2026-02-01', '2026');
const y2026 = sim.find('SAPL-1001', 'LT001', '2026');
check('year X+2 allocation exists', !!y2026 && y2026.entitled_days === 12);
check('year X+2 uses current policy + CF', y2026.carried_forward_days === 5 && y2026.available_days === 17);

const secondGrant = sim.grant(emp, types, '2026-06-01', '2026');
check('switching years repeatedly does not duplicate', secondGrant.length === 0 &&
  sim.store.filter(function (b) { return b.leave_type_id === 'LT001'; }).length === 3);

let blocked = false;
try {
  sim.apply('SAPL-1001', 'LT001', '2026', 20);
} catch (e) {
  blocked = /Insufficient/.test(e.message);
}
check('insufficient balance in later year still blocked', blocked);

sim.apply('SAPL-1001', 'LT002', '2026', 1);
sim.approve('SAPL-1001', 'LT002', '2026', 1);
var sl2024Entitled = LeaveEngine.entitledDaysForLeaveYear('2024-01-10', '2024', 1, 6);
check('different leave type has its own year rows', sim.find('SAPL-1001', 'LT002', '2024').entitled_days === sl2024Entitled &&
  sim.find('SAPL-1001', 'LT002', '2026').used_days === 1);

const changedPolicy = persistSimulator();
changedPolicy.grant(emp, [{ leave_type_id: 'LT001', annual_entitlement_days: 12, carry_forward_max_days: 5 }], '2025-01-01', '2025');
const beforeChange = changedPolicy.find('SAPL-1001', 'LT001', '2025').entitled_days;
changedPolicy.grant(emp, [{ leave_type_id: 'LT001', annual_entitlement_days: 20, carry_forward_max_days: 5 }], '2026-01-01', '2026');
check('policy change does not rewrite prior year', changedPolicy.find('SAPL-1001', 'LT001', '2025').entitled_days === beforeChange);
check('new year uses updated policy', changedPolicy.find('SAPL-1001', 'LT001', '2026').entitled_days === 20);

const lateJoin = persistSimulator();
lateJoin.grant({ employee_id: 'SAPL-1002', joining_date: '2025-12-20' }, types, '2026-01-10', '2026');
check('late-year joiner has join year and next year', !!lateJoin.find('SAPL-1002', 'LT001', '2025') &&
  !!lateJoin.find('SAPL-1002', 'LT001', '2026'));

const staleZero = persistSimulator();
staleZero.grant(emp, [{ leave_type_id: 'LT001', annual_entitlement_days: 0, carry_forward_max_days: 5 }], '2026-01-01', '2026');
staleZero.syncEntitlement('SAPL-1001', 'LT001', '2026', 12);
check('stale zero entitlement syncs from policy', staleZero.find('SAPL-1001', 'LT001', '2026').entitled_days === 12 &&
  staleZero.find('SAPL-1001', 'LT001', '2026').available_days === 12);

if (failures.length) {
  console.error('\n' + failures.length + ' failed');
  process.exit(1);
}
console.log('\nAll leave lifecycle checks passed');
