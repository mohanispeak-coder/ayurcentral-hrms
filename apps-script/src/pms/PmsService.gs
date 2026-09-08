/**
 * PMS business service — cycles, goals, reviews, ratings, dashboard.
 * Payroll-style: AuthZ on every entry, engine for rules, sheets via DbService.
 */
var HRMS = HRMS || {};

var PmsService = (function () {
  var CYCLE_DATES_ = ['start_date', 'end_date', 'submission_deadline', 'review_deadline', 'created_at', 'updated_at'];
  var REVIEW_DATES_ = ['employee_submitted_at', 'manager_submitted_at', 'finalized_at', 'created_at', 'updated_at'];
  var GOAL_DATES_ = ['created_at', 'updated_at'];

  function ensure_() {
    return PmsSchemaService.ensure();
  }

  function now_() {
    return new Date();
  }

  function actorEmail_(session) {
    return (session && session.email) || '';
  }

  function firePmsNotify_(fn) {
    try {
      if (typeof NotificationPmsAdapter === 'undefined') return;
      fn();
    } catch (e) {
      Logger.log('PMS notify: ' + (e.message || e));
    }
  }

  function recipientHint_(emp) {
    emp = emp || {};
    return {
      employee_id: emp.employee_id,
      email: emp.work_email || emp.email,
      display_name: emp.display_name
    };
  }

  function serializeDateTime_(value) {
    if (value === null || value === undefined || value === '') return '';
    if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
      return value.toISOString();
    }
    return String(value);
  }

  function serializeSheetRow_(row, dateFields) {
    if (!row) return row;
    var out = {};
    Object.keys(row).forEach(function (k) {
      var v = row[k];
      if (dateFields.indexOf(k) >= 0) {
        if (k.indexOf('_date') >= 0 || k.indexOf('deadline') >= 0) {
          out[k] = PmsEngine.formatIsoDate(v) || serializeDateTime_(v);
        } else {
          out[k] = serializeDateTime_(v);
        }
      } else if (k === 'reopen_allowed') {
        out[k] = PmsEngine.isTruthy(v);
      } else if (k === 'is_active') {
        out[k] = PmsEngine.isTruthy(v);
      } else {
        out[k] = v;
      }
    });
    return out;
  }

  function serializeCycle_(row) {
    var out = serializeSheetRow_(row, CYCLE_DATES_);
    if (out) {
      out.status_label = PmsEngine.cycleStatusLabel(out.status);
      out.allowed_transitions = (PmsEngine.transitionMap()[PmsEngine.upper(out.status)] || []).slice();
    }
    return out;
  }

  function serializeGoal_(row, scale) {
    var out = serializeSheetRow_(row, GOAL_DATES_);
    if (out) {
      out.weight = PmsEngine.round2(out.weight);
      out.progress = PmsEngine.round2(out.progress);
      out.employee_rating_label = PmsEngine.ratingLabel(out.employee_rating, scale);
      out.manager_rating_label = PmsEngine.ratingLabel(out.manager_rating, scale);
    }
    return out;
  }

  function serializeReview_(row, scale) {
    var out = serializeSheetRow_(row, REVIEW_DATES_);
    if (out) {
      out.status_label = PmsEngine.reviewStatusLabel(out.status);
      out.overall_rating_label = PmsEngine.ratingLabel(out.overall_rating, scale);
      out.final_rating_label = PmsEngine.ratingLabel(out.final_rating, scale);
    }
    return out;
  }

  function getCycle_(cycleId) {
    var id = PmsEngine.trim(cycleId);
    if (!id) throw (typeof notFoundError_ === 'function' ? notFoundError_('Cycle was not found.') : new Error('Cycle was not found.'));
    var row = DbService.findOne(HRMS.SHEETS.PERFORMANCE_CYCLES, { cycle_id: id });
    if (!row) throw (typeof notFoundError_ === 'function' ? notFoundError_('Cycle was not found.') : new Error('Cycle was not found.'));
    return row;
  }

  function getGoal_(goalId) {
    var row = DbService.findOne(HRMS.SHEETS.PERFORMANCE_GOALS, { goal_id: PmsEngine.trim(goalId) });
    if (!row) throw (typeof notFoundError_ === 'function' ? notFoundError_('Goal was not found.') : new Error('Goal was not found.'));
    return row;
  }

  function getEmployee_(employeeId) {
    var id = PmsEngine.trim(employeeId);
    if (!id) throw (typeof validationError_ === 'function' ? validationError_('Employee ID is required.') : new Error('Employee ID is required.'));
    var emp = EmployeeService.getMasterRecord(id);
    if (!emp) throw (typeof notFoundError_ === 'function' ? notFoundError_('Employee was not found.') : new Error('Employee was not found.'));
    return emp;
  }

  function employeeSummary_(emp) {
    if (!emp) return null;
    return {
      employee_id: emp.employee_id,
      display_name: emp.display_name || PmsEngine.trim((emp.first_name || '') + ' ' + (emp.last_name || '')),
      department: emp.department || '',
      designation: emp.designation || '',
      manager_employee_id: emp.manager_employee_id || '',
      status: emp.status || ''
    };
  }

  function listActiveEmployees_() {
    if (typeof EmployeeService !== 'undefined' && EmployeeService.listActiveEmployees) {
      return EmployeeService.listActiveEmployees();
    }
    return DbService.getAllRecords(HRMS.SHEETS.EMPLOYEES).filter(function (e) {
      return PmsEngine.upper(e.status) === HRMS.EMPLOYEE_STATUS.ACTIVE;
    });
  }

  function nameMap_() {
    var map = {};
    listActiveEmployees_().forEach(function (e) {
      map[e.employee_id] = e.display_name || PmsEngine.trim((e.first_name || '') + ' ' + (e.last_name || ''));
    });
    DbService.getAllRecords(HRMS.SHEETS.EMPLOYEES).forEach(function (e) {
      if (!map[e.employee_id]) {
        map[e.employee_id] = e.display_name || PmsEngine.trim((e.first_name || '') + ' ' + (e.last_name || ''));
      }
    });
    return map;
  }

  function loadScale_() {
    var rows = DbService.findRecords(HRMS.SHEETS.PERFORMANCE_RATINGS, { scale_code: HRMS.PMS.SCALE_CODE });
    if (!rows.length) rows = DbService.getAllRecords(HRMS.SHEETS.PERFORMANCE_RATINGS);
    var scale = PmsEngine.normalizeScale(rows);
    return scale.length ? scale : PmsEngine.defaultScale();
  }

  function goalsFor_(cycleId, employeeId) {
    var filter = { cycle_id: cycleId };
    if (employeeId) filter.employee_id = employeeId;
    return DbService.findRecords(HRMS.SHEETS.PERFORMANCE_GOALS, filter);
  }

  function findReview_(cycleId, employeeId) {
    var list = DbService.findRecords(HRMS.SHEETS.PERFORMANCE_REVIEWS, { cycle_id: cycleId, employee_id: employeeId });
    return list.length ? list[0] : null;
  }

  function audit_(action, entityType, entityId, summary, employeeId) {
    if (typeof AuditService === 'undefined' || !AuditService.log) return;
    AuditService.log(action, entityType, entityId, String(summary || '').substring(0, 240), employeeId || '');
  }

  function newId_(prefix) {
    return DbService.generateId(prefix);
  }

  function upsertReview_(cycle, employee, session, extras) {
    extras = extras || {};
    var existing = findReview_(cycle.cycle_id, employee.employee_id);
    var now = now_();
    var email = actorEmail_(session);
    if (existing) {
      if (extras.updates) {
        extras.updates.updated_at = now;
        extras.updates.updated_by_email = email;
        return DbService.updateRecord(HRMS.SHEETS.PERFORMANCE_REVIEWS, 'review_id', existing.review_id, extras.updates);
      }
      return existing;
    }
    var record = {
      review_id: newId_(HRMS.PMS.ID_PREFIX.REVIEW),
      cycle_id: cycle.cycle_id,
      employee_id: employee.employee_id,
      manager_employee_id: employee.manager_employee_id || '',
      status: extras.status || HRMS.PMS.REVIEW_STATUS.NOT_STARTED,
      employee_overall_comments: extras.employee_overall_comments || '',
      manager_overall_comments: '',
      hr_comments: '',
      overall_rating: '',
      final_rating: '',
      reopen_allowed: false,
      employee_submitted_at: '',
      manager_submitted_at: '',
      finalized_at: '',
      finalized_by_email: '',
      created_at: now,
      updated_at: now,
      updated_by_email: email
    };
    if (extras.updates) {
      Object.keys(extras.updates).forEach(function (k) {
        record[k] = extras.updates[k];
      });
    }
    DbService.insertRecord(HRMS.SHEETS.PERFORMANCE_REVIEWS, record);
    return record;
  }

  function publicContext_(session) {
    return {
      capabilities: PmsPermissionService.capabilities(session),
      ratingScale: loadScale_(),
      cycleStatuses: HRMS.PMS.CYCLE_STATUS_ORDER.slice(),
      reviewStatuses: [
        HRMS.PMS.REVIEW_STATUS.NOT_STARTED,
        HRMS.PMS.REVIEW_STATUS.IN_PROGRESS,
        HRMS.PMS.REVIEW_STATUS.SELF_SUBMITTED,
        HRMS.PMS.REVIEW_STATUS.MANAGER_SUBMITTED,
        HRMS.PMS.REVIEW_STATUS.FINALIZED
      ]
    };
  }

  function getContext(optSession) {
    var session = PmsPermissionService.requireAction(HRMS.PMS.ACTIONS.VIEW_DASHBOARD, {}, optSession);
    return publicContext_(session);
  }

  function listCycles(optSession) {
    var session = PmsPermissionService.requireAction(HRMS.PMS.ACTIONS.VIEW_DASHBOARD, {}, optSession);
    var cycles = DbService.getAllRecords(HRMS.SHEETS.PERFORMANCE_CYCLES).map(serializeCycle_);
    cycles.sort(function (a, b) {
      return PmsEngine.dateMs(b.start_date) - PmsEngine.dateMs(a.start_date) ||
        String(b.cycle_id).localeCompare(String(a.cycle_id));
    });
    if (!PmsEngine.isHrOrAdmin(session) && !PmsEngine.isManager(session)) {
      var myGoals = DbService.findRecords(HRMS.SHEETS.PERFORMANCE_GOALS, { employee_id: session.employee_id });
      var ids = {};
      myGoals.forEach(function (g) { ids[g.cycle_id] = true; });
      cycles = cycles.filter(function (c) { return !!ids[c.cycle_id]; });
    }
    return {
      cycles: cycles,
      capabilities: PmsPermissionService.capabilities(session)
    };
  }

  function getCycle(cycleId) {
    ensure_();
    var session = PmsPermissionService.requireAction(HRMS.PMS.ACTIONS.VIEW_DASHBOARD);
    var cycle = serializeCycle_(getCycle_(cycleId));
    var scale = loadScale_();
    var goals = goalsFor_(cycle.cycle_id, PmsEngine.isHrOrAdmin(session) || PmsEngine.isManager(session) ? '' : session.employee_id);
    if (PmsEngine.isManager(session) && !PmsEngine.isHrOrAdmin(session)) {
      var reportIds = {};
      if (EmployeeService.getDirectReportIds) {
        EmployeeService.getDirectReportIds(session.employee_id).forEach(function (id) { reportIds[id] = true; });
      }
      reportIds[session.employee_id] = true;
      goals = goals.filter(function (g) { return reportIds[g.employee_id]; });
    }
    var names = nameMap_();
    var byEmp = {};
    goals.forEach(function (g) {
      var eid = g.employee_id;
      if (!byEmp[eid]) {
        byEmp[eid] = { employee_id: eid, display_name: names[eid] || eid, goals: [], weight: PmsEngine.validateWeights([]) };
      }
      byEmp[eid].goals.push(serializeGoal_(g, scale));
    });
    Object.keys(byEmp).forEach(function (eid) {
      byEmp[eid].weight = PmsEngine.validateWeights(byEmp[eid].goals);
    });
    return {
      cycle: cycle,
      employees: Object.keys(byEmp).sort().map(function (k) { return byEmp[k]; }),
      ratingScale: scale,
      capabilities: PmsPermissionService.capabilities(session)
    };
  }

  function createCycle(payload) {
    ensure_();
    var session = PmsPermissionService.requireAction(HRMS.PMS.ACTIONS.MANAGE_CYCLES);
    var fields = PmsEngine.validateCycleFields(payload || {}, true);
    return withScriptLock_(function () {
      var now = now_();
      var row = {
        cycle_id: newId_(HRMS.PMS.ID_PREFIX.CYCLE),
        name: fields.name,
        start_date: fields.start_date,
        end_date: fields.end_date,
        status: HRMS.PMS.CYCLE_STATUS.DRAFT,
        submission_deadline: fields.submission_deadline,
        review_deadline: fields.review_deadline,
        notes: fields.notes,
        created_at: now,
        created_by_email: actorEmail_(session),
        updated_at: now,
        updated_by_email: actorEmail_(session)
      };
      DbService.insertRecord(HRMS.SHEETS.PERFORMANCE_CYCLES, row);
      audit_(HRMS.PMS.AUDIT.CYCLE_CREATE, 'PerformanceCycle', row.cycle_id, 'Created cycle ' + row.name, session.employee_id);
      return serializeCycle_(row);
    });
  }

  function updateCycle(cycleId, payload) {
    ensure_();
    var session = PmsPermissionService.requireAction(HRMS.PMS.ACTIONS.MANAGE_CYCLES);
    return withScriptLock_(function () {
      var cycle = getCycle_(cycleId);
      var st = PmsEngine.upper(cycle.status);
      if (st === HRMS.PMS.CYCLE_STATUS.CLOSED) {
        PmsEngine.conflict('A closed cycle cannot be edited.');
      }
      var updates = { updated_at: now_(), updated_by_email: actorEmail_(session) };
      if (st === HRMS.PMS.CYCLE_STATUS.DRAFT) {
        var fields = PmsEngine.validateCycleFields(payload || {}, false);
        updates.name = fields.name;
        updates.start_date = fields.start_date;
        updates.end_date = fields.end_date;
        updates.submission_deadline = fields.submission_deadline;
        updates.review_deadline = fields.review_deadline;
        updates.notes = fields.notes;
      } else if (st === HRMS.PMS.CYCLE_STATUS.FINALIZED) {
        updates.notes = PmsEngine.trim((payload || {}).notes).substring(0, HRMS.PMS.TEXT_MAX);
      } else {
        var merged = {
          name: cycle.name,
          start_date: cycle.start_date,
          end_date: cycle.end_date,
          submission_deadline: (payload && payload.submission_deadline) || cycle.submission_deadline,
          review_deadline: (payload && payload.review_deadline) || cycle.review_deadline,
          notes: payload && payload.notes !== undefined ? payload.notes : cycle.notes
        };
        var fieldsOpen = PmsEngine.validateCycleFields(merged, false);
        updates.submission_deadline = fieldsOpen.submission_deadline;
        updates.review_deadline = fieldsOpen.review_deadline;
        updates.notes = fieldsOpen.notes;
      }
      var saved = DbService.updateRecord(HRMS.SHEETS.PERFORMANCE_CYCLES, 'cycle_id', cycle.cycle_id, updates);
      audit_(HRMS.PMS.AUDIT.CYCLE_UPDATE, 'PerformanceCycle', cycle.cycle_id, 'Updated cycle', session.employee_id);
      return serializeCycle_(saved);
    });
  }

  function transitionCycle(cycleId, toStatus) {
    ensure_();
    var session = PmsPermissionService.requireAction(HRMS.PMS.ACTIONS.MANAGE_CYCLES);
    var saved = withScriptLock_(function () {
      var cycle = getCycle_(cycleId);
      var trans = PmsEngine.assertTransition(cycle.status, toStatus);
      if (trans.from === HRMS.PMS.CYCLE_STATUS.OPEN && trans.to === HRMS.PMS.CYCLE_STATUS.DRAFT) {
        var submitted = DbService.findRecords(HRMS.SHEETS.PERFORMANCE_REVIEWS, { cycle_id: cycle.cycle_id })
          .filter(function (r) {
            return PmsEngine.reviewStatusRank(r.status) >= PmsEngine.reviewStatusRank(HRMS.PMS.REVIEW_STATUS.SELF_SUBMITTED);
          });
        if (submitted.length) {
          PmsEngine.conflict('Cannot return to draft after a self-assessment has been submitted.');
        }
      }
      var row = DbService.updateRecord(HRMS.SHEETS.PERFORMANCE_CYCLES, 'cycle_id', cycle.cycle_id, {
        status: trans.to,
        updated_at: now_(),
        updated_by_email: actorEmail_(session)
      });
      audit_(HRMS.PMS.AUDIT.CYCLE_TRANSITION, 'PerformanceCycle', cycle.cycle_id,
        'Cycle ' + trans.from + ' → ' + trans.to, session.employee_id);
      return serializeCycle_(row);
    });
    firePmsNotify_(function () {
      if (PmsEngine.upper(saved.status) !== HRMS.PMS.CYCLE_STATUS.OPEN) return;
      var recipients = [];
      var ids = PmsEngine.assignedEmployeeIds(DbService.getAllRecords(HRMS.SHEETS.PERFORMANCE_GOALS), saved.cycle_id);
      ids.forEach(function (eid) {
        var emp = getEmployee_(eid);
        if (emp) recipients.push(recipientHint_(emp));
      });
      NotificationPmsAdapter.notifyCycleOpen(saved, recipients);
    });
    return saved;
  }

  function listAssignableEmployees(cycleId) {
    ensure_();
    var session = PmsPermissionService.requireApp();
    var list;
    if (PmsEngine.isHrOrAdmin(session)) {
      list = listActiveEmployees_();
    } else if (PmsEngine.isManager(session)) {
      var ids = EmployeeService.getDirectReportIds ? EmployeeService.getDirectReportIds(session.employee_id) : [];
      var idSet = {};
      ids.forEach(function (id) { idSet[id] = true; });
      list = listActiveEmployees_().filter(function (e) { return idSet[e.employee_id]; });
    } else {
      PmsEngine.denied();
    }
    var assigned = {};
    if (cycleId) {
      goalsFor_(cycleId, '').forEach(function (g) {
        if (PmsEngine.isGoalCountable(g)) assigned[g.employee_id] = true;
      });
    }
    return list.map(function (e) {
      var s = employeeSummary_(e);
      s.has_goals = !!assigned[e.employee_id];
      return s;
    }).sort(function (a, b) {
      return String(a.display_name).localeCompare(String(b.display_name));
    });
  }

  function createGoal(payload) {
    ensure_();
    var session = PmsPermissionService.requireApp();
    payload = payload || {};
    var fields = PmsEngine.validateGoalFields(payload, {});
    var cycle = getCycle_(fields.cycle_id);
    var employee = getEmployee_(fields.employee_id);
    PmsPermissionService.requireAction(HRMS.PMS.ACTIONS.MANAGE_GOALS, { employee: employee }, session);
    if (PmsEngine.isTerminalCycleStatus(cycle.status) || PmsEngine.upper(cycle.status) === HRMS.PMS.CYCLE_STATUS.FINALIZED) {
      PmsEngine.conflict('Goals cannot be added after the cycle is finalized.');
    }
    if (PmsEngine.upper(cycle.status) !== HRMS.PMS.CYCLE_STATUS.DRAFT &&
        PmsEngine.upper(cycle.status) !== HRMS.PMS.CYCLE_STATUS.OPEN) {
      PmsEngine.conflict('Goals can only be added while the cycle is in draft or open.');
    }
    var review = findReview_(cycle.cycle_id, employee.employee_id);
    if (review && PmsEngine.reviewStatusRank(review.status) >= PmsEngine.reviewStatusRank(HRMS.PMS.REVIEW_STATUS.SELF_SUBMITTED) &&
        !PmsEngine.isTruthy(review.reopen_allowed)) {
      PmsEngine.conflict('Goals cannot be added after self-assessment is submitted.');
    }
    return withScriptLock_(function () {
      var now = now_();
      var row = {
        goal_id: newId_(HRMS.PMS.ID_PREFIX.GOAL),
        cycle_id: cycle.cycle_id,
        employee_id: employee.employee_id,
        title: fields.title,
        description: fields.description,
        measurement: fields.measurement,
        target: fields.target,
        weight: fields.weight,
        status: fields.status === HRMS.PMS.GOAL_STATUS.DRAFT ? HRMS.PMS.GOAL_STATUS.DRAFT : HRMS.PMS.GOAL_STATUS.ACTIVE,
        progress: 0,
        achievement: '',
        employee_comments: '',
        manager_comments: '',
        employee_rating: '',
        manager_rating: '',
        created_at: now,
        created_by_email: actorEmail_(session),
        updated_at: now,
        updated_by_email: actorEmail_(session)
      };
      DbService.insertRecord(HRMS.SHEETS.PERFORMANCE_GOALS, row);
      upsertReview_(cycle, employee, session, {});
      audit_(HRMS.PMS.AUDIT.GOAL_CREATE, 'PerformanceGoal', row.goal_id,
        'Created goal for cycle ' + cycle.cycle_id, employee.employee_id);
      var scale = loadScale_();
      var all = goalsFor_(cycle.cycle_id, employee.employee_id);
      return {
        goal: serializeGoal_(row, scale),
        weight: PmsEngine.validateWeights(all)
      };
    });
  }

  function updateGoal(goalId, payload) {
    ensure_();
    var session = PmsPermissionService.requireApp();
    payload = payload || {};
    return withScriptLock_(function () {
      var goal = getGoal_(goalId);
      var cycle = getCycle_(goal.cycle_id);
      var employee = getEmployee_(goal.employee_id);
      var review = findReview_(cycle.cycle_id, employee.employee_id);
      var isSelf = PmsEngine.isSelf(session, employee.employee_id);
      var canManage = PmsEngine.can(HRMS.PMS.ACTIONS.MANAGE_GOALS, session, { employee: employee, review: review });
      if (!canManage && !isSelf) PmsEngine.denied();

      var updates = { updated_at: now_(), updated_by_email: actorEmail_(session) };
      if (isSelf && !canManage) {
        if (!PmsEngine.canEmployeeEditReview(cycle, review)) {
          PmsEngine.conflict('You cannot change this self-assessment now.');
        }
        if (payload.progress !== undefined) {
          var p = Number(payload.progress);
          if (!isFinite(p) || p < 0 || p > 100) PmsEngine.fail('Progress must be between 0 and 100.');
          updates.progress = PmsEngine.round2(p);
        }
        if (payload.achievement !== undefined) {
          updates.achievement = PmsEngine.trim(payload.achievement).substring(0, HRMS.PMS.TEXT_MAX);
        }
        if (payload.employee_comments !== undefined) {
          updates.employee_comments = PmsEngine.trim(payload.employee_comments).substring(0, HRMS.PMS.TEXT_MAX);
        }
        if (payload.employee_rating !== undefined) {
          updates.employee_rating = PmsEngine.assertRating(payload.employee_rating, loadScale_(), 'Self rating');
        }
        audit_(HRMS.PMS.AUDIT.SELF_SAVE, 'PerformanceGoal', goal.goal_id, 'Updated self-assessment progress', employee.employee_id);
      } else {
        if (PmsEngine.isTerminalCycleStatus(cycle.status)) {
          PmsEngine.conflict('Goals cannot be edited after the cycle is closed.');
        }
        if (review && PmsEngine.reviewStatusRank(review.status) >= PmsEngine.reviewStatusRank(HRMS.PMS.REVIEW_STATUS.SELF_SUBMITTED) &&
            !PmsEngine.isTruthy(review.reopen_allowed) && PmsEngine.upper(cycle.status) !== HRMS.PMS.CYCLE_STATUS.DRAFT) {
          PmsEngine.conflict('Goals cannot be rewritten after self-assessment is submitted.');
        }
        var merged = {
          cycle_id: goal.cycle_id,
          employee_id: goal.employee_id,
          title: payload.title !== undefined ? payload.title : goal.title,
          description: payload.description !== undefined ? payload.description : goal.description,
          measurement: payload.measurement !== undefined ? payload.measurement : goal.measurement,
          target: payload.target !== undefined ? payload.target : goal.target,
          weight: payload.weight !== undefined ? payload.weight : goal.weight,
          status: payload.status !== undefined ? payload.status : goal.status,
          progress: payload.progress !== undefined ? payload.progress : goal.progress,
          achievement: payload.achievement !== undefined ? payload.achievement : goal.achievement
        };
        var fields = PmsEngine.validateGoalFields(merged, {});
        updates.title = fields.title;
        updates.description = fields.description;
        updates.measurement = fields.measurement;
        updates.target = fields.target;
        updates.weight = fields.weight;
        updates.status = fields.status;
        updates.progress = fields.progress;
        updates.achievement = fields.achievement;
        audit_(HRMS.PMS.AUDIT.GOAL_UPDATE, 'PerformanceGoal', goal.goal_id, 'Updated goal', employee.employee_id);
      }
      var saved = DbService.updateRecord(HRMS.SHEETS.PERFORMANCE_GOALS, 'goal_id', goal.goal_id, updates);
      var scale = loadScale_();
      return {
        goal: serializeGoal_(saved, scale),
        weight: PmsEngine.validateWeights(goalsFor_(cycle.cycle_id, employee.employee_id))
      };
    });
  }

  function deleteGoal(goalId) {
    ensure_();
    var session = PmsPermissionService.requireApp();
    return withScriptLock_(function () {
      var goal = getGoal_(goalId);
      var cycle = getCycle_(goal.cycle_id);
      var employee = getEmployee_(goal.employee_id);
      PmsPermissionService.requireAction(HRMS.PMS.ACTIONS.MANAGE_GOALS, { employee: employee }, session);
      if (PmsEngine.upper(cycle.status) !== HRMS.PMS.CYCLE_STATUS.DRAFT &&
          PmsEngine.upper(cycle.status) !== HRMS.PMS.CYCLE_STATUS.OPEN) {
        PmsEngine.conflict('Goals can only be removed while the cycle is in draft or open.');
      }
      var review = findReview_(cycle.cycle_id, employee.employee_id);
      if (review && PmsEngine.reviewStatusRank(review.status) >= PmsEngine.reviewStatusRank(HRMS.PMS.REVIEW_STATUS.SELF_SUBMITTED) &&
          !PmsEngine.isTruthy(review.reopen_allowed)) {
        PmsEngine.conflict('Goals cannot be removed after self-assessment is submitted.');
      }
      DbService.deleteRecords(HRMS.SHEETS.PERFORMANCE_GOALS, { goal_id: goal.goal_id });
      audit_(HRMS.PMS.AUDIT.GOAL_DELETE, 'PerformanceGoal', goal.goal_id, 'Deleted goal', employee.employee_id);
      return { deleted: true, weight: PmsEngine.validateWeights(goalsFor_(cycle.cycle_id, employee.employee_id)) };
    });
  }

  function getReviewBundle(cycleId, employeeId) {
    ensure_();
    var session = PmsPermissionService.requireApp();
    var cycle = getCycle_(cycleId);
    var targetId = PmsEngine.trim(employeeId) || session.employee_id;
    var employee = getEmployee_(targetId);
    var review = findReview_(cycle.cycle_id, employee.employee_id);
    PmsPermissionService.requireViewEmployee(employee, review, session);
    var scale = loadScale_();
    var goals = goalsFor_(cycle.cycle_id, employee.employee_id).map(function (g) {
      return serializeGoal_(g, scale);
    });
    var names = nameMap_();
    var overall = PmsEngine.computeOverallRating(goals, 'auto');
    return {
      cycle: serializeCycle_(cycle),
      employee: employeeSummary_(employee),
      manager_name: employee.manager_employee_id ? (names[employee.manager_employee_id] || employee.manager_employee_id) : '',
      review: review ? serializeReview_(review, scale) : null,
      goals: goals,
      weight: PmsEngine.validateWeights(goals),
      overall_rating: overall,
      overall_rating_label: PmsEngine.ratingLabel(PmsEngine.nearestScaleValue(overall, scale), scale),
      ratingScale: scale,
      capabilities: PmsPermissionService.capabilities(session),
      can_edit_self: PmsEngine.isSelf(session, employee.employee_id) && PmsEngine.canEmployeeEditReview(cycle, review),
      can_edit_manager: PmsEngine.can(HRMS.PMS.ACTIONS.MANAGER_REVIEW, session, { employee: employee, review: review }) &&
        PmsEngine.canManagerEditReview(cycle, review),
      can_finalize: PmsEngine.isHrOrAdmin(session) &&
        PmsEngine.upper(cycle.status) !== HRMS.PMS.CYCLE_STATUS.CLOSED &&
        review && PmsEngine.upper(review.status) === HRMS.PMS.REVIEW_STATUS.MANAGER_SUBMITTED
    };
  }

  function saveSelfAssessment(payload) {
    ensure_();
    var session = PmsPermissionService.requireApp();
    payload = payload || {};
    var cycle = getCycle_(payload.cycle_id);
    var employee = getEmployee_(session.employee_id);
    PmsPermissionService.requireAction(HRMS.PMS.ACTIONS.SELF_ASSESS, { employee: employee }, session);
    var scale = loadScale_();
    return withScriptLock_(function () {
      var review = upsertReview_(cycle, employee, session, {});
      if (!PmsEngine.canEmployeeEditReview(cycle, review)) {
        PmsEngine.conflict('You cannot change this self-assessment now.');
      }
      var goalUpdates = payload.goals || [];
      goalUpdates.forEach(function (item) {
        if (!item || !item.goal_id) return;
        var goal = getGoal_(item.goal_id);
        if (goal.cycle_id !== cycle.cycle_id || !PmsEngine.sameEmployeeId(goal.employee_id, employee.employee_id)) {
          PmsEngine.denied('You can only update your own goals.');
        }
        var patch = { updated_at: now_(), updated_by_email: actorEmail_(session) };
        if (item.progress !== undefined) {
          var p = Number(item.progress);
          if (!isFinite(p) || p < 0 || p > 100) PmsEngine.fail('Progress must be between 0 and 100.');
          patch.progress = PmsEngine.round2(p);
        }
        if (item.achievement !== undefined) patch.achievement = PmsEngine.trim(item.achievement).substring(0, HRMS.PMS.TEXT_MAX);
        if (item.employee_comments !== undefined) patch.employee_comments = PmsEngine.trim(item.employee_comments).substring(0, HRMS.PMS.TEXT_MAX);
        if (item.employee_rating !== undefined) patch.employee_rating = PmsEngine.assertRating(item.employee_rating, scale, 'Self rating');
        DbService.updateRecord(HRMS.SHEETS.PERFORMANCE_GOALS, 'goal_id', goal.goal_id, patch);
      });
      var reviewPatch = {
        status: review.status === HRMS.PMS.REVIEW_STATUS.NOT_STARTED || !review.status
          ? HRMS.PMS.REVIEW_STATUS.IN_PROGRESS
          : review.status,
        updated_at: now_(),
        updated_by_email: actorEmail_(session)
      };
      if (payload.employee_overall_comments !== undefined) {
        reviewPatch.employee_overall_comments = PmsEngine.trim(payload.employee_overall_comments).substring(0, HRMS.PMS.TEXT_MAX);
      }
      DbService.updateRecord(HRMS.SHEETS.PERFORMANCE_REVIEWS, 'review_id', review.review_id, reviewPatch);
      audit_(HRMS.PMS.AUDIT.SELF_SAVE, 'PerformanceReview', review.review_id, 'Saved self-assessment', employee.employee_id);
      return getReviewBundle(cycle.cycle_id, employee.employee_id);
    });
  }

  function submitSelfAssessment(cycleId) {
    ensure_();
    var session = PmsPermissionService.requireApp();
    var cycle = getCycle_(cycleId);
    var employee = getEmployee_(session.employee_id);
    PmsPermissionService.requireAction(HRMS.PMS.ACTIONS.SELF_ASSESS, { employee: employee }, session);
    var bundle = withScriptLock_(function () {
      var review = findReview_(cycle.cycle_id, employee.employee_id);
      var goals = goalsFor_(cycle.cycle_id, employee.employee_id);
      PmsEngine.assertEmployeeCanSubmit(cycle, review, goals);
      review = upsertReview_(cycle, employee, session, {});
      DbService.updateRecord(HRMS.SHEETS.PERFORMANCE_REVIEWS, 'review_id', review.review_id, {
        status: HRMS.PMS.REVIEW_STATUS.SELF_SUBMITTED,
        reopen_allowed: false,
        employee_submitted_at: now_(),
        updated_at: now_(),
        updated_by_email: actorEmail_(session)
      });
      audit_(HRMS.PMS.AUDIT.SELF_SUBMIT, 'PerformanceReview', review.review_id, 'Submitted self-assessment', employee.employee_id);
      return getReviewBundle(cycle.cycle_id, employee.employee_id);
    });
    firePmsNotify_(function () {
      var mgr = employee.manager_employee_id ? getEmployee_(employee.manager_employee_id) : null;
      if (mgr) {
        NotificationPmsAdapter.notifyManagerReviewPending(cycle, recipientHint_(mgr), employee.display_name || employee.employee_id);
      }
    });
    return bundle;
  }

  function reopenSelfAssessment(cycleId, employeeId) {
    ensure_();
    var session = PmsPermissionService.requireAction(HRMS.PMS.ACTIONS.REOPEN);
    return withScriptLock_(function () {
      var cycle = getCycle_(cycleId);
      var employee = getEmployee_(employeeId);
      var review = findReview_(cycle.cycle_id, employee.employee_id);
      if (!review) throw (typeof notFoundError_ === 'function' ? notFoundError_('Review was not found.') : new Error('Review was not found.'));
      PmsEngine.assertCanReopenSelf(cycle, review);
      if (PmsEngine.upper(cycle.status) === HRMS.PMS.CYCLE_STATUS.EMPLOYEE_SUBMITTED) {
        DbService.updateRecord(HRMS.SHEETS.PERFORMANCE_CYCLES, 'cycle_id', cycle.cycle_id, {
          status: HRMS.PMS.CYCLE_STATUS.OPEN,
          updated_at: now_(),
          updated_by_email: actorEmail_(session)
        });
      }
      DbService.updateRecord(HRMS.SHEETS.PERFORMANCE_REVIEWS, 'review_id', review.review_id, {
        status: HRMS.PMS.REVIEW_STATUS.IN_PROGRESS,
        reopen_allowed: true,
        updated_at: now_(),
        updated_by_email: actorEmail_(session)
      });
      audit_(HRMS.PMS.AUDIT.SELF_REOPEN, 'PerformanceReview', review.review_id, 'Reopened self-assessment', employee.employee_id);
      return getReviewBundle(cycle.cycle_id, employee.employee_id);
    });
  }

  function saveManagerReview(payload) {
    ensure_();
    var session = PmsPermissionService.requireApp();
    payload = payload || {};
    var cycle = getCycle_(payload.cycle_id);
    var employee = getEmployee_(payload.employee_id);
    var review = findReview_(cycle.cycle_id, employee.employee_id);
    PmsPermissionService.requireAction(HRMS.PMS.ACTIONS.MANAGER_REVIEW, { employee: employee, review: review }, session);
    var scale = loadScale_();
    return withScriptLock_(function () {
      review = findReview_(cycle.cycle_id, employee.employee_id);
      if (!PmsEngine.canManagerEditReview(cycle, review)) {
        PmsEngine.conflict('You cannot change this manager review now.');
      }
      (payload.goals || []).forEach(function (item) {
        if (!item || !item.goal_id) return;
        var goal = getGoal_(item.goal_id);
        if (goal.cycle_id !== cycle.cycle_id || !PmsEngine.sameEmployeeId(goal.employee_id, employee.employee_id)) {
          PmsEngine.denied();
        }
        var patch = { updated_at: now_(), updated_by_email: actorEmail_(session) };
        if (item.manager_comments !== undefined) {
          patch.manager_comments = PmsEngine.trim(item.manager_comments).substring(0, HRMS.PMS.TEXT_MAX);
        }
        if (item.manager_rating !== undefined) {
          patch.manager_rating = PmsEngine.assertRating(item.manager_rating, scale, 'Manager rating');
        }
        DbService.updateRecord(HRMS.SHEETS.PERFORMANCE_GOALS, 'goal_id', goal.goal_id, patch);
      });
      var goals = goalsFor_(cycle.cycle_id, employee.employee_id);
      var overall = PmsEngine.computeOverallRating(goals, 'manager');
      var reviewPatch = {
        updated_at: now_(),
        updated_by_email: actorEmail_(session),
        overall_rating: overall === null ? '' : overall
      };
      if (payload.manager_overall_comments !== undefined) {
        reviewPatch.manager_overall_comments = PmsEngine.trim(payload.manager_overall_comments).substring(0, HRMS.PMS.TEXT_MAX);
      }
      if (!review.manager_employee_id && session.employee_id) {
        reviewPatch.manager_employee_id = employee.manager_employee_id || session.employee_id;
      }
      DbService.updateRecord(HRMS.SHEETS.PERFORMANCE_REVIEWS, 'review_id', review.review_id, reviewPatch);
      audit_(HRMS.PMS.AUDIT.MANAGER_SAVE, 'PerformanceReview', review.review_id, 'Saved manager review', employee.employee_id);
      return getReviewBundle(cycle.cycle_id, employee.employee_id);
    });
  }

  function submitManagerReview(cycleId, employeeId) {
    ensure_();
    var session = PmsPermissionService.requireApp();
    var cycle = getCycle_(cycleId);
    var employee = getEmployee_(employeeId);
    var review = findReview_(cycle.cycle_id, employee.employee_id);
    PmsPermissionService.requireAction(HRMS.PMS.ACTIONS.MANAGER_REVIEW, { employee: employee, review: review }, session);
    return withScriptLock_(function () {
      review = findReview_(cycle.cycle_id, employee.employee_id);
      var goals = goalsFor_(cycle.cycle_id, employee.employee_id);
      PmsEngine.assertManagerCanSubmit(cycle, review, goals);
      var overall = PmsEngine.computeOverallRating(goals, 'manager');
      DbService.updateRecord(HRMS.SHEETS.PERFORMANCE_REVIEWS, 'review_id', review.review_id, {
        status: HRMS.PMS.REVIEW_STATUS.MANAGER_SUBMITTED,
        overall_rating: overall === null ? '' : overall,
        manager_submitted_at: now_(),
        manager_employee_id: review.manager_employee_id || employee.manager_employee_id || session.employee_id,
        updated_at: now_(),
        updated_by_email: actorEmail_(session)
      });
      audit_(HRMS.PMS.AUDIT.MANAGER_SUBMIT, 'PerformanceReview', review.review_id, 'Submitted manager review', employee.employee_id);
      return getReviewBundle(cycle.cycle_id, employee.employee_id);
    });
  }

  function finalizeReview(cycleId, employeeId, payload) {
    ensure_();
    var session = PmsPermissionService.requireAction(HRMS.PMS.ACTIONS.FINALIZE);
    payload = payload || {};
    var bundle = withScriptLock_(function () {
      var cycle = getCycle_(cycleId);
      var employee = getEmployee_(employeeId);
      var review = findReview_(cycle.cycle_id, employee.employee_id);
      if (!review) throw (typeof notFoundError_ === 'function' ? notFoundError_('Review was not found.') : new Error('Review was not found.'));
      PmsEngine.assertCanFinalize(cycle, review);
      var scale = loadScale_();
      var finalRating = payload.final_rating !== undefined && payload.final_rating !== ''
        ? PmsEngine.assertRating(payload.final_rating, scale, 'Final rating')
        : (review.overall_rating !== '' && review.overall_rating !== null
          ? PmsEngine.nearestScaleValue(review.overall_rating, scale)
          : '');
      if (finalRating === '' || finalRating === null) {
        PmsEngine.fail('Final rating is required.');
      }
      DbService.updateRecord(HRMS.SHEETS.PERFORMANCE_REVIEWS, 'review_id', review.review_id, {
        status: HRMS.PMS.REVIEW_STATUS.FINALIZED,
        final_rating: finalRating,
        hr_comments: payload.hr_comments !== undefined
          ? PmsEngine.trim(payload.hr_comments).substring(0, HRMS.PMS.TEXT_MAX)
          : (review.hr_comments || ''),
        finalized_at: now_(),
        finalized_by_email: actorEmail_(session),
        updated_at: now_(),
        updated_by_email: actorEmail_(session)
      });
      audit_(HRMS.PMS.AUDIT.FINALIZE, 'PerformanceReview', review.review_id, 'Finalized review', employee.employee_id);
      return { bundle: getReviewBundle(cycle.cycle_id, employee.employee_id), cycle: serializeCycle_(cycle), employee: employee };
    });
    firePmsNotify_(function () {
      NotificationPmsAdapter.notifyFinalized(bundle.cycle, recipientHint_(bundle.employee));
    });
    return bundle.bundle;
  }

  function listTeamReviews(cycleId) {
    ensure_();
    var session = PmsPermissionService.requireAction(HRMS.PMS.ACTIONS.VIEW_TEAM);
    var cycles = cycleId
      ? [getCycle_(cycleId)]
      : DbService.getAllRecords(HRMS.SHEETS.PERFORMANCE_CYCLES);
    if (!cycleId) {
      cycles = cycles.filter(function (c) {
        return PmsEngine.isActiveCycleStatus(c.status) || PmsEngine.upper(c.status) === HRMS.PMS.CYCLE_STATUS.FINALIZED;
      });
    }
    var scale = loadScale_();
    var names = nameMap_();
    var employees = listActiveEmployees_();
    if (PmsEngine.isManager(session) && !PmsEngine.isHrOrAdmin(session)) {
      employees = employees.filter(function (e) {
        return PmsEngine.isDirectReport(session, e);
      });
    }
    var empIndex = {};
    employees.forEach(function (e) { empIndex[e.employee_id] = e; });
    var rows = [];
    cycles.forEach(function (cycle) {
      var assigned = PmsEngine.assignedEmployeeIds(DbService.getAllRecords(HRMS.SHEETS.PERFORMANCE_GOALS), cycle.cycle_id);
      assigned.forEach(function (eid) {
        var emp = empIndex[eid] || EmployeeService.getMasterRecord(eid);
        if (!emp) return;
        if (!PmsEngine.canViewEmployeePms(session, emp, findReview_(cycle.cycle_id, eid))) return;
        if (PmsEngine.isManager(session) && !PmsEngine.isHrOrAdmin(session) && !empIndex[eid]) return;
        var review = findReview_(cycle.cycle_id, eid);
        var goals = goalsFor_(cycle.cycle_id, eid);
        rows.push({
          cycle_id: cycle.cycle_id,
          cycle_name: cycle.name,
          cycle_status: cycle.status,
          employee: employeeSummary_(emp),
          display_name: names[eid] || eid,
          review: review ? serializeReview_(review, scale) : null,
          weight: PmsEngine.validateWeights(goals),
          overall_rating: PmsEngine.computeOverallRating(goals, 'auto'),
          overdue: PmsEngine.isOverdue(cycle, review, now_())
        });
      });
    });
    rows.sort(function (a, b) {
      return String(a.display_name).localeCompare(String(b.display_name));
    });
    return {
      rows: rows,
      ratingScale: scale,
      capabilities: PmsPermissionService.capabilities(session)
    };
  }

  function listAppraisals(cycleId) {
    ensure_();
    var session = PmsPermissionService.requireAction(HRMS.PMS.ACTIONS.FINALIZE);
    return listTeamReviews(cycleId);
  }

  function getDashboard(optSession) {
    var session = PmsPermissionService.requireAction(HRMS.PMS.ACTIONS.VIEW_DASHBOARD, {}, optSession);
    var cycles = DbService.getAllRecords(HRMS.SHEETS.PERFORMANCE_CYCLES);
    var goals = DbService.getAllRecords(HRMS.SHEETS.PERFORMANCE_GOALS);
    var reviews = DbService.getAllRecords(HRMS.SHEETS.PERFORMANCE_REVIEWS);
    var employees = DbService.getAllRecords(HRMS.SHEETS.EMPLOYEES);
    var kpis = PmsEngine.buildDashboardKpis({
      cycles: cycles,
      goals: goals,
      reviews: reviews,
      employees: employees,
      session: session,
      now: now_()
    });
    var myCycle = null;
    var myReview = null;
    if (session.employee_id) {
      var open = cycles.filter(function (c) { return PmsEngine.upper(c.status) === HRMS.PMS.CYCLE_STATUS.OPEN; });
      open.sort(function (a, b) { return PmsEngine.dateMs(b.start_date) - PmsEngine.dateMs(a.start_date); });
      for (var i = 0; i < open.length; i++) {
        var mine = goals.filter(function (g) {
          return g.cycle_id === open[i].cycle_id && PmsEngine.sameEmployeeId(g.employee_id, session.employee_id) &&
            PmsEngine.isGoalCountable(g);
        });
        if (mine.length) {
          myCycle = serializeCycle_(open[i]);
          myReview = findReview_(open[i].cycle_id, session.employee_id);
          break;
        }
      }
    }
    return {
      kpis: kpis,
      capabilities: PmsPermissionService.capabilities(session),
      my_open_cycle: myCycle,
      my_review: myReview ? serializeReview_(myReview, loadScale_()) : null,
      cycles: cycles.map(serializeCycle_).slice(0, 8)
    };
  }

  function listRatingScale(optSession) {
    PmsPermissionService.requireAction(HRMS.PMS.ACTIONS.VIEW_DASHBOARD, {}, optSession);
    return { ratingScale: loadScale_() };
  }

  function saveRatingScale(items) {
    ensure_();
    var session = PmsPermissionService.requireAction(HRMS.PMS.ACTIONS.MANAGE_RATINGS);
    var rows = PmsEngine.validateRatingScalePayload(items || []);
    return withScriptLock_(function () {
      DbService.deleteRecords(HRMS.SHEETS.PERFORMANCE_RATINGS, { scale_code: HRMS.PMS.SCALE_CODE });
      var records = rows.map(function (row) {
        return {
          rating_id: newId_(HRMS.PMS.ID_PREFIX.RATING),
          scale_code: HRMS.PMS.SCALE_CODE,
          value: row.value,
          label: row.label,
          description: row.description,
          sort_order: row.sort_order,
          is_active: row.is_active
        };
      });
      DbService.insertRecords(HRMS.SHEETS.PERFORMANCE_RATINGS, records);
      audit_(HRMS.PMS.AUDIT.RATING_SCALE_SAVE, 'PerformanceRating', HRMS.PMS.SCALE_CODE,
        'Updated rating scale (' + records.length + ' values)', session.employee_id);
      return { ratingScale: loadScale_() };
    });
  }

  return {
    getContext: getContext,
    getDashboard: getDashboard,
    listCycles: listCycles,
    getCycle: getCycle,
    createCycle: createCycle,
    updateCycle: updateCycle,
    transitionCycle: transitionCycle,
    listAssignableEmployees: listAssignableEmployees,
    createGoal: createGoal,
    updateGoal: updateGoal,
    deleteGoal: deleteGoal,
    getReviewBundle: getReviewBundle,
    saveSelfAssessment: saveSelfAssessment,
    submitSelfAssessment: submitSelfAssessment,
    reopenSelfAssessment: reopenSelfAssessment,
    saveManagerReview: saveManagerReview,
    submitManagerReview: submitManagerReview,
    finalizeReview: finalizeReview,
    listTeamReviews: listTeamReviews,
    listAppraisals: listAppraisals,
    listRatingScale: listRatingScale,
    saveRatingScale: saveRatingScale
  };
})();
