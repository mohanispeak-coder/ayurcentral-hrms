/**
 * Pure leave math and rules — no spreadsheet I/O.
 * Payroll consumes LOP day counts via LeaveLopService (this file computes the split).
 */
var HRMS = HRMS || {};

HRMS.LEAVE_STATUS = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED'
};

HRMS.LEAVE_COUNT = {
  WEEKDAYS_ONLY: 'WEEKDAYS_ONLY',
  CALENDAR_DAYS: 'CALENDAR_DAYS'
};

HRMS.LEAVE_AUDIT = {
  SUBMIT: 'LEAVE_SUBMIT',
  APPROVE: 'LEAVE_APPROVE',
  REJECT: 'LEAVE_REJECT',
  CANCEL: 'LEAVE_CANCEL',
  TYPE_SAVE: 'LEAVE_TYPE_SAVE',
  YEAR_START: 'LEAVE_YEAR_START',
  GRANT: 'LEAVE_GRANT'
};

var LeaveEngine = (function () {
  function isTruthy(value) {
    if (value === true || value === 1) return true;
    var s = String(value == null ? '' : value).trim().toUpperCase();
    return s === 'TRUE' || s === 'YES' || s === 'Y' || s === '1';
  }

  function toNumber(value, fallback) {
    if (value === '' || value === null || value === undefined) {
      return fallback !== undefined ? fallback : 0;
    }
    var n = Number(value);
    return isNaN(n) ? (fallback !== undefined ? fallback : 0) : n;
  }

  function toDateOnly(value) {
    if (value === '' || value === null || value === undefined) return null;
    var d;
    if (Object.prototype.toString.call(value) === '[object Date]') {
      if (isNaN(value.getTime())) return null;
      d = value;
    } else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
      var parts = value.substring(0, 10).split('-');
      d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    } else {
      d = new Date(value);
    }
    if (isNaN(d.getTime())) return null;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function formatIsoDate(value) {
    var d = toDateOnly(value);
    if (!d) return '';
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }

  function addDays(date, n) {
    var d = toDateOnly(date);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  }

  function isWeekend(date) {
    var day = date.getDay();
    return day === 0 || day === 6;
  }

  function dayCounts(date, method) {
    var m = String(method || HRMS.LEAVE_COUNT.WEEKDAYS_ONLY).toUpperCase();
    if (m === HRMS.LEAVE_COUNT.CALENDAR_DAYS) return true;
    return !isWeekend(date);
  }

  /**
   * Server-authoritative day count.
   * Half-day: 0.5 when start === end.
   */
  function computeTotalDays(startDate, endDate, isHalfDay, countMethod) {
    var start = toDateOnly(startDate);
    var end = toDateOnly(endDate);
    if (!start || !end) return 0;
    if (isTruthy(isHalfDay)) return 0.5;
    var total = 0;
    var cursor = start;
    while (cursor.getTime() <= end.getTime()) {
      if (dayCounts(cursor, countMethod)) total += 1;
      cursor = addDays(cursor, 1);
    }
    return total;
  }

  /**
   * Leave year label (e.g. "2026") from a date and start month (1–12).
   * If start month is April (4) and date is 15 Mar 2026, year is 2025.
   */
  function getLeaveYear(date, startMonth) {
    var d = toDateOnly(date) || new Date();
    var sm = toNumber(startMonth, 1);
    if (sm < 1 || sm > 12) sm = 1;
    var year = d.getFullYear();
    if (d.getMonth() + 1 < sm) year -= 1;
    return String(year);
  }

  function availableDays(balance) {
    return roundHalf_(
      toNumber(balance.entitled_days) +
      toNumber(balance.carried_forward_days) -
      toNumber(balance.used_days) -
      toNumber(balance.pending_days)
    );
  }

  function roundHalf_(n) {
    return Math.round(n * 100) / 100;
  }

  function previousLeaveYear(leaveYear) {
    return String(toNumber(leaveYear) - 1);
  }

  function carryForwardDays(previousBalance, carryForwardMax) {
    if (!previousBalance) return 0;
    var unused = availableDays({
      entitled_days: previousBalance.entitled_days,
      carried_forward_days: previousBalance.carried_forward_days,
      used_days: previousBalance.used_days,
      pending_days: previousBalance.pending_days
    });
    if (unused < 0) unused = 0;
    var max = toNumber(carryForwardMax, 0);
    return unused < max ? unused : max;
  }

  /**
   * Inclusive date ranges overlap.
   * Two half-days on the same calendar day overlap only if the session is the same.
   * A full-day request overlaps any half-day on that date.
   */
  function requestsOverlap(a, b) {
    var aStart = toDateOnly(a.start_date);
    var aEnd = toDateOnly(a.end_date);
    var bStart = toDateOnly(b.start_date);
    var bEnd = toDateOnly(b.end_date);
    if (!aStart || !aEnd || !bStart || !bEnd) return false;
    if (aStart.getTime() > bEnd.getTime() || bStart.getTime() > aEnd.getTime()) return false;

    var aHalf = isTruthy(a.is_half_day);
    var bHalf = isTruthy(b.is_half_day);
    if (aHalf && bHalf) {
      var sameDay = aStart.getTime() === bStart.getTime() && aEnd.getTime() === aStart.getTime() &&
        bEnd.getTime() === bStart.getTime();
      if (sameDay) {
        var aSess = String(a.half_day_session || '').toUpperCase();
        var bSess = String(b.half_day_session || '').toUpperCase();
        if (aSess && bSess && aSess !== bSess) return false;
      }
    }
    return true;
  }

  function blockingStatuses() {
    return [HRMS.LEAVE_STATUS.SUBMITTED, HRMS.LEAVE_STATUS.APPROVED];
  }

  function isBlockingStatus(status) {
    return blockingStatuses().indexOf(String(status || '').toUpperCase()) >= 0;
  }

  /**
   * Days of an approved leave that fall in a payroll calendar month.
   * Splits multi-month leave. Uses the same count method as total_days.
   */
  function lopDaysInMonth(startDate, endDate, isHalfDay, countMethod, periodYear, periodMonth) {
    var start = toDateOnly(startDate);
    var end = toDateOnly(endDate);
    var year = toNumber(periodYear);
    var month = toNumber(periodMonth);
    if (!start || !end || !year || month < 1 || month > 12) return 0;
    if (isTruthy(isHalfDay)) {
      if (start.getFullYear() === year && start.getMonth() + 1 === month) return 0.5;
      return 0;
    }
    var total = 0;
    var cursor = start;
    while (cursor.getTime() <= end.getTime()) {
      if (cursor.getFullYear() === year && cursor.getMonth() + 1 === month && dayCounts(cursor, countMethod)) {
        total += 1;
      }
      cursor = addDays(cursor, 1);
    }
    return total;
  }

  function monthsTouched(startDate, endDate) {
    var start = toDateOnly(startDate);
    var end = toDateOnly(endDate);
    if (!start || !end) return [];
    var months = [];
    var y = start.getFullYear();
    var m = start.getMonth() + 1;
    var endY = end.getFullYear();
    var endM = end.getMonth() + 1;
    while (y < endY || (y === endY && m <= endM)) {
      months.push({ year: y, month: m });
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    return months;
  }

  function serviceDaysAt(joiningDate, asOfDate) {
    var join = toDateOnly(joiningDate);
    var asOf = toDateOnly(asOfDate);
    if (!join || !asOf) return 0;
    var ms = asOf.getTime() - join.getTime();
    if (ms < 0) return 0;
    return Math.floor(ms / (24 * 60 * 60 * 1000));
  }

  /**
   * Self-approve is always denied. HR/ADMIN may decide others. MANAGER: direct reports only.
   */
  function canApproveRequest(session, targetEmployeeId, managerEmployeeId) {
    if (!session || !session.authorized) return false;
    var role = String(session.role || '').toUpperCase();
    var selfId = String(session.employee_id || '');
    var target = String(targetEmployeeId || '');
    if (selfId && target && selfId === target) return false;
    if (role === HRMS.ROLES.ADMIN || role === HRMS.ROLES.HR) return true;
    if (role === HRMS.ROLES.MANAGER) {
      return String(managerEmployeeId || '') === selfId;
    }
    return false;
  }

  function canViewEmployeeLeave(session, targetEmployeeId, managerEmployeeId) {
    if (!session || !session.authorized) return false;
    var role = String(session.role || '').toUpperCase();
    var selfId = String(session.employee_id || '');
    var target = String(targetEmployeeId || '');
    if (selfId === target) return true;
    if (role === HRMS.ROLES.ADMIN || role === HRMS.ROLES.HR) return true;
    if (role === HRMS.ROLES.MANAGER) {
      return String(managerEmployeeId || '') === selfId;
    }
    return false;
  }

  function canCancel(session, request) {
    if (!session || !session.authorized || !request) return false;
    var status = String(request.status || '').toUpperCase();
    var role = String(session.role || '').toUpperCase();
    var own = String(session.employee_id || '') === String(request.employee_id || '');
    var hr = role === HRMS.ROLES.ADMIN || role === HRMS.ROLES.HR;
    if (status === HRMS.LEAVE_STATUS.DRAFT || status === HRMS.LEAVE_STATUS.SUBMITTED) {
      return own || hr;
    }
    if (status === HRMS.LEAVE_STATUS.APPROVED) {
      return hr;
    }
    return false;
  }

  function canApplyFor(session, targetEmployeeId) {
    if (!session || !session.authorized) return false;
    var role = String(session.role || '').toUpperCase();
    var target = String(targetEmployeeId || session.employee_id || '');
    if (!target) return false;
    if (role === HRMS.ROLES.ADMIN || role === HRMS.ROLES.HR) return true;
    return target === String(session.employee_id || '');
  }

  function normalizeSession(raw) {
    var s = String(raw || '').toUpperCase();
    if (s === 'AM' || s === 'PM') return s;
    return '';
  }

  return {
    isTruthy: isTruthy,
    toNumber: toNumber,
    toDateOnly: toDateOnly,
    formatIsoDate: formatIsoDate,
    computeTotalDays: computeTotalDays,
    getLeaveYear: getLeaveYear,
    availableDays: availableDays,
    previousLeaveYear: previousLeaveYear,
    carryForwardDays: carryForwardDays,
    requestsOverlap: requestsOverlap,
    isBlockingStatus: isBlockingStatus,
    blockingStatuses: blockingStatuses,
    lopDaysInMonth: lopDaysInMonth,
    monthsTouched: monthsTouched,
    serviceDaysAt: serviceDaysAt,
    canApproveRequest: canApproveRequest,
    canViewEmployeeLeave: canViewEmployeeLeave,
    canCancel: canCancel,
    canApplyFor: canApplyFor,
    normalizeSession: normalizeSession
  };
})();
