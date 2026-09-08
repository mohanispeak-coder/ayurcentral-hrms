/**
 * Client module view cache: first visit fetches, return visits restore,
 * explicit Refresh refetches. Session-only. No RBAC bypass.
 * Run: node tests/module-view-cache.test.js
 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var src = path.join(__dirname, '..', 'apps-script', 'src');
var failures = [];
var passed = 0;

function read(rel) {
  return fs.readFileSync(path.join(src, rel), 'utf8');
}

function check(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log('PASS ' + name + (detail ? ' — ' + detail : ''));
  } else {
    failures.push(name + (detail ? ': ' + detail : ''));
    console.log('FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}

var scripts = read('ui/Scripts.html');
var emp = read('employee/EmployeeClient.html');
var leaveUi = read('leave/LeaveUi.html');
var payroll = read('payroll/PayrollClient.html');
var pms = read('pms/PmsClient.html');
var ats = read('ats/AtsClient.html');
var ntf = read('notifications/NotificationClient.html');
var bell = read('notifications/NotificationBell.html');
var perm = read('foundation/PermissionService.gs');
var apiEmp = read('employee/ApiEmployee.gs');
var apiLeave = read('leave/ApiLeave.gs');
var apiPay = read('payroll/ApiPayroll.gs');

check('cache-session-var', /var moduleViewCache_ = \{\}/.test(scripts));
check('cache-no-localstorage', !/localStorage\.(setItem|getItem).*moduleViewCache/.test(scripts) &&
  !/localStorage\.setItem\(['\"]hrms_module/.test(scripts));
check('consume-restore-api', /function consumeModuleViewRestore/.test(scripts));
check('mark-loaded-api', /function markModuleViewLoaded/.test(scripts));
check('refresh-api', /function refreshCurrentModuleView/.test(scripts));
check('refresh-never-stuck', /finishModuleRefresh/.test(scripts) && /armRefreshWatchdog_/.test(scripts));
check('dashboard-restore', /consumeModuleViewRestore\(dashKey\)/.test(scripts) && /dashViewCache_/.test(scripts));
check('dashboard-two-stage-kept', /apiGetHomeDashboardMore/.test(scripts) && /secondaryPending/.test(scripts));
check('refresh-button', /js-module-refresh/.test(scripts) && /Refreshing…/.test(scripts));
check('updated-stamp', /Updated just now/.test(scripts));
check('preload-idle-kept', /idle-one-at-a-time/.test(scripts));
check('no-post-login-herd', !/setTimeout\(preloadModulesFromNav,\s*0\)/.test(scripts));

check('emp-restore-list', /consumeModuleViewRestore\(key\)/.test(emp) && /apiGetEmployeeDirectory/.test(emp));
check('emp-restore-profile', /consumeModuleViewRestore\(key\)/.test(emp) && /apiGetEmployee/.test(emp));
check('leave-restore', /tryRestoreLeave_/.test(leaveUi) && /apiLeaveGetMyLeave/.test(leaveUi));
check('leave-approve-still-rpc', /apiLeaveApprove/.test(leaveUi));
check('payroll-restore-home', /consumeModuleViewRestore\('payroll'\)/.test(payroll));
check('payroll-lock-still-rpc', /apiLockPayroll/.test(payroll) && /apiCalculatePayroll/.test(payroll));
check('pms-restore-home', /consumeModuleViewRestore\('pms'\)/.test(pms));
check('ats-restore-home', /consumeModuleViewRestore\('ats'\)/.test(ats));
check('ntf-restore-inbox', /consumeModuleViewRestore\(ntfKey\)/.test(ntf) && /apiGetNotifications/.test(ntf));
check('ntf-optimistic-mark', /markLocal\(/.test(ntf) && /apiMarkNotificationRead/.test(ntf));
check('ntf-mark-all-one-rpc', /apiMarkAllNotificationsRead/.test(ntf));
check('bell-unread-poll', /apiGetUnreadNotificationCount/.test(bell) && /document\.hidden/.test(bell));
check('bell-optimistic-mark', /applyMarkReadResult|apiMarkNotificationRead/.test(bell));

check('invalidate-api', /function invalidateModuleViewCache/.test(scripts) &&
  /function invalidateModuleViewCachePrefix/.test(scripts) &&
  /function invalidateDashboardView/.test(scripts));
check('invalidate-exported', /invalidateModuleViewCache:/.test(scripts) &&
  /invalidateDashboardView:/.test(scripts));
check('leave-invalidate-hooks', /invalidateLeaveAfterRequestMutation_/.test(leaveUi) &&
  /invalidateLeaveAfterAdminConfig_/.test(leaveUi));
check('emp-invalidate-hooks', /invalidateEmpLists_/.test(emp) && /invalidateEmpProfileLists_/.test(emp));
check('payroll-invalidate-hooks', /invalidatePayrollHome_/.test(payroll) && /invalidateCompensation_/.test(payroll));
check('pms-invalidate-hooks', /invalidatePmsShells_/.test(pms) && /invalidatePmsAll_/.test(pms));
check('ats-invalidate-hooks', /invalidateAtsPipeline_/.test(ats) && /invalidateAtsJob_/.test(ats));
check('ntf-invalidate-hooks', /invalidateNtfInbox_/.test(ntf) && /invalidateNtfPrefs_/.test(ntf));
check('ntf-mark-read-no-invalidate', /markLocal\(/.test(ntf) && !/markLocal[\s\S]{0,200}invalidateNtf/.test(ntf));
check('emp-no-dash-inv', !/function invalidateEmpLists_[\s\S]{0,200}invalidateDashboardView/.test(emp));
check('payroll-home-dash-inv', /function invalidatePayrollHome_[\s\S]{0,160}invalidateDashboardView/.test(payroll));
check('comp-no-dash-inv', !/function invalidateCompensation_[\s\S]{0,160}invalidateDashboardView/.test(payroll));
check('pms-dash-inv', /function invalidatePmsShells_[\s\S]*?invalidateDashboardView/.test(pms));
check('ats-dash-inv', /function invalidateAtsPipeline_[\s\S]*?invalidateDashboardView/.test(ats));
check('leave-inv-on-success', /apiLeaveApprove[\s\S]{0,220}invalidateLeaveAfterRequestMutation_/.test(leaveUi));
check('leave-inv-not-in-catch', !/apiLeaveApprove[\s\S]{0,400}\.catch[\s\S]{0,80}invalidateLeave/.test(leaveUi));
check('scoped-leave-not-emp', !/invalidateLeaveViews_[\s\S]{0,120}employees/.test(leaveUi));
check('session-cache-key-fn', /function sessionCacheKey_/.test(scripts));
check('mark-stores-session-key', /sessionKey:\s*sessionCacheKey_\(\)/.test(scripts));
check('restore-checks-session-key', /rec\.sessionKey !== sk/.test(scripts));
check('clear-user-session-export', /clearUserSessionViewState:\s*clearUserSessionViewState_/.test(scripts));
check('register-data-cache-clear', /registerModuleDataCacheClear/.test(scripts));
check('bootstrap-clears-session-views', /function applyBootstrapSuccess[\s\S]*?clearUserSessionViewState_\(\)/.test(scripts));
check('auth-login-clears-session-views', /function showAuthLogin[\s\S]*?clearUserSessionViewState_\(\)/.test(scripts));
check('logout-uses-auth-screen', /function performSignOut_[\s\S]*?showAuthLogin\(/.test(scripts));
check('logout-no-reload', (function () {
  var m = scripts.match(/function performSignOut_[\s\S]*?\n  function /);
  return !!(m && !/location\.reload/.test(m[0]));
})());
check('sign-out-uses-perform', /btn-sign-out[\s\S]*?performSignOut_\(out\)/.test(scripts));
check('logout-clears-session-views', /function performSignOut_[\s\S]*?showAuthLogin\(/.test(scripts) &&
  /function showAuthLogin[\s\S]*?clearUserSessionViewState_\(\)/.test(scripts));
check('sign-out-clears-session-views', /btn-sign-out[\s\S]*?performSignOut_/.test(scripts) &&
  /function showAuthLogin[\s\S]*?clearUserSessionViewState_\(\)/.test(scripts));
check('auth-login-tears-down-shell', /function showAuthLogin[\s\S]*?page\.innerHTML\s*=\s*['\"]['\"]/.test(scripts) &&
  /function showAuthLogin[\s\S]*?HrmsNotificationBell\.unmount/.test(scripts));
check('navigate-requires-auth', /function navigate[\s\S]*?!\s*state\.session\.authorized\)\s*return/.test(scripts));
check('emp-data-cache-hook', /registerModuleDataCacheClear[\s\S]*?empViewCache\.lists/.test(emp));
check('leave-data-cache-hook', /registerModuleDataCacheClear[\s\S]*?leaveViewCache/.test(leaveUi));
check('payroll-data-cache-hook', /registerModuleDataCacheClear[\s\S]*?homeState\.runs/.test(payroll));
check('pms-data-cache-hook', /registerModuleDataCacheClear[\s\S]*?pmsState\.dashboard/.test(pms));
check('ats-data-cache-hook', /registerModuleDataCacheClear[\s\S]*?atsView\.dashboard/.test(ats));
check('ntf-data-cache-hook', /registerModuleDataCacheClear[\s\S]*?ntfState\.inbox/.test(ntf));
check('rbac-server-emp', /requireAuth|PermissionService/.test(apiEmp));
check('rbac-server-leave', /PermissionService|requireAuth/.test(apiLeave));
check('rbac-server-payroll', /hrmsRun_/.test(apiPay));
check('rbac-roles-unchanged', /ADMIN/.test(perm) && /EMPLOYEE/.test(perm) && /function require/.test(perm));
check('client-cache-not-authz', !/consumeModuleViewRestore[\s\S]{0,80}authorized/.test(scripts));

function fakeClassList(el) {
  var set = {};
  if (el.className) String(el.className).split(/\s+/).forEach(function (c) { if (c) set[c] = true; });
  function sync() { el.className = Object.keys(set).join(' '); }
  return {
    add: function (c) { set[c] = true; sync(); },
    remove: function (c) { delete set[c]; sync(); },
    contains: function (c) { return !!set[c]; },
    toggle: function (c, on) {
      if (on === false || (on === undefined && set[c])) this.remove(c);
      else this.add(c);
    }
  };
}

function loadShell() {
  var byId = {};
  var listeners = {};
  var rpcCalls = [];
  var clickBound = 0;

  function fakeEl(tag, id) {
    var attrs = {};
    var children = [];
    var el = {
      nodeType: 1,
      tagName: String(tag || 'DIV').toUpperCase(),
      id: id || '',
      className: '',
      disabled: false,
      innerHTML: '',
      textContent: '',
      style: {},
      dataset: {},
      children: children,
      parentNode: null,
      querySelector: function (sel) {
        if (sel === '.page-header') return children[0] || null;
        if (sel === '.js-module-refresh' || sel === '#btn-module-refresh') {
          return byId['btn-module-refresh'] || null;
        }
        return null;
      },
      querySelectorAll: function () { return []; },
      getAttribute: function (k) { return attrs.hasOwnProperty(k) ? attrs[k] : null; },
      setAttribute: function (k, v) { attrs[k] = String(v); },
      removeAttribute: function (k) { delete attrs[k]; },
      appendChild: function (c) {
        children.push(c);
        if (c) c.parentNode = el;
        return c;
      },
      insertBefore: function (c) {
        children.unshift(c);
        if (c) c.parentNode = el;
        return c;
      },
      addEventListener: function (type, fn) {
        listeners[type] = listeners[type] || [];
        listeners[type].push({ el: el, fn: fn });
        if (type === 'click' && id === 'page-content') clickBound += 1;
      },
      contains: function (node) { return node === el || children.indexOf(node) !== -1; }
    };
    el.classList = fakeClassList(el);
    if (id) byId[id] = el;
    return el;
  }

  [
    'app', 'sidebar', 'sidebar-backdrop', 'sidebar-toggle', 'sidebar-nav', 'brand-title',
    'page-title', 'ntf-bell-slot', 'user-chip', 'user-avatar', 'user-name', 'user-role',
    'btn-sign-out', 'loading-state', 'error-state', 'unauthorized-state', 'unauthorized-message',
    'auth-state', 'auth-step-email', 'auth-google-hint', 'auth-email', 'auth-email-error',
    'auth-send-btn', 'auth-step-code', 'auth-email-display', 'auth-code', 'auth-code-error',
    'auth-verify-btn', 'auth-resend-btn', 'auth-change-email-btn', 'setup-state',
    'btn-run-setup', 'setup-result', 'page-content', 'main-content', 'module-ui-root',
    'toast-container', 'ask-hr-fab', 'ask-hr-panel', 'ask-hr-clear', 'ask-hr-close',
    'ask-hr-messages', 'ask-hr-intro', 'ask-hr-thread', 'ask-hr-form', 'ask-hr-input',
    'ask-hr-send', 'ask-hr-compose-error'
  ].forEach(function (id) { fakeEl('div', id); });

  var document = {
    readyState: 'loading',
    hidden: false,
    body: fakeEl('body'),
    getElementById: function (id) { return byId[id] || null; },
    createElement: function (tag) { return fakeEl(tag); },
    addEventListener: function (type, fn) {
      listeners[type] = listeners[type] || [];
      listeners[type].push({ el: document, fn: fn });
    },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; }
  };

  function rpcResult(name) {
    rpcCalls.push({ name: name });
    if (name === 'apiGetAppBootstrap') {
      return {
        ok: true,
        data: {
          app: { configured: true, companyName: 'AyurCentral HRMS' },
          session: {
            authorized: true, role: 'ADMIN', employee_id: 'EMP001',
            displayName: 'Ada', email: 'ada@x.com'
          },
          navigation: [
            { route: 'dashboard', label: 'Dashboard' },
            { route: 'employees', label: 'Employees' },
            { route: 'my-leave', label: 'My Leave' },
            { route: 'payroll', label: 'Payroll' },
            { route: 'pms', label: 'Performance' },
            { route: 'ats', label: 'Recruitment' },
            { route: 'notifications', label: 'Notifications' }
          ]
        }
      };
    }
    if (name === 'apiGetHomeDashboard') return { ok: true, data: { unread_count: 1 } };
    if (name === 'apiGetHomeDashboardMore') return { ok: true, data: { notes: [] } };
    if (name === 'apiGetModuleUi') return { ok: true, data: { html: '' } };
    if (name.indexOf('apiGet') === 0 || name.indexOf('apiList') === 0 || name.indexOf('apiLeave') === 0 ||
        name.indexOf('apiPms') === 0 || name.indexOf('apiAts') === 0) {
      return { ok: true, data: { rows: [], items: [], unread_count: 0 } };
    }
    return { ok: true, data: {} };
  }

  var runObj = {
    withSuccessHandler: function (fn) { this._success = fn; return this; },
    withFailureHandler: function (fn) {
      this._fail = fn;
      var self = this;
      return new Proxy({}, {
        get: function (t, prop) {
          if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined;
          return function () {
            var result = rpcResult(String(prop));
            self._success(result);
          };
        }
      });
    }
  };

  var sandbox = {
    window: null,
    document: document,
    google: { script: { run: runObj } },
    sessionStorage: { getItem: function () { return ''; }, setItem: function () {}, removeItem: function () {} },
    localStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
    Promise: Promise,
    Date: Date,
    Array: Array,
    Object: Object,
    String: String,
    Number: Number,
    Math: Math,
    JSON: JSON,
    Proxy: Proxy,
    setTimeout: function (fn) { return 1; },
    clearTimeout: function () {},
    setInterval: function () { return 1; },
    clearInterval: function () {},
    requestAnimationFrame: function (fn) { fn(); },
    console: console
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;

  function extractJs(rel) {
    var raw = fs.readFileSync(path.join(src, rel), 'utf8');
    return raw.replace(/^[\s\S]*?<script>/i, '').replace(/<\/script>[\s\S]*$/i, '');
  }

  vm.createContext(sandbox);
  vm.runInContext(extractJs('notifications/NotificationBell.html'), sandbox);
  vm.runInContext(extractJs('ui/Scripts.html'), sandbox);

  return {
    sandbox: sandbox,
    rpcCalls: rpcCalls,
    clickBound: function () { return clickBound; },
    fireReady: function () {
      (listeners.DOMContentLoaded || []).forEach(function (entry) { entry.fn(); });
    },
    count: function (name) {
      return rpcCalls.filter(function (c) { return c.name === name; }).length;
    }
  };
}

function later() {
  return new Promise(function (resolve) { setImmediate(resolve); });
}

var env = loadShell();
var App = env.sandbox.window.HrmsApp;
check('shell-loaded', !!(App && App.consumeModuleViewRestore && App.markModuleViewLoaded));

env.fireReady();

later().then(function () {
  return later();
}).then(function () {
  check('first-dashboard-rpc', env.count('apiGetHomeDashboard') === 1, String(env.count('apiGetHomeDashboard')));
  check('first-dashboard-more-rpc', env.count('apiGetHomeDashboardMore') === 1);

  var fetches = { employees: 0, leave: 0, payroll: 0, pms: 0, ats: 0, notifications: 0 };
  var binds = { employees: 0 };

  function mountFake(route, fetchName, bucket) {
    App.registerRoute(route, {
      title: route,
      render: function () {
        var key = App.moduleViewKey(route, App.getState().routeParams);
        if (App.consumeModuleViewRestore(key)) {
          binds[bucket] = (binds[bucket] || 0) + 1;
          return;
        }
        fetches[bucket] += 1;
        binds[bucket] = (binds[bucket] || 0) + 1;
        env.rpcCalls.push({ name: fetchName });
        App.markModuleViewLoaded(key);
      }
    });
  }

  mountFake('employees', 'apiGetEmployeeDirectory', 'employees');
  mountFake('my-leave', 'apiLeaveGetMyLeave', 'leave');
  mountFake('payroll', 'apiListPayrollRuns', 'payroll');
  mountFake('pms', 'apiPmsGetDashboard', 'pms');
  mountFake('ats', 'apiAtsGetDashboard', 'ats');
  mountFake('notifications', 'apiGetNotifications', 'notifications');

  App.navigate('employees');
  check('first-employees-fetch', fetches.employees === 1 && env.count('apiGetEmployeeDirectory') === 1);

  App.navigate('my-leave');
  check('first-leave-fetch', fetches.leave === 1 && env.count('apiLeaveGetMyLeave') === 1);

  App.navigate('employees');
  check('second-employees-no-fetch', fetches.employees === 1 && env.count('apiGetEmployeeDirectory') === 1);
  check('second-employees-rebind-once', binds.employees === 2, 'paints=' + binds.employees);

  App.refreshCurrentModuleView();
  check('employees-refresh-fetches', fetches.employees === 2 && env.count('apiGetEmployeeDirectory') === 2);

  App.navigate('payroll');
  check('first-payroll-fetch', fetches.payroll === 1);
  App.navigate('my-leave');
  check('return-leave-no-fetch', fetches.leave === 1);
  App.refreshCurrentModuleView();
  check('leave-refresh-fetches', fetches.leave === 2);

  App.navigate('pms');
  check('first-pms-fetch', fetches.pms === 1);
  App.navigate('ats');
  check('first-ats-fetch', fetches.ats === 1);
  App.navigate('pms');
  check('return-pms-no-fetch', fetches.pms === 1);
  App.refreshCurrentModuleView();
  check('pms-refresh-fetches', fetches.pms === 2);

  App.navigate('ats');
  check('return-ats-no-fetch', fetches.ats === 1);
  App.refreshCurrentModuleView();
  check('ats-refresh-fetches', fetches.ats === 2);

  App.navigate('notifications');
  check('first-ntf-fetch', fetches.notifications === 1);
  App.navigate('employees');
  App.navigate('notifications');
  check('return-ntf-no-fetch', fetches.notifications === 1);
  App.refreshCurrentModuleView();
  check('ntf-refresh-fetches', fetches.notifications === 2);

  var dashBefore = env.count('apiGetHomeDashboard');
  App.navigate('dashboard');
  check('return-dashboard-no-primary', env.count('apiGetHomeDashboard') === dashBefore);
  App.refreshCurrentModuleView();
  check('dashboard-refresh-primary', env.count('apiGetHomeDashboard') === dashBefore + 1);

  check('refresh-ui-bound-once', env.clickBound() <= 1, 'clickBound=' + env.clickBound());

  var cache = App.getModuleViewCache();
  check('cache-has-employees', !!(cache && cache.employees && cache.employees.loaded));
  App.clearModuleViewCache();
  check('browser-refresh-clears-cache', Object.keys(App.getModuleViewCache()).length === 0);

  App.navigate('employees');
  check('after-clear-employees-fetches', fetches.employees === 3);

  check('optimistic-ntf-untouched', /markLocal\(/.test(ntf));
  check('poll-untouched', /apiGetUnreadNotificationCount/.test(bell));

  check('invalidate-clears-restore', !!(App.invalidateModuleViewCache && App.invalidateModuleViewCachePrefix));
  App.markModuleViewLoaded('employees');
  check('employees-cached-before-inv', !!(App.getModuleViewCache().employees && App.getModuleViewCache().employees.loaded));
  App.invalidateModuleViewCache('employees');
  check('employees-cache-cleared', !App.getModuleViewCache().employees);
  fetches.employees = 0;
  App.navigate('employees');
  check('post-invalidate-refetches', fetches.employees === 1);

  App.markModuleViewLoaded('payroll');
  App.markModuleViewLoaded('payroll-run:RUN1');
  App.invalidateModuleViewCachePrefix('payroll-run:');
  check('prefix-clears-run-not-home', !App.getModuleViewCache()['payroll-run:RUN1'] && !!App.getModuleViewCache().payroll);

  App.markModuleViewLoaded('dashboard');
  App.invalidateDashboardView();
  check('dashboard-inv-clears-shell', !App.getModuleViewCache().dashboard);

  App.markModuleViewLoaded('employees');
  App.markModuleViewLoaded('payroll');
  App.invalidateModuleViewCache('employees');
  check('scoped-inv-employees-only', !App.getModuleViewCache().employees && !!App.getModuleViewCache().payroll);

  App.markModuleViewLoaded('dashboard');
  App.markModuleViewLoaded('my-leave');
  App.invalidateDashboardView();
  check('scoped-dash-not-leave', !App.getModuleViewCache().dashboard && !!App.getModuleViewCache()['my-leave']);

  App.markModuleViewLoaded('employees');
  App.markModuleViewLoaded('my-leave');
  App.navigate('employees');
  App.navigate('employees');
  check('nav-restore-after-scoped-inv', fetches.employees === 1, 'still cached restore');

  var sess = App.getState().session;
  var leaveBeforeSwitch = fetches.leave;
  App.getState().session = {
    authorized: true, role: 'EMPLOYEE', employee_id: 'EMP999',
    displayName: 'Other', email: 'other@x.com'
  };
  App.navigate('my-leave');
  check('session-switch-no-restore-leave', fetches.leave === leaveBeforeSwitch + 1, 'must refetch for new user');
  App.getState().session = sess;
  App.clearUserSessionViewState();
  App.markModuleViewLoaded('employees');
  App.getState().session = {
    authorized: true, role: 'HR', employee_id: 'EMP001',
    displayName: 'Ada', email: 'ada@x.com'
  };
  check('role-change-no-restore', !App.consumeModuleViewRestore('employees'), 'role mismatch blocks restore');
  App.clearUserSessionViewState();
  App.getState().session = sess;
  App.markModuleViewLoaded('employees');
  var empBeforeRestore = fetches.employees;
  App.navigate('employees');
  check('restore-after-relogin-mark', fetches.employees === empBeforeRestore, 'same-session mark restores without refetch');

  if (failures.length) {
    console.error('\n' + failures.length + ' failed');
    process.exit(1);
  }
  console.log('\n' + passed + ' passed');
}).catch(function (err) {
  console.error(err);
  process.exit(1);
});
