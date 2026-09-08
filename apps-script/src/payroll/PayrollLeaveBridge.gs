/**
 * Leave → Payroll LOP integration point.
 *
 * Preferred contract (Leave module — `12_BUILD_PLAN.md`):
 *   LeaveLopService.computeLopFromLeave(employeeId, periodYear, periodMonth)
 * Also accepts LeaveService.getApprovedLopForPayroll if that alias exists.
 *
 * Fallback: read-only LeaveRequests + LeaveTypes columns from `02`.
 * Does not mutate leave data or rebuild Leave workflow.
 * If Leave sheets are empty, returns 0.
 */
var PayrollLeaveBridge = (function () {
  function getApprovedLopForPayroll(employeeId, periodYear, periodMonth) {
    if (typeof LeaveLopService !== 'undefined' && LeaveLopService &&
        typeof LeaveLopService.computeLopFromLeave === 'function') {
      var fromLop = Number(LeaveLopService.computeLopFromLeave(employeeId, periodYear, periodMonth));
      return isFinite(fromLop) && fromLop > 0 ? fromLop : 0;
    }
    if (typeof LeaveService !== 'undefined' && LeaveService &&
        typeof LeaveService.getApprovedLopForPayroll === 'function') {
      var fromLeave = Number(LeaveService.getApprovedLopForPayroll(employeeId, periodYear, periodMonth));
      return isFinite(fromLeave) && fromLeave > 0 ? fromLeave : 0;
    }
    return readLopFromSchema_(employeeId, periodYear, periodMonth);
  }

  function readLopFromSchema_(employeeId, periodYear, periodMonth) {
    var year = Number(periodYear);
    var month = Number(periodMonth);
    if (!employeeId || !year || month < 1 || month > 12) return 0;

    var requests;
    var types;
    try {
      requests = DbService.findRecords(HRMS.SHEETS.LEAVE_REQUESTS, { employee_id: employeeId });
      types = DbService.getAllRecords(HRMS.SHEETS.LEAVE_TYPES);
    } catch (e) {
      return 0;
    }

    var lopTypeIds = {};
    (types || []).forEach(function (t) {
      if (isTruthy_(t.counts_as_lop) && t.leave_type_id) {
        lopTypeIds[String(t.leave_type_id)] = true;
      }
    });

    var monthStart = new Date(year, month - 1, 1);
    var monthEnd = new Date(year, month, 0);
    var total = 0;

    (requests || []).forEach(function (req) {
      if (String(req.status || '').toUpperCase() !== 'APPROVED') return;
      if (!lopTypeIds[String(req.leave_type_id)]) return;
      var start = toDate_(req.start_date);
      var end = toDate_(req.end_date);
      if (!start || !end) return;
      var overlapStart = start > monthStart ? start : monthStart;
      var overlapEnd = end < monthEnd ? end : monthEnd;
      if (overlapStart > overlapEnd) return;

      var spanDays = inclusiveDays_(start, end);
      var overlapDays = inclusiveDays_(overlapStart, overlapEnd);
      var requestDays = Number(req.total_days);
      if (!isFinite(requestDays) || requestDays < 0) {
        requestDays = isTruthy_(req.is_half_day) ? 0.5 : spanDays;
      }
      if (spanDays <= 0) return;
      var portion = requestDays * (overlapDays / spanDays);
      total += portion;
    });

    return PayrollEngine.round2(total);
  }

  function isTruthy_(v) {
    if (v === true || v === 1) return true;
    var s = String(v || '').toUpperCase();
    return s === 'TRUE' || s === 'YES' || s === '1';
  }

  function toDate_(v) {
    if (!v && v !== 0) return null;
    if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
      return new Date(v.getFullYear(), v.getMonth(), v.getDate());
    }
    var s = String(v).substring(0, 10);
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    var d = new Date(v);
    if (isNaN(d.getTime())) return null;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function inclusiveDays_(a, b) {
    var ms = b.getTime() - a.getTime();
    return Math.floor(ms / 86400000) + 1;
  }

  return {
    getApprovedLopForPayroll: getApprovedLopForPayroll
  };
})();
