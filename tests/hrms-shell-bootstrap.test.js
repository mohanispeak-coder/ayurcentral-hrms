/**
 * Shell bootstrap + lazy-nav smoke for the querySelector regression.
 * Loads NotificationBell then Scripts (same order as Index.html) and runs
 * applyBootstrapSuccess, which must call mount(null, { skipInitialFetch: true }).
 * Run: node tests/hrms-shell-bootstrap.test.js
 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var failures = [];
var passed = 0;

function check(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log('PASS ' + name + (detail ? ' — ' + detail : ''));
  } else {
    failures.push(name + (detail ? ': ' + detail : ''));
    console.log('FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}

function fakeClassList(el) {
  var set = {};
  if (el.className) {
    String(el.className).split(/\s+/).forEach(function (c) { if (c) set[c] = true; });
  }
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

var SHELL_IDS = [
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
];

function loadShell() {
  var byId = {};
  var listeners = {};
  var rpcCalls = [];
  var thrown = [];
  var querySelectorHosts = [];

  function fakeEl(tag, id) {
    var attrs = {};
    var children = [];
    var html = '';
    var text = '';
    var wrap = null;
    var el = {
      nodeType: 1,
      tagName: String(tag || 'DIV').toUpperCase(),
      id: id || '',
      className: '',
      disabled: false,
      type: tag === 'button' ? 'button' : '',
      value: '',
      style: {},
      dataset: {},
      children: children,
      parentNode: null,
      firstChild: null,
      offsetWidth: 80,
      getAttribute: function (k) { return attrs.hasOwnProperty(k) ? attrs[k] : null; },
      setAttribute: function (k, v) { attrs[k] = String(v); },
      removeAttribute: function (k) { delete attrs[k]; },
      appendChild: function (c) {
        children.push(c);
        if (c) c.parentNode = el;
        el.firstChild = children[0] || null;
        return c;
      },
      removeChild: function (c) {
        var i = children.indexOf(c);
        if (i >= 0) children.splice(i, 1);
        if (c) c.parentNode = null;
        el.firstChild = children[0] || null;
        return c;
      },
      remove: function () {
        if (el.parentNode && el.parentNode.removeChild) el.parentNode.removeChild(el);
      },
      contains: function (node) { return node === el || children.indexOf(node) !== -1; },
      addEventListener: function (type, fn) {
        listeners[type] = listeners[type] || [];
        listeners[type].push({ el: el, fn: fn });
      },
      querySelector: function (sel) {
        querySelectorHosts.push({ host: el, sel: sel, nodeType: el.nodeType });
        if (sel === '.ntf-bell-wrap') return wrap;
        var i;
        for (i = 0; i < children.length; i++) {
          if (sel.charAt(0) === '.' && children[i].className && children[i].className.indexOf(sel.slice(1)) !== -1) {
            return children[i];
          }
        }
        return null;
      },
      querySelectorAll: function (sel) {
        querySelectorHosts.push({ host: el, sel: sel, nodeType: el.nodeType, all: true });
        if (sel === 'script') {
          return children.filter(function (c) { return c.tagName === 'SCRIPT'; });
        }
        return children.filter(function (c) {
          return sel.charAt(0) === '.' && c.className && c.className.indexOf(sel.slice(1).split(',')[0].trim()) !== -1;
        });
      },
      focus: function () {},
      click: function () {}
    };
    Object.defineProperty(el, 'innerHTML', {
      get: function () { return html; },
      set: function (v) {
        html = v == null ? '' : String(v);
        children.length = 0;
        el.firstChild = null;
        wrap = null;
        if (html.indexOf('ntf-bell-wrap') !== -1) {
          wrap = fakeEl('div');
          wrap.className = 'ntf-bell-wrap';
          el.appendChild(wrap);
        }
        var idRe = /id="([^"]+)"/g;
        var m;
        while ((m = idRe.exec(html))) {
          var child = fakeEl('div', m[1]);
          byId[m[1]] = child;
          el.appendChild(child);
        }
        var itemRe = /class="([^"]*ntf-item[^"]*)"/g;
        while ((m = itemRe.exec(html))) {
          var item = fakeEl('button');
          item.className = m[1];
          el.appendChild(item);
        }
        if (html.indexOf('<script') !== -1) {
          var scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
          while ((m = scriptRe.exec(html))) {
            var sc = fakeEl('script');
            sc.textContent = m[1] || '';
            sc.text = m[1] || '';
            el.appendChild(sc);
          }
        }
      }
    });
    Object.defineProperty(el, 'textContent', {
      get: function () { return text; },
      set: function (v) { text = v == null ? '' : String(v); }
    });
    el.classList = fakeClassList(el);
    if (id) byId[id] = el;
    return el;
  }

  SHELL_IDS.forEach(function (id) {
    fakeEl(id.indexOf('btn') === 0 || id.indexOf('toggle') !== -1 ? 'button' : 'div', id);
  });
  byId['auth-email'] = fakeEl('input', 'auth-email');
  byId['auth-code'] = fakeEl('input', 'auth-code');
  byId['ask-hr-input'] = fakeEl('textarea', 'ask-hr-input');

  var body = fakeEl('body');
  var document = {
    readyState: 'loading',
    hidden: false,
    body: body,
    getElementById: function (id) { return byId[id] || null; },
    createElement: function (tag) { return fakeEl(tag); },
    addEventListener: function (type, fn) {
      listeners[type] = listeners[type] || [];
      listeners[type].push({ el: document, fn: fn });
    },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; }
  };

  function rpcResult(name, args) {
    rpcCalls.push({ name: name, args: args });
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
            display_name: 'Ada',
            email: 'ada@x.com'
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
    if (name === 'apiGetHomeDashboard') {
      return { ok: true, data: { unread_count: 2, kpis: [], attention: [] } };
    }
    if (name === 'apiGetHomeDashboardMore') {
      return { ok: true, data: { notes: [] } };
    }
    if (name === 'apiGetModuleUi') {
      return { ok: true, data: { html: '<div data-module="' + args[0] + '"></div>' } };
    }
    if (name === 'apiGetUnreadNotificationCount') {
      return { ok: true, data: { unread_count: 2 } };
    }
    if (name === 'apiGetNotificationBellState') {
      return {
        ok: true,
        data: {
          unread_count: 1,
          items: [{ notification_id: 'N1', status: 'UNREAD', unread: true, title: 'Hi', type: 'LEAVE' }]
        }
      };
    }
    if (name === 'apiMarkNotificationRead') {
      return { ok: true, data: { unread_count: 0, record: { read_at: '2026-08-30T00:00:00Z' } } };
    }
    if (name === 'apiMarkAllNotificationsRead') {
      return { ok: true, data: { changed: 1, unread_count: 0 } };
    }
    return { ok: true, data: {} };
  }

  var runObj = {
    withSuccessHandler: function (fn) {
      this._success = fn;
      return this;
    },
    withFailureHandler: function (fn) {
      this._fail = fn;
      var self = this;
      return new Proxy({}, {
        get: function (t, prop) {
          if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined;
          return function () {
            var args = Array.prototype.slice.call(arguments);
            var result;
            try {
              result = rpcResult(String(prop), args);
            } catch (e) {
              self._fail(e);
              return;
            }
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
    Boolean: Boolean,
    Error: Error,
    TypeError: TypeError,
    Math: Math,
    JSON: JSON,
    Proxy: Proxy,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: function () { return 1; },
    clearInterval: function () {},
    console: console,
    URL: URL,
    atob: function () { return ''; },
    requestIdleCallback: null
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.window.onerror = function (msg) { thrown.push(String(msg)); };

  function extractJs(rel) {
    var raw = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'src', rel), 'utf8');
    return raw.replace(/^[\s\S]*?<script>/i, '').replace(/<\/script>[\s\S]*$/i, '');
  }

  vm.createContext(sandbox);
  vm.runInContext(extractJs('notifications/NotificationBell.html'), sandbox);
  vm.runInContext(extractJs('ui/Scripts.html'), sandbox);

  return {
    sandbox: sandbox,
    byId: byId,
    listeners: listeners,
    rpcCalls: rpcCalls,
    thrown: thrown,
    querySelectorHosts: querySelectorHosts,
    fireReady: function () {
      (listeners.DOMContentLoaded || []).forEach(function (entry) {
        try { entry.fn(); } catch (err) { thrown.push(err.message || String(err)); }
      });
    }
  };
}

var env = loadShell();
check('bell + app loaded', !!(env.sandbox.window.HrmsNotificationBell && env.sandbox.window.HrmsApp));

env.fireReady();

later().then(function () {
  var bootErr = env.thrown.filter(function (m) { return /querySelector is not a function/.test(m); });
  check('bootstrap has no querySelector TypeError', bootErr.length === 0, bootErr.join('; '));
  check('no uncaught bootstrap errors', env.thrown.length === 0, env.thrown.join('; '));
  check('bootstrap RPC', env.rpcCalls.some(function (c) { return c.name === 'apiGetAppBootstrap'; }));
  check('dashboard primary RPC', env.rpcCalls.some(function (c) { return c.name === 'apiGetHomeDashboard'; }));
  check('no post-login unread poll', !env.rpcCalls.some(function (c) { return c.name === 'apiGetUnreadNotificationCount'; }));
  check('bell mounted into slot', !!(env.byId['ntf-bell-btn'] || (env.byId['ntf-bell-slot'] && env.byId['ntf-bell-slot'].innerHTML.indexOf('ntf-bell') !== -1)));
  var chip = env.byId['user-name'] && env.byId['user-name'].textContent;
  check('user chip updated', !!(chip && chip !== 'Loading…'), chip);
  check('dashboard title', env.byId['page-title'] && env.byId['page-title'].textContent === 'Dashboard');

  var badQs = env.querySelectorHosts.filter(function (h) { return h.nodeType !== 1; });
  check('shell querySelector only on elements', badQs.length === 0, badQs[0] ? JSON.stringify(badQs[0]) : '');

  var App = env.sandbox.window.HrmsApp;
  ['employees', 'my-leave', 'payroll', 'pms', 'ats', 'notifications'].forEach(function (route) {
    try {
      App.navigate(route);
      check('navigate ' + route + ' no throw', true);
    } catch (err) {
      check('navigate ' + route + ' no throw', false, err.message);
    }
  });
  return later();
}).then(function () {
  var mods = {};
  env.rpcCalls.forEach(function (c) {
    if (c.name === 'apiGetModuleUi') mods[c.args[0]] = true;
  });
  check('lazy employee module', !!mods.employee);
  check('lazy leave module', !!mods.leave);
  check('lazy payroll module', !!mods.payroll);
  check('lazy pms module', !!mods.pms);
  check('lazy ats module', !!mods.ats);
  check('lazy notifications module', !!mods.notifications);
  check('preload herd absent at boot', env.rpcCalls.filter(function (c) { return c.name === 'apiGetModuleUi'; }).length <= 6);

  if (failures.length) {
    console.error('\n' + failures.length + ' failed, ' + passed + ' passed');
    process.exit(1);
  }
  console.log('\nAll hrms-shell-bootstrap checks passed (' + passed + ')');
}).catch(function (err) {
  console.error(err);
  process.exit(1);
});

function later() {
  return new Promise(function (resolve) { setTimeout(resolve, 30); });
}
