(function () {
  'use strict';
  var logEl;
  window.__HRMS_SMOKE_ERRORS = [];
  window.__HRMS_SMOKE_RPC = [];
  window.addEventListener('error', function (ev) {
    window.__HRMS_SMOKE_ERRORS.push(String(ev.message || ev.error || ev));
    smokeLog('ERROR ' + (ev.message || ev.error));
  });
  window.addEventListener('unhandledrejection', function (ev) {
    var msg = ev.reason && ev.reason.message ? ev.reason.message : String(ev.reason);
    window.__HRMS_SMOKE_ERRORS.push(msg);
    smokeLog('REJECT ' + msg);
  });
  function smokeLog(msg) {
    try {
      logEl = logEl || document.getElementById('smoke-log');
      if (logEl) logEl.textContent += msg + '\n';
    } catch (ignore) {}
    try { console.info('[SMOKE]', msg); } catch (e) {}
  }
  window.__HRMS_SMOKE_LOG = smokeLog;

  function resultFor(name, args) {
    window.__HRMS_SMOKE_RPC.push({ name: name, args: args });
    smokeLog('RPC ' + name);
    if (name === 'apiGetAppBootstrap') {
      return {
        ok: true,
        data: {
          app: { configured: true, companyName: 'AyurCentral HRMS' },
          session: {
            authorized: true,
            authRequired: false,
            role: 'ADMIN',
            employee_id: 'EMP001',
            displayName: 'Ada Admin',
            email: 'ada@x.com'
          },
          navigation: [
            { route: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
            { route: 'employees', label: 'Employees', icon: 'people' },
            { route: 'my-leave', label: 'My Leave', icon: 'leave' },
            { route: 'payroll', label: 'Payroll', icon: 'pay' },
            { route: 'pms', label: 'Performance', icon: 'person' },
            { route: 'ats', label: 'Recruitment', icon: 'people' },
            { route: 'notifications', label: 'Notifications', icon: 'person' }
          ]
        }
      };
    }
    if (name === 'apiGetHomeDashboard') {
      return {
        ok: true,
        data: {
          unread_count: 2,
          attention: [{ label: 'Leave to approve', meta: '2', route: 'leave-approvals' }],
          kpis: []
        }
      };
    }
    if (name === 'apiGetHomeDashboardMore') {
      return { ok: true, data: { notes: [] } };
    }
    if (name === 'apiGetModuleUi') {
      var id = args[0];
      return {
        ok: true,
        data: {
          html: '<script>(function(){var A=window.HrmsApp;if(!A)return;' +
            'A.registerModuleRoutes({"' + id + '":{title:"' + id + '",render:function(){' +
            'var p=A.$("page-content");if(!p)return;p.classList.remove("hidden");' +
            'p.innerHTML="<div class=\\"card\\" data-mod=\\"' + id + '\\">Loaded ' + id + '</div>";}}});' +
            '})();<\/script>'
        }
      };
    }
    if (name === 'apiGetUnreadNotificationCount') {
      return { ok: true, data: { unread_count: 2 } };
    }
    if (name === 'apiGetNotificationBellState') {
      return {
        ok: true,
        data: {
          unread_count: 2,
          items: [
            { notification_id: 'N1', status: 'UNREAD', unread: true, title: 'Leave approved', type: 'LEAVE_APPROVED', action_route: 'my-leave' },
            { notification_id: 'N2', status: 'READ', unread: false, title: 'Payslip ready', type: 'PAYSLIP' }
          ]
        }
      };
    }
    if (name === 'apiMarkNotificationRead') {
      return { ok: true, data: { unread_count: 1, record: { notification_id: args[0], read_at: new Date().toISOString() } } };
    }
    if (name === 'apiMarkAllNotificationsRead') {
      return { ok: true, data: { changed: 1, unread_count: 0 } };
    }
    return { ok: true, data: {} };
  }

  var handlers = { success: null, failure: null };
  var run = {
    withSuccessHandler: function (fn) { handlers.success = fn; return run; },
    withFailureHandler: function (fn) {
      handlers.failure = fn;
      return new Proxy({}, {
        get: function (t, prop) {
          if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined;
          return function () {
            var args = Array.prototype.slice.call(arguments);
            try {
              handlers.success(resultFor(String(prop), args));
            } catch (e) {
              handlers.failure(e);
            }
          };
        }
      });
    }
  };
  window.google = { script: { run: run } };
  smokeLog('mock rpc installed');
})();
