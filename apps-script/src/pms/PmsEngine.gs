/**
 * Pure PMS rules — no spreadsheet I/O, no session services.
 * Ratings, weights, transitions, AuthZ predicates, and KPI aggregation live here.
 */
var HRMS = HRMS || {};

var PmsEngine = (function () {
  if (!HRMS.PMS || !HRMS.PMS.CYCLE_STATUS) {
    throw new Error('PmsConstants must load before PmsEngine.');
  }
  var CS = HRMS.PMS.CYCLE_STATUS;
  var GS = HRMS.PMS.GOAL_STATUS;
  var RS = HRMS.PMS.REVIEW_STATUS;
  var ACT = HRMS.PMS.ACTIONS;

  function fail_(message, details) {
    if (typeof validationError_ === 'function') {
      throw validationError_(message, details || null);
    }
    var err = new Error(message);
    err.hrmsCode = (typeof HRMS !== 'undefined' && HRMS.ERROR_CODES && HRMS.ERROR_CODES.VALIDATION) || 'VALIDATION_ERROR';
    err.hrmsDetails = details || null;
    throw err;
  }

  function conflict_(message) {
    if (typeof conflictError_ === 'function') {
      throw conflictError_(message);
    }
    var err = new Error(message);
    err.hrmsCode = (typeof HRMS !== 'undefined' && HRMS.ERROR_CODES && HRMS.ERROR_CODES.CONFLICT) || 'CONFLICT_ERROR';
    throw err;
  }

  function denied_(message) {
    if (typeof authorizationError_ === 'function') {
      throw authorizationError_(message || 'You do not have permission to perform this action.');
    }
    var err = new Error(message || 'You do not have permission to perform this action.');
    err.hrmsCode = (typeof HRMS !== 'undefined' && HRMS.ERROR_CODES && HRMS.ERROR_CODES.AUTHORIZATION) || 'AUTHORIZATION_ERROR';
    throw err;
  }

  function trim_(v) {
    return String(v == null ? '' : v).trim();
  }

  function upper_(v) {
    return trim_(v).toUpperCase();
  }

  function isTruthy(value) {
    if (value === true || value === 1) return true;
    var s = trim_(value).toUpperCase();
    return s === 'TRUE' || s === 'YES' || s === 'Y' || s === '1';
  }

  function num_(value, fallback) {
    if (value === '' || value === null || value === undefined) {
      return fallback !== undefined ? fallback : 0;
    }
    var n = Number(value);
    return isFinite(n) ? n : (fallback !== undefined ? fallback : 0);
  }

  function round2(n) {
    var x = Number(n);
    if (!isFinite(x)) x = 0;
    var sign = x < 0 ? -1 : 1;
    return sign * Math.round(Math.abs(x) * 100 + 1e-8) / 100;
  }

  function round1(n) {
    var x = Number(n);
    if (!isFinite(x)) return 0;
    return Math.round(x * 10 + 1e-8) / 10;
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

  function dateMs(value) {
    var d = toDateOnly(value);
    return d ? d.getTime() : 0;
  }

  function isHrOrAdmin(session) {
    if (!session || !session.authorized) return false;
    var role = upper_(session.role);
    return role === HRMS.ROLES.HR || role === HRMS.ROLES.ADMIN;
  }

  function isAdmin(session) {
    return !!(session && session.authorized && upper_(session.role) === HRMS.ROLES.ADMIN);
  }

  function isManager(session) {
    return !!(session && session.authorized && upper_(session.role) === HRMS.ROLES.MANAGER);
  }

  function isEmployeeRole(session) {
    return !!(session && session.authorized && upper_(session.role) === HRMS.ROLES.EMPLOYEE);
  }

  function sameEmployeeId(a, b) {
    return trim_(a) !== '' && trim_(a).toLowerCase() === trim_(b).toLowerCase();
  }

  function isDirectReport(session, employee) {
    if (!session || !employee) return false;
    return sameEmployeeId(employee.manager_employee_id, session.employee_id);
  }

  function isSelf(session, employeeId) {
    return !!(session && sameEmployeeId(session.employee_id, employeeId));
  }

  /**
   * Allowed cycle transitions. Reopen edges are explicit.
   * @return {Object.<string, Array.<string>>}
   */
  function transitionMap() {
    var map = {};
    map[CS.DRAFT] = [CS.OPEN];
    map[CS.OPEN] = [CS.EMPLOYEE_SUBMITTED, CS.DRAFT];
    map[CS.EMPLOYEE_SUBMITTED] = [CS.MANAGER_REVIEW, CS.OPEN];
    map[CS.MANAGER_REVIEW] = [CS.FINALIZED, CS.EMPLOYEE_SUBMITTED];
    map[CS.FINALIZED] = [CS.CLOSED];
    map[CS.CLOSED] = [];
    return map;
  }

  function isValidTransition(fromStatus, toStatus) {
    var from = upper_(fromStatus);
    var to = upper_(toStatus);
    if (from === to) return false;
    var allowed = transitionMap()[from] || [];
    return allowed.indexOf(to) >= 0;
  }

  function assertTransition(fromStatus, toStatus) {
    var from = upper_(fromStatus);
    var to = upper_(toStatus);
    if (!from || !CS[from]) fail_('Unknown cycle status: ' + fromStatus);
    if (!to || !CS[to]) fail_('Unknown cycle status: ' + toStatus);
    if (!isValidTransition(from, to)) {
      conflict_('Cannot change a cycle from ' + from + ' to ' + to + '.');
    }
    return { from: from, to: to };
  }

  function isActiveCycleStatus(status) {
    var s = upper_(status);
    return s === CS.OPEN || s === CS.EMPLOYEE_SUBMITTED || s === CS.MANAGER_REVIEW;
  }

  function isTerminalCycleStatus(status) {
    var s = upper_(status);
    return s === CS.FINALIZED || s === CS.CLOSED;
  }

  function isGoalCountable(goal) {
    if (!goal) return false;
    return upper_(goal.status) !== GS.CANCELLED;
  }

  function validateCycleFields(payload, isCreate) {
    payload = payload || {};
    var name = trim_(payload.name);
    if (!name) fail_('Cycle name is required.');
    if (name.length > HRMS.PMS.NAME_MAX) fail_('Cycle name must be ' + HRMS.PMS.NAME_MAX + ' characters or fewer.');

    var start = toDateOnly(payload.start_date);
    var end = toDateOnly(payload.end_date);
    if (!start) fail_('Start date is required.');
    if (!end) fail_('End date is required.');
    if (end.getTime() < start.getTime()) fail_('End date cannot be before start date.');

    var submitBy = toDateOnly(payload.submission_deadline);
    var reviewBy = toDateOnly(payload.review_deadline);
    if (!submitBy) fail_('Self-assessment deadline is required.');
    if (!reviewBy) fail_('Manager review deadline is required.');
    if (submitBy.getTime() < start.getTime()) fail_('Self-assessment deadline cannot be before the cycle start.');
    if (reviewBy.getTime() < submitBy.getTime()) fail_('Manager review deadline cannot be before the self-assessment deadline.');

    return {
      name: name,
      start_date: formatIsoDate(start),
      end_date: formatIsoDate(end),
      submission_deadline: formatIsoDate(submitBy),
      review_deadline: formatIsoDate(reviewBy),
      notes: trim_(payload.notes).substring(0, HRMS.PMS.TEXT_MAX)
    };
  }

  /**
   * @param {number} weight
   * @return {number} rounded weight
   */
  function validateWeightValue(weight) {
    if (weight === '' || weight === null || weight === undefined) {
      fail_('Goal weight is required.');
    }
    var n = Number(weight);
    if (!isFinite(n)) fail_('Goal weight must be a number.');
    n = round2(n);
    if (n <= 0) fail_('Goal weight must be greater than 0.');
    if (n > HRMS.PMS.WEIGHT_TOTAL) fail_('Goal weight cannot exceed ' + HRMS.PMS.WEIGHT_TOTAL + '.');
    return n;
  }

  /**
   * @param {Array.<Object>} goals
   * @return {{ ok: boolean, total: number, message: string, countable: number }}
   */
  function validateWeights(goals) {
    var list = (goals || []).filter(isGoalCountable);
    var total = 0;
    for (var i = 0; i < list.length; i++) {
      var w = Number(list[i].weight);
      if (!isFinite(w) || w <= 0) {
        return {
          ok: false,
          total: round2(total),
          countable: list.length,
          message: 'Each active goal needs a weight greater than 0.'
        };
      }
      total += w;
    }
    total = round2(total);
    if (!list.length) {
      return { ok: false, total: 0, countable: 0, message: 'At least one active goal is required.' };
    }
    if (Math.abs(total - HRMS.PMS.WEIGHT_TOTAL) > HRMS.PMS.WEIGHT_EPS) {
      return {
        ok: false,
        total: total,
        countable: list.length,
        message: 'Goal weights must add up to ' + HRMS.PMS.WEIGHT_TOTAL + ' (currently ' + total + ').'
      };
    }
    return { ok: true, total: total, countable: list.length, message: '' };
  }

  function assertWeightsForSubmit(goals) {
    var result = validateWeights(goals);
    if (!result.ok) fail_(result.message, { total: result.total });
    return result;
  }

  function validateGoalFields(payload, opts) {
    opts = opts || {};
    var title = trim_(payload.title);
    if (!title) fail_('Goal title is required.');
    if (title.length > HRMS.PMS.TITLE_MAX) fail_('Goal title must be ' + HRMS.PMS.TITLE_MAX + ' characters or fewer.');
    var employeeId = trim_(payload.employee_id);
    if (!employeeId && !opts.allowMissingEmployee) fail_('Employee ID is required.');
    var cycleId = trim_(payload.cycle_id);
    if (!cycleId && !opts.allowMissingCycle) fail_('Cycle is required.');
    var weight = payload.weight;
    if (opts.skipWeight) {
      weight = num_(payload.weight, 0);
    } else {
      weight = validateWeightValue(payload.weight);
    }
    var status = upper_(payload.status) || GS.ACTIVE;
    if (!GS[status]) fail_('Unknown goal status: ' + payload.status);
    var progress = payload.progress;
    if (progress === '' || progress === null || progress === undefined) progress = 0;
    progress = Number(progress);
    if (!isFinite(progress)) fail_('Progress must be a number.');
    if (progress < 0 || progress > 100) fail_('Progress must be between 0 and 100.');
    return {
      cycle_id: cycleId,
      employee_id: employeeId,
      title: title,
      description: trim_(payload.description).substring(0, HRMS.PMS.TEXT_MAX),
      measurement: trim_(payload.measurement).substring(0, HRMS.PMS.TEXT_MAX),
      target: trim_(payload.target).substring(0, HRMS.PMS.TEXT_MAX),
      weight: weight,
      status: status,
      progress: round2(progress),
      achievement: trim_(payload.achievement).substring(0, HRMS.PMS.TEXT_MAX)
    };
  }

  /**
   * Configurable scale. Never assume 1–5 in callers — use this.
   * @param {Array.<Object>} scale
   * @return {Array.<Object>}
   */
  function normalizeScale(scale) {
    var list = (scale || []).filter(function (row) {
      return isTruthy(row.is_active !== undefined ? row.is_active : true);
    }).map(function (row) {
      return {
        rating_id: trim_(row.rating_id),
        scale_code: trim_(row.scale_code) || HRMS.PMS.SCALE_CODE,
        value: num_(row.value),
        label: trim_(row.label),
        description: trim_(row.description),
        sort_order: num_(row.sort_order, num_(row.value)),
        is_active: true
      };
    }).filter(function (row) {
      return row.value && row.label;
    });
    list.sort(function (a, b) {
      return a.sort_order - b.sort_order || a.value - b.value;
    });
    return list;
  }

  function defaultScale() {
    return (HRMS.PMS.DEFAULT_RATINGS || []).map(function (row, i) {
      return {
        rating_id: '',
        scale_code: HRMS.PMS.SCALE_CODE,
        value: row.value,
        label: row.label,
        description: row.description,
        sort_order: row.sort_order || (i + 1),
        is_active: true
      };
    });
  }

  function scaleValues(scale) {
    return normalizeScale(scale && scale.length ? scale : defaultScale()).map(function (r) {
      return r.value;
    });
  }

  function isAllowedRating(value, scale) {
    if (value === '' || value === null || value === undefined) return true;
    var n = Number(value);
    if (!isFinite(n)) return false;
    var values = scaleValues(scale);
    for (var i = 0; i < values.length; i++) {
      if (values[i] === n) return true;
    }
    return false;
  }

  function assertRating(value, scale, fieldLabel) {
    if (value === '' || value === null || value === undefined) return '';
    var n = Number(value);
    if (!isFinite(n) || !isAllowedRating(n, scale)) {
      fail_((fieldLabel || 'Rating') + ' is not on the configured scale.');
    }
    return n;
  }

  function ratingLabel(value, scale) {
    if (value === '' || value === null || value === undefined) return '';
    var n = Number(value);
    var list = normalizeScale(scale && scale.length ? scale : defaultScale());
    for (var i = 0; i < list.length; i++) {
      if (list[i].value === n) return list[i].label;
    }
    return '';
  }

  function validateRatingScalePayload(items) {
    var rows = items || [];
    if (!rows.length) fail_('At least one rating is required.');
    var seen = {};
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var value = Number(rows[i].value);
      var label = trim_(rows[i].label);
      if (!isFinite(value) || value <= 0) fail_('Each rating needs a numeric value greater than 0.');
      if (!label) fail_('Each rating needs a label.');
      if (seen[String(value)]) fail_('Duplicate rating value: ' + value);
      seen[String(value)] = true;
      out.push({
        value: value,
        label: label.substring(0, 80),
        description: trim_(rows[i].description).substring(0, HRMS.PMS.TEXT_MAX),
        sort_order: num_(rows[i].sort_order, i + 1),
        is_active: rows[i].is_active === false || trim_(rows[i].is_active).toUpperCase() === 'FALSE' ? false : true
      });
    }
    var active = out.filter(function (r) { return r.is_active; });
    if (!active.length) fail_('Keep at least one active rating.');
    return out;
  }

  /**
   * Weighted overall from manager ratings (falls back to employee ratings if specified).
   * @param {Array.<Object>} goals
   * @param {string=} source manager|employee|auto
   * @return {number|null}
   */
  function computeOverallRating(goals, source) {
    var mode = trim_(source).toLowerCase() || 'auto';
    var list = (goals || []).filter(isGoalCountable);
    var acc = 0;
    var wsum = 0;
    for (var i = 0; i < list.length; i++) {
      var w = Number(list[i].weight);
      if (!isFinite(w) || w <= 0) continue;
      var r = null;
      if (mode === 'manager') {
        r = list[i].manager_rating;
      } else if (mode === 'employee') {
        r = list[i].employee_rating;
      } else {
        r = list[i].manager_rating;
        if (r === '' || r === null || r === undefined) r = list[i].employee_rating;
      }
      if (r === '' || r === null || r === undefined) continue;
      var n = Number(r);
      if (!isFinite(n)) continue;
      acc += n * w;
      wsum += w;
    }
    if (wsum <= 0) return null;
    return round1(acc / wsum);
  }

  function nearestScaleValue(raw, scale) {
    if (raw === null || raw === undefined || raw === '') return null;
    var n = Number(raw);
    if (!isFinite(n)) return null;
    var values = scaleValues(scale);
    if (!values.length) return round1(n);
    var best = values[0];
    var bestDist = Math.abs(n - best);
    for (var i = 1; i < values.length; i++) {
      var dist = Math.abs(n - values[i]);
      if (dist < bestDist) {
        best = values[i];
        bestDist = dist;
      }
    }
    return best;
  }

  function reviewStatusRank(status) {
    var order = [RS.NOT_STARTED, RS.IN_PROGRESS, RS.SELF_SUBMITTED, RS.MANAGER_SUBMITTED, RS.FINALIZED];
    var idx = order.indexOf(upper_(status));
    return idx < 0 ? 0 : idx;
  }

  function canEmployeeEditReview(cycle, review) {
    if (!cycle) return false;
    if (upper_(cycle.status) !== CS.OPEN) return false;
    var st = upper_(review && review.status);
    if (!st || st === RS.NOT_STARTED || st === RS.IN_PROGRESS) return true;
    if (isTruthy(review && review.reopen_allowed) && st === RS.SELF_SUBMITTED) return true;
    return false;
  }

  function canEmployeeSubmit(cycle, review) {
    return canEmployeeEditReview(cycle, review);
  }

  function assertEmployeeCanSubmit(cycle, review, goals) {
    if (!cycle) fail_('Cycle was not found.');
    if (upper_(cycle.status) !== CS.OPEN) {
      conflict_('Self-assessment is only allowed while the cycle is open.');
    }
    var st = upper_(review && review.status);
    if (st === RS.SELF_SUBMITTED && !isTruthy(review.reopen_allowed)) {
      conflict_('Self-assessment is already submitted.');
    }
    if (st === RS.MANAGER_SUBMITTED || st === RS.FINALIZED) {
      conflict_('This review can no longer be changed by the employee.');
    }
    if (isTerminalCycleStatus(cycle.status)) {
      conflict_('This cycle is closed to self-assessment.');
    }
    assertWeightsForSubmit(goals);
  }

  function canManagerEditReview(cycle, review) {
    if (!cycle) return false;
    var cs = upper_(cycle.status);
    if (cs !== CS.EMPLOYEE_SUBMITTED && cs !== CS.MANAGER_REVIEW) return false;
    var st = upper_(review && review.status);
    if (st === RS.FINALIZED) return false;
    if (st === RS.MANAGER_SUBMITTED) return false;
    return st === RS.SELF_SUBMITTED || st === RS.IN_PROGRESS || st === RS.NOT_STARTED;
  }

  function assertManagerCanSubmit(cycle, review, goals) {
    if (!cycle) fail_('Cycle was not found.');
    var cs = upper_(cycle.status);
    if (cs !== CS.EMPLOYEE_SUBMITTED && cs !== CS.MANAGER_REVIEW) {
      conflict_('Manager review is only allowed after self-assessment is closed.');
    }
    var st = upper_(review && review.status);
    if (st === RS.MANAGER_SUBMITTED) conflict_('Manager review is already submitted.');
    if (st === RS.FINALIZED) conflict_('This review is already finalized.');
    if (st !== RS.SELF_SUBMITTED) {
      conflict_('The employee must submit a self-assessment before the manager review.');
    }
    assertWeightsForSubmit(goals);
    var list = (goals || []).filter(isGoalCountable);
    for (var i = 0; i < list.length; i++) {
      if (list[i].manager_rating === '' || list[i].manager_rating === null || list[i].manager_rating === undefined) {
        fail_('Rate every active goal before submitting the manager review.');
      }
    }
  }

  function assertCanFinalize(cycle, review) {
    if (!cycle) fail_('Cycle was not found.');
    var cs = upper_(cycle.status);
    if (cs !== CS.MANAGER_REVIEW && cs !== CS.FINALIZED) {
      conflict_('Reviews can be finalized after manager review has started.');
    }
    if (cs === CS.CLOSED) conflict_('This cycle is closed.');
    var st = upper_(review && review.status);
    if (st === RS.FINALIZED) conflict_('This review is already finalized.');
    if (st !== RS.MANAGER_SUBMITTED) {
      conflict_('The manager must submit a review before HR can finalize it.');
    }
  }

  function assertCanReopenSelf(cycle, review) {
    if (!cycle) fail_('Cycle was not found.');
    var cs = upper_(cycle.status);
    if (cs !== CS.OPEN && cs !== CS.EMPLOYEE_SUBMITTED) {
      conflict_('Self-assessment can only be reopened while the cycle is in self-assessment.');
    }
    var st = upper_(review && review.status);
    if (st !== RS.SELF_SUBMITTED) conflict_('Only a submitted self-assessment can be reopened.');
  }

  /**
   * AuthZ predicates — no I/O.
   * @param {string} action HRMS.PMS.ACTIONS
   * @param {Object} session
   * @param {Object=} ctx { employeeId, employee, review }
   */
  function can(action, session, ctx) {
    ctx = ctx || {};
    if (!session || !session.authorized) return false;
    var employeeId = trim_(ctx.employeeId || (ctx.employee && ctx.employee.employee_id) || (ctx.review && ctx.review.employee_id));
    var employee = ctx.employee || {};
    var review = ctx.review || {};

    if (action === ACT.VIEW_DASHBOARD || action === ACT.VIEW_OWN) {
      return true;
    }
    if (action === ACT.MANAGE_CYCLES || action === ACT.MANAGE_RATINGS || action === ACT.FINALIZE || action === ACT.REOPEN) {
      return isHrOrAdmin(session);
    }
    if (action === ACT.MANAGE_GOALS) {
      if (isHrOrAdmin(session)) return true;
      if (isManager(session) && employeeId) {
        return isDirectReport(session, employee) || sameEmployeeId(review.manager_employee_id, session.employee_id);
      }
      return false;
    }
    if (action === ACT.SELF_ASSESS) {
      return isSelf(session, employeeId);
    }
    if (action === ACT.VIEW_TEAM) {
      return isHrOrAdmin(session) || isManager(session);
    }
    if (action === ACT.MANAGER_REVIEW) {
      if (isHrOrAdmin(session)) return true;
      if (!isManager(session)) return false;
      if (isSelf(session, employeeId)) return false;
      return isDirectReport(session, employee) || sameEmployeeId(review.manager_employee_id, session.employee_id);
    }
    return false;
  }

  function requireCan(action, session, ctx) {
    if (!can(action, session, ctx)) denied_();
    return session;
  }

  function canViewEmployeePms(session, employee, review) {
    if (!session || !session.authorized) return false;
    if (isHrOrAdmin(session)) return true;
    var employeeId = employee && employee.employee_id || (review && review.employee_id);
    if (isSelf(session, employeeId)) return true;
    if (isManager(session)) {
      return isDirectReport(session, employee || {}) || sameEmployeeId(review && review.manager_employee_id, session.employee_id);
    }
    return false;
  }

  function assignedEmployeeIds(goals, cycleId) {
    var ids = {};
    var cid = trim_(cycleId);
    (goals || []).forEach(function (g) {
      if (cid && trim_(g.cycle_id) !== cid) return;
      if (!isGoalCountable(g)) return;
      var id = trim_(g.employee_id);
      if (id) ids[id] = true;
    });
    return Object.keys(ids);
  }

  function findReview(reviews, cycleId, employeeId) {
    var cid = trim_(cycleId);
    var eid = trim_(employeeId);
    var list = reviews || [];
    for (var i = 0; i < list.length; i++) {
      if (trim_(list[i].cycle_id) === cid && sameEmployeeId(list[i].employee_id, eid)) {
        return list[i];
      }
    }
    return null;
  }

  function isReviewComplete(review) {
    var st = upper_(review && review.status);
    return st === RS.MANAGER_SUBMITTED || st === RS.FINALIZED;
  }

  function isSelfPending(review) {
    var st = upper_(review && review.status);
    return !st || st === RS.NOT_STARTED || st === RS.IN_PROGRESS;
  }

  function isManagerPending(review) {
    return upper_(review && review.status) === RS.SELF_SUBMITTED;
  }

  function isOverdue(cycle, review, now) {
    if (!cycle) return false;
    if (isReviewComplete(review)) return false;
    var deadline = toDateOnly(cycle.review_deadline);
    if (!deadline) return false;
    var today = toDateOnly(now) || toDateOnly(new Date());
    if (!today) return false;
    if (upper_(cycle.status) === CS.DRAFT || upper_(cycle.status) === CS.CLOSED) return false;
    return today.getTime() > deadline.getTime();
  }

  function scopeEmployees(employees, session) {
    var list = employees || [];
    if (!session || isHrOrAdmin(session)) return list.slice();
    if (isManager(session)) {
      return list.filter(function (e) {
        return isSelf(session, e.employee_id) || isDirectReport(session, e);
      });
    }
    return list.filter(function (e) { return isSelf(session, e.employee_id); });
  }

  /**
   * @param {Object} args cycles, goals, reviews, employees, session, now
   */
  function buildDashboardKpis(args) {
    args = args || {};
    var cycles = args.cycles || [];
    var goals = args.goals || [];
    var reviews = args.reviews || [];
    var employees = scopeEmployees(args.employees || [], args.session);
    var empIndex = {};
    employees.forEach(function (e) { empIndex[trim_(e.employee_id)] = e; });
    var now = args.now || new Date();

    var activeCycles = cycles.filter(function (c) { return isActiveCycleStatus(c.status); });
    var pendingSelf = 0;
    var pendingManager = 0;
    var completed = 0;
    var overdue = 0;
    var seenSelf = {};
    var seenMgr = {};
    var seenDone = {};
    var seenOverdue = {};

    activeCycles.forEach(function (cycle) {
      var assigned = assignedEmployeeIds(goals, cycle.cycle_id).filter(function (id) {
        return !!empIndex[id] || isHrOrAdmin(args.session);
      });
      if (!isHrOrAdmin(args.session)) {
        assigned = assigned.filter(function (id) { return !!empIndex[id]; });
      } else {
        assigned = assignedEmployeeIds(goals, cycle.cycle_id);
      }
      assigned.forEach(function (employeeId) {
        var review = findReview(reviews, cycle.cycle_id, employeeId);
        var key = cycle.cycle_id + '::' + employeeId;
        if (upper_(cycle.status) === CS.OPEN && isSelfPending(review)) {
          if (!seenSelf[key]) {
            seenSelf[key] = true;
            pendingSelf++;
          }
        }
        if ((upper_(cycle.status) === CS.EMPLOYEE_SUBMITTED || upper_(cycle.status) === CS.MANAGER_REVIEW) &&
            isManagerPending(review)) {
          if (!seenMgr[key]) {
            seenMgr[key] = true;
            pendingManager++;
          }
        }
        if (isReviewComplete(review)) {
          if (!seenDone[key]) {
            seenDone[key] = true;
            completed++;
          }
        }
        if (isOverdue(cycle, review, now)) {
          if (!seenOverdue[key]) {
            seenOverdue[key] = true;
            overdue++;
          }
        }
      });
    });

    cycles.filter(function (c) { return upper_(c.status) === CS.FINALIZED || upper_(c.status) === CS.CLOSED; })
      .forEach(function (cycle) {
        (reviews || []).forEach(function (review) {
          if (trim_(review.cycle_id) !== trim_(cycle.cycle_id)) return;
          if (!empIndex[trim_(review.employee_id)] && !isHrOrAdmin(args.session)) return;
          if (isReviewComplete(review)) {
            var key = cycle.cycle_id + '::' + review.employee_id;
            if (!seenDone[key]) {
              seenDone[key] = true;
              completed++;
            }
          }
        });
      });

    return {
      active_cycles: activeCycles.length,
      employees_pending_self: pendingSelf,
      managers_pending_review: pendingManager,
      completed_reviews: completed,
      overdue_reviews: overdue
    };
  }

  function cycleStatusLabel(status) {
    var s = upper_(status);
    var labels = {};
    labels[CS.DRAFT] = 'Draft';
    labels[CS.OPEN] = 'Open';
    labels[CS.EMPLOYEE_SUBMITTED] = 'Self-assessment closed';
    labels[CS.MANAGER_REVIEW] = 'Manager review';
    labels[CS.FINALIZED] = 'Finalized';
    labels[CS.CLOSED] = 'Closed';
    return labels[s] || s;
  }

  function reviewStatusLabel(status) {
    var s = upper_(status);
    var labels = {};
    labels[RS.NOT_STARTED] = 'Not started';
    labels[RS.IN_PROGRESS] = 'In progress';
    labels[RS.SELF_SUBMITTED] = 'Self-assessment submitted';
    labels[RS.MANAGER_SUBMITTED] = 'Manager review submitted';
    labels[RS.FINALIZED] = 'Finalized';
    return labels[s] || s;
  }

  function nextReviewStatusOnSave(current, actor) {
    var st = upper_(current) || RS.NOT_STARTED;
    if (st === RS.NOT_STARTED) return RS.IN_PROGRESS;
    return st;
  }

  return {
    fail: fail_,
    conflict: conflict_,
    denied: denied_,
    trim: trim_,
    upper: upper_,
    isTruthy: isTruthy,
    num: num_,
    round2: round2,
    round1: round1,
    toDateOnly: toDateOnly,
    formatIsoDate: formatIsoDate,
    dateMs: dateMs,
    isHrOrAdmin: isHrOrAdmin,
    isAdmin: isAdmin,
    isManager: isManager,
    isEmployeeRole: isEmployeeRole,
    sameEmployeeId: sameEmployeeId,
    isDirectReport: isDirectReport,
    isSelf: isSelf,
    transitionMap: transitionMap,
    isValidTransition: isValidTransition,
    assertTransition: assertTransition,
    isActiveCycleStatus: isActiveCycleStatus,
    isTerminalCycleStatus: isTerminalCycleStatus,
    isGoalCountable: isGoalCountable,
    validateCycleFields: validateCycleFields,
    validateWeightValue: validateWeightValue,
    validateWeights: validateWeights,
    assertWeightsForSubmit: assertWeightsForSubmit,
    validateGoalFields: validateGoalFields,
    normalizeScale: normalizeScale,
    defaultScale: defaultScale,
    scaleValues: scaleValues,
    isAllowedRating: isAllowedRating,
    assertRating: assertRating,
    ratingLabel: ratingLabel,
    validateRatingScalePayload: validateRatingScalePayload,
    computeOverallRating: computeOverallRating,
    nearestScaleValue: nearestScaleValue,
    reviewStatusRank: reviewStatusRank,
    canEmployeeEditReview: canEmployeeEditReview,
    canEmployeeSubmit: canEmployeeSubmit,
    assertEmployeeCanSubmit: assertEmployeeCanSubmit,
    canManagerEditReview: canManagerEditReview,
    assertManagerCanSubmit: assertManagerCanSubmit,
    assertCanFinalize: assertCanFinalize,
    assertCanReopenSelf: assertCanReopenSelf,
    can: can,
    requireCan: requireCan,
    canViewEmployeePms: canViewEmployeePms,
    assignedEmployeeIds: assignedEmployeeIds,
    findReview: findReview,
    isReviewComplete: isReviewComplete,
    isSelfPending: isSelfPending,
    isManagerPending: isManagerPending,
    isOverdue: isOverdue,
    scopeEmployees: scopeEmployees,
    buildDashboardKpis: buildDashboardKpis,
    cycleStatusLabel: cycleStatusLabel,
    reviewStatusLabel: reviewStatusLabel,
    nextReviewStatusOnSave: nextReviewStatusOnSave
  };
})();
