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

  function empty_(notes) {
    return {
      unread_count: null,
      leave_approvals_count: null,
      leave_approvals: [],
      payroll: null,
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
