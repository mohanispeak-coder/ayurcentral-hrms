/**
 * Role-scoped home dashboard. Uses existing module APIs; never invents metrics.
 */
var HomeDashboardService = (function () {
  function try_(label, fn) {
    try {
      return { ok: true, value: fn() };
    } catch (e) {
      Logger.log('HomeDashboard ' + label + ': ' + (e.message || e));
      return { ok: false, error: String(e.message || e) };
    }
  }

  function fmtLeave(row) {
    var dates = [row.start_date, row.end_date].filter(Boolean).join(' – ');
    return {
      label: (row.employee_name || row.employee_id || 'Leave') + (row.leave_type_code ? ' · ' + row.leave_type_code : ''),
      meta: dates + (row.total_days != null ? ' · ' + row.total_days + ' day(s)' : ''),
      route: 'leave-approvals',
      params: { leaveRequestId: row.leave_request_id }
    };
  }

  function empty_(notes) {
    return {
      unread_count: null,
      leave_approvals_count: null,
      leave_approvals: [],
      payroll: null,
      pms: null,
      pms_actions: [],
      ats: null,
      ats_actions: [],
      notes: notes || []
    };
  }

  function fillPrimary_(session, out) {
    var ntf = try_('notifications', function () {
      var t = Date.now();
      var value = NotificationService.getUnreadCount(session);
      if (typeof HrmsPerf !== 'undefined' && HrmsPerf.addStage) {
        HrmsPerf.addStage('dash.notifications', Date.now() - t);
      }
      return value;
    });
    if (ntf.ok) out.unread_count = ntf.value;
    else out.notes.push('Notification count is unavailable until inbox sheets exist.');

    if (PermissionService.can(HRMS.ACTIONS.LEAVE_APPROVE, {}, session)) {
      var leave = try_('leave', function () {
        var t = Date.now();
        var value = LeaveService.getApprovals(session);
        if (typeof HrmsPerf !== 'undefined' && HrmsPerf.addStage) {
          HrmsPerf.addStage('dash.leave', Date.now() - t);
        }
        return value;
      });
      if (leave.ok) {
        out.leave_approvals_count = leave.value.length;
        out.leave_approvals = leave.value.slice(0, 5).map(fmtLeave);
      }
    }
    return out;
  }

  function fillSecondary_(session, out) {
    if (PermissionService.can(HRMS.ACTIONS.PAYROLL_RUN, {}, session)) {
      var pay = try_('payroll', function () {
        var t = Date.now();
        var value = PayrollService.listRuns(session);
        if (typeof HrmsPerf !== 'undefined' && HrmsPerf.addStage) {
          HrmsPerf.addStage('dash.payroll', Date.now() - t);
        }
        return value;
      });
      if (pay.ok && pay.value && pay.value.length) {
        out.payroll = { latest: pay.value[0] };
      }
    }

    if (typeof PmsService !== 'undefined' && PmsService.getDashboard) {
      var pms = try_('pms', function () {
        var t = Date.now();
        var value = PmsService.getDashboard(session);
        if (typeof HrmsPerf !== 'undefined' && HrmsPerf.addStage) {
          HrmsPerf.addStage('dash.pms', Date.now() - t);
        }
        return value;
      });
      if (pms.ok) {
        out.pms = pms.value;
        var k = (pms.value && pms.value.kpis) || {};
        if (pms.value.my_open_cycle) {
          out.pms_actions.push({
            label: 'Self-assessment: ' + (pms.value.my_open_cycle.name || 'Open cycle'),
            meta: 'Update progress and submit',
            route: 'pms-my-review',
            params: { cycleId: pms.value.my_open_cycle.cycle_id }
          });
        }
        if (k.managers_pending_review > 0 && (session.role === 'MANAGER' || session.role === 'HR' || session.role === 'ADMIN')) {
          out.pms_actions.push({
            label: String(k.managers_pending_review) + ' manager review(s) pending',
            meta: 'Team reviews',
            route: 'pms-team',
            params: {}
          });
        }
      }
    }

    if (typeof AtsEngine !== 'undefined' && AtsEngine.canAccessAts(session) && typeof AtsService !== 'undefined') {
      var ats = try_('ats', function () {
        var t = Date.now();
        var value = AtsService.getDashboard(session);
        if (typeof HrmsPerf !== 'undefined' && HrmsPerf.addStage) {
          HrmsPerf.addStage('dash.ats', Date.now() - t);
        }
        return value;
      });
      if (ats.ok) {
        out.ats = ats.value;
        if (ats.value.screening > 0) {
          out.ats_actions.push({
            label: String(ats.value.screening) + ' in screening',
            meta: 'Pipeline',
            route: 'ats-candidates',
            params: {}
          });
        }
        if (ats.value.interviews > 0) {
          out.ats_actions.push({
            label: String(ats.value.interviews) + ' at interview',
            meta: 'Pipeline',
            route: 'ats',
            params: {}
          });
        }
      }
    }
    return out;
  }

  function buildPrimary(session) {
    session = session || PermissionService.require(HRMS.ACTIONS.ACCESS_APP);
    return fillPrimary_(session, empty_([]));
  }

  function buildSecondary(session) {
    session = session || PermissionService.require(HRMS.ACTIONS.ACCESS_APP);
    return fillSecondary_(session, empty_([]));
  }

  function build(session) {
    session = session || PermissionService.require(HRMS.ACTIONS.ACCESS_APP);
    var out = empty_([]);
    fillPrimary_(session, out);
    fillSecondary_(session, out);
    return out;
  }

  return {
    build: build,
    buildPrimary: buildPrimary,
    buildSecondary: buildSecondary
  };
})();
