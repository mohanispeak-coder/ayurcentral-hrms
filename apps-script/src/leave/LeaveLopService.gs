/**
 * Payroll LOP interface (Leave → Payroll).
 *
 * Payroll MUST call:
 *   LeaveLopService.computeLopFromLeave(employeeId, periodYear, periodMonth)
 * when creating or refreshing a non-LOCKED run, and store the result in
 * PayrollInputs.lop_from_leave. HR may set lop_days independently.
 *
 * Leave also refreshes existing non-LOCKED PayrollInputs.lop_from_leave after
 * approve / cancel-approved of counts_as_lop leave. Leave never writes
 * PayrollRecords and never mutates LOCKED runs.
 */
var HRMS = HRMS || {};

var LeaveLopService = (function () {
  function getCountMethod_() {
    return String(ConfigService.getSetting('leave_count_method', HRMS.LEAVE_COUNT.WEEKDAYS_ONLY) || HRMS.LEAVE_COUNT.WEEKDAYS_ONLY).toUpperCase();
  }

  function loadTypeMap_() {
    var map = {};
    DbService.getAllRecords(HRMS.SHEETS.LEAVE_TYPES).forEach(function (t) {
      map[String(t.leave_type_id)] = t;
    });
    return map;
  }

  /**
   * Sum of APPROVED leave days with counts_as_lop overlapping the calendar month.
   * Multi-month leave is split. Independent of payroll run existence.
   * @param {string} employeeId
   * @param {number|string} periodYear
   * @param {number|string} periodMonth 1–12
   * @return {number}
   */
  function computeLopFromLeave(employeeId, periodYear, periodMonth) {
    var types = loadTypeMap_();
    var method = getCountMethod_();
    var requests = DbService.findRecords(HRMS.SHEETS.LEAVE_REQUESTS, { employee_id: employeeId });
    var total = 0;
    requests.forEach(function (req) {
      if (String(req.status).toUpperCase() !== HRMS.LEAVE_STATUS.APPROVED) return;
      var type = types[String(req.leave_type_id)];
      if (!type || !LeaveEngine.isTruthy(type.counts_as_lop)) return;
      total += LeaveEngine.lopDaysInMonth(
        req.start_date,
        req.end_date,
        req.is_half_day,
        method,
        periodYear,
        periodMonth
      );
    });
    return Math.round(total * 100) / 100;
  }

  /**
   * One LeaveRequests read → employee_id → LOP days for a calendar month.
   * Same rules as computeLopFromLeave. Request-scoped only (no CacheService).
   * @param {number|string} periodYear
   * @param {number|string} periodMonth
   * @return {Object.<string, number>}
   */
  function computeLopMapForPeriod(periodYear, periodMonth) {
    var types = loadTypeMap_();
    var method = getCountMethod_();
    var requests;
    try {
      requests = DbService.getAllRecords(HRMS.SHEETS.LEAVE_REQUESTS);
    } catch (e) {
      return {};
    }
    var totals = {};
    (requests || []).forEach(function (req) {
      if (String(req.status).toUpperCase() !== HRMS.LEAVE_STATUS.APPROVED) return;
      var type = types[String(req.leave_type_id)];
      if (!type || !LeaveEngine.isTruthy(type.counts_as_lop)) return;
      var eid = String(req.employee_id || '');
      if (!eid) return;
      var days = LeaveEngine.lopDaysInMonth(
        req.start_date,
        req.end_date,
        req.is_half_day,
        method,
        periodYear,
        periodMonth
      );
      if (!days) return;
      totals[eid] = (totals[eid] || 0) + days;
    });
    Object.keys(totals).forEach(function (eid) {
      totals[eid] = Math.round(totals[eid] * 100) / 100;
    });
    return totals;
  }

  function isLockedRun_(run) {
    return String(run.status || '').toUpperCase() === 'LOCKED';
  }

  function refreshOpenPayrollLopCore_(employeeId, startDate, endDate) {
    var applied = [];
    var months;
    if (startDate && endDate) {
      months = LeaveEngine.monthsTouched(startDate, endDate);
    } else {
      var now = new Date();
      months = [{ year: now.getFullYear(), month: now.getMonth() + 1 }];
    }
    var runs = DbService.getAllRecords(HRMS.SHEETS.PAYROLL_RUNS);
    months.forEach(function (period) {
      var openRuns = runs.filter(function (run) {
        return LeaveEngine.toNumber(run.period_year) === period.year &&
          LeaveEngine.toNumber(run.period_month) === period.month &&
          !isLockedRun_(run);
      });
      if (!openRuns.length) return;
      var suggestion = computeLopFromLeave(employeeId, period.year, period.month);
      openRuns.forEach(function (run) {
        var existing = DbService.findOne(HRMS.SHEETS.PAYROLL_INPUTS, {
          payroll_run_id: run.payroll_run_id,
          employee_id: employeeId
        });
        if (!existing) return;
        DbService.updateRecord(HRMS.SHEETS.PAYROLL_INPUTS, 'payroll_input_id', existing.payroll_input_id, {
          lop_from_leave: suggestion
        });
        applied.push({
          payroll_run_id: run.payroll_run_id,
          employee_id: employeeId,
          lop_from_leave: suggestion
        });
      });
    });
    return applied;
  }

  /**
   * Update lop_from_leave on existing PayrollInputs for non-LOCKED runs that
   * overlap the given date range (or a single employee+month if dates omitted).
   * @param {string} employeeId
   * @param {Date|string=} startDate
   * @param {Date|string=} endDate
   * @param {Object=} options { alreadyLocked: true } when caller holds script lock
   * @return {Array.<Object>} updates applied
   */
  function refreshOpenPayrollLop(employeeId, startDate, endDate, options) {
    options = options || {};
    if (options.alreadyLocked) {
      return refreshOpenPayrollLopCore_(employeeId, startDate, endDate);
    }
    return withScriptLock_(function () {
      return refreshOpenPayrollLopCore_(employeeId, startDate, endDate);
    });
  }

  return {
    computeLopFromLeave: computeLopFromLeave,
    computeLopMapForPeriod: computeLopMapForPeriod,
    refreshOpenPayrollLop: refreshOpenPayrollLop,
    getApprovedLopForPayroll: computeLopFromLeave
  };
})();
