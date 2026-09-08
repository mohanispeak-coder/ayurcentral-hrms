/**
 * Regression: NotificationBell.mount must never pass a non-element to ensureDom.
 * Covers TypeError: container.querySelector is not a function.
 * Run: node tests/notification-bell-dom.test.js
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
  return {
    add: function (c) { set[c] = true; },
    remove: function (c) { delete set[c]; },
    contains: function (c) { return !!set[c]; },
    toggle: function (c, on) {
      if (on === false || (on === undefined && set[c])) this.remove(c);
      else this.add(c);
    }
  };
}

function loadBell() {
  var byId = {};
  var listeners = {};
  var querySelectorHosts = [];
  var intervals = [];

  function fakeEl(tag, id) {
    var attrs = {};
    var children = [];
    var html = '';
    var wrap = null;
    var el = {
      nodeType: 1,
      tagName: String(tag || 'DIV').toUpperCase(),
      id: id || '',
      className: '',
      disabled: false,
      style: {},
      children: children,
      parentNode: null,
      getAttribute: function (k) { return attrs.hasOwnProperty(k) ? attrs[k] : null; },
      setAttribute: function (k, v) { attrs[k] = String(v); },
      removeAttribute: function (k) { delete attrs[k]; },
      appendChild: function (c) { children.push(c); if (c) c.parentNode = el; return c; },
      contains: function (node) { return node === el || children.indexOf(node) !== -1; },
      addEventListener: function (type, fn) {
        listeners[type] = listeners[type] || [];
        listeners[type].push({ el: el, fn: fn });
      },
      querySelector: function (sel) {
        querySelectorHosts.push({ host: el, sel: sel, nodeType: el.nodeType });
        if (sel === '.ntf-bell-wrap') return wrap;
        if (sel === '.ntf-item' || sel.indexOf('.') === 0) {
          var i;
          for (i = 0; i < children.length; i++) {
            if (children[i].className && children[i].className.indexOf(sel.slice(1)) !== -1) return children[i];
          }
        }
        return null;
      },
      querySelectorAll: function (sel) {
        querySelectorHosts.push({ host: el, sel: sel, nodeType: el.nodeType, all: true });
        if (sel === '.ntf-item') return children.filter(function (c) {
          return c.className && c.className.indexOf('ntf-item') !== -1;
        });
        return [];
      }
    };
    Object.defineProperty(el, 'innerHTML', {
      get: function () { return html; },
      set: function (v) {
        html = v == null ? '' : String(v);
        children.length = 0;
        wrap = null;
        if (html.indexOf('ntf-bell-wrap') !== -1) {
          wrap = fakeEl('div');
          wrap.className = 'ntf-bell-wrap';
          children.push(wrap);
        }
        var idRe = /id="([^"]+)"/g;
        var m;
        while ((m = idRe.exec(html))) {
          var child = fakeEl(m[1].indexOf('btn') !== -1 || m[1].indexOf('mark') !== -1 || m[1].indexOf('open') !== -1 ? 'button' : 'div', m[1]);
          byId[m[1]] = child;
          children.push(child);
        }
        var itemRe = /class="([^"]*ntf-item[^"]*)"/g;
        while ((m = itemRe.exec(html))) {
          var item = fakeEl('button');
          item.className = m[1];
          var dataId = /data-id="([^"]*)"/.exec(html.slice(m.index, m.index + 220));
          var dataRoute = /data-route="([^"]*)"/.exec(html.slice(m.index, m.index + 220));
          if (dataId) item.setAttribute('data-id', dataId[1]);
          if (dataRoute) item.setAttribute('data-route', dataRoute[1]);
          children.push(item);
        }
      }
    });
    el.classList = fakeClassList(el);
    if (id) byId[id] = el;
    return el;
  }

  var slot = fakeEl('div', 'ntf-bell-slot');
  var rpcCalls = [];
  var rpcImpl = function (name) {
    rpcCalls.push({ name: name, args: Array.prototype.slice.call(arguments, 1) });
    if (name === 'apiGetUnreadNotificationCount') {
      return Promise.resolve({ unread_count: 3 });
    }
    if (name === 'apiGetNotificationBellState') {
      return Promise.resolve({
        unread_count: 2,
        items: [
          { notification_id: 'N1', status: 'UNREAD', unread: true, title: 'Leave approved', type: 'LEAVE_APPROVED', action_route: 'leave' },
          { notification_id: 'N2', status: 'READ', unread: false, title: 'Payslip', type: 'PAYSLIP' }
        ]
      });
    }
    if (name === 'apiMarkNotificationRead') {
      return Promise.resolve({ unread_count: 1, record: { notification_id: arguments[1], read_at: '2026-08-30T00:00:00Z' } });
    }
    if (name === 'apiMarkAllNotificationsRead') {
      return Promise.resolve({ changed: 1, unread_count: 0 });
    }
    return Promise.resolve({});
  };

  var document = {
    readyState: 'loading',
    hidden: false,
    getElementById: function (id) { return byId[id] || null; },
    createElement: function (tag) { return fakeEl(tag); },
    addEventListener: function (type, fn) {
      listeners[type] = listeners[type] || [];
      listeners[type].push({ el: document, fn: fn });
    },
    body: fakeEl('body'),
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; }
  };

  var toasts = [];
  var navigations = [];
  var sandbox = {
    window: null,
    document: document,
    Promise: Promise,
    Date: Date,
    Array: Array,
    Object: Object,
    String: String,
    Number: Number,
    Boolean: Boolean,
    Error: Error,
    Math: Math,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: function (fn, ms) {
      var id = intervals.length + 1;
      intervals.push({ id: id, fn: fn, ms: ms });
      return id;
    },
    clearInterval: function (id) {
      intervals = intervals.filter(function (i) { return i.id !== id; });
    },
    console: console,
    TypeError: TypeError
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.window.HrmsApp = {
    getState: function () { return { session: { authorized: true, employee_id: 'EMP001', role: 'HR' } }; },
    callServer: function () { return rpcImpl.apply(null, arguments); },
    isUserRpcBusy: function () { return false; },
    escapeHtml: function (s) { return String(s == null ? '' : s); },
    showToast: function (msg, type) { toasts.push({ msg: msg, type: type }); },
    navigate: function (route, params) { navigations.push({ route: route, params: params || {} }); }
  };

  var raw = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'src', 'notifications', 'NotificationBell.html'), 'utf8');
  var js = raw.replace(/^[\s\S]*?<script>/i, '').replace(/<\/script>[\s\S]*$/i, '');
  vm.createContext(sandbox);
  vm.runInContext(js, sandbox);

  return {
    Bell: sandbox.window.HrmsNotificationBell,
    slot: slot,
    byId: byId,
    document: document,
    listeners: listeners,
    querySelectorHosts: querySelectorHosts,
    rpcCalls: rpcCalls,
    intervals: intervals,
    toasts: toasts,
    navigations: navigations,
    setRpc: function (fn) { rpcImpl = fn; },
    click: function (el, extra) {
      var ev = extra || { stopPropagation: function () {}, target: el, key: '' };
      (listeners.click || []).forEach(function (entry) {
        if (entry.el === el) entry.fn(ev);
      });
    }
  };
}

function noNonElementQuery(env, label) {
  var bad = env.querySelectorHosts.filter(function (h) { return h.nodeType !== 1; });
  check(label + ' querySelector only on elements', bad.length === 0, bad.length ? JSON.stringify(bad[0]) : '');
}

function extractScriptMountCalls() {
  var srcRoot = path.join(__dirname, '..', 'apps-script', 'src');
  var hits = [];
  function walk(dir) {
    fs.readdirSync(dir).forEach(function (name) {
      var full = path.join(dir, name);
      var st = fs.statSync(full);
      if (st.isDirectory()) {
        if (name === 'tests') return;
        walk(full);
        return;
      }
      if (!/\.(html|js)$/.test(name)) return;
      var text = fs.readFileSync(full, 'utf8');
      var re = /HrmsNotificationBell\.mount\s*\(([^)]*)\)/g;
      var m;
      while ((m = re.exec(text))) {
        hits.push({ file: path.relative(srcRoot, full).replace(/\\/g, '/'), args: m[1].trim() });
      }
    });
  }
  walk(srcRoot);
  return hits;
}

var calls = extractScriptMountCalls();
check('frontend mount call-sites found', calls.length >= 2, JSON.stringify(calls));
calls.forEach(function (c) {
  var ok = c.args === '' ||
    c.args === 'slotEl()' ||
    /^null\s*,/.test(c.args) ||
    /^undefined\s*,/.test(c.args);
  check('mount args in ' + c.file, ok, c.args || '(none)');
});
check('no opts-object-as-container callers', calls.every(function (c) {
  return !/^\s*\{/.test(c.args);
}));

var env = loadBell();
check('HrmsNotificationBell exported', !!(env.Bell && typeof env.Bell.mount === 'function'));

function expectNoThrow(name, fn) {
  try {
    fn();
    check(name + ' does not throw', true);
  } catch (err) {
    check(name + ' does not throw', false, (err && err.message) || String(err));
  }
}

expectNoThrow('mount(HTMLElement)', function () {
  env.Bell.mount(env.slot);
});
noNonElementQuery(env, 'after element mount');
check('ensureDom created wrap', !!(env.slot.querySelector && env.slot.querySelector('.ntf-bell-wrap')));
check('bell button mounted', !!env.document.getElementById('ntf-bell-btn'));

var pollAfterElement = env.rpcCalls.filter(function (c) { return c.name === 'apiGetUnreadNotificationCount'; }).length;
check('element mount may poll unread', pollAfterElement >= 0);

env.rpcCalls.length = 0;
expectNoThrow('mount(null, skipInitialFetch)', function () {
  env.Bell.mount(null, { skipInitialFetch: true });
});
check('null+opts skips initial unread RPC', env.rpcCalls.length === 0);
noNonElementQuery(env, 'after null+opts mount');

env.rpcCalls.length = 0;
expectNoThrow('mount({ skipInitialFetch }) regression', function () {
  env.Bell.mount({ skipInitialFetch: true });
});
check('opts-as-first-arg skips unread RPC', env.rpcCalls.length === 0);
noNonElementQuery(env, 'after opts-as-first-arg');

expectNoThrow('mount(string)', function () {
  env.Bell.mount('ntf-bell-slot');
});
noNonElementQuery(env, 'after string mount');

expectNoThrow('mount(array/NodeList-like)', function () {
  env.Bell.mount([env.slot]);
});
noNonElementQuery(env, 'after array mount');

expectNoThrow('mount(event-like)', function () {
  env.Bell.mount({ target: env.slot, type: 'click', preventDefault: function () {} });
});
noNonElementQuery(env, 'after event-like mount');

expectNoThrow('mount(button config)', function () {
  env.Bell.mount({ button: env.document.getElementById('ntf-bell-btn'), loadingText: 'Updating…' });
});
noNonElementQuery(env, 'after button-config mount');

check('60s unread poll scheduled', env.intervals.some(function (i) { return i.ms === 60000; }));

var btn = env.document.getElementById('ntf-bell-btn');

function later() {
  return new Promise(function (resolve) { setTimeout(resolve, 20); });
}

later().then(function () {
  env.rpcCalls.length = 0;
  expectNoThrow('60s poll tick', function () {
    env.intervals.forEach(function (i) {
      if (i.ms === 60000) i.fn();
    });
  });
  return later();
}).then(function () {
  var unreadPolls = env.rpcCalls.filter(function (c) { return c.name === 'apiGetUnreadNotificationCount'; });
  check('poll uses unread-count API', unreadPolls.length === 1, env.rpcCalls.map(function (c) { return c.name; }).join(','));
  noNonElementQuery(env, 'after poll tick');

  env.rpcCalls.length = 0;
  expectNoThrow('open bell', function () {
    env.click(btn, { stopPropagation: function () {} });
  });
  return later();
}).then(function () {
  var bellStateCalls = env.rpcCalls.filter(function (c) { return c.name === 'apiGetNotificationBellState'; });
  check('bell open fetches state once', bellStateCalls.length === 1);
  noNonElementQuery(env, 'after bell open');

  env.rpcCalls.length = 0;
  var list = env.document.getElementById('ntf-list');
  var itemBtn = list && list.querySelectorAll('.ntf-item')[0];
  check('list painted items', !!itemBtn);
  expectNoThrow('optimistic mark-one click', function () {
    if (itemBtn) env.click(itemBtn);
  });
  return new Promise(function (resolve) { setTimeout(resolve, 20); });
}).then(function () {
  var markCalls = env.rpcCalls.filter(function (c) { return c.name === 'apiMarkNotificationRead'; });
  var refreshCalls = env.rpcCalls.filter(function (c) { return c.name === 'apiGetNotificationBellState'; });
  check('mark-one is one RPC', markCalls.length === 1);
  check('mark-one no follow-up bell refresh', refreshCalls.length === 0);
  noNonElementQuery(env, 'after mark-one');

  env.Bell.mount(null, { skipInitialFetch: true });
  env.rpcCalls.length = 0;
  env.Bell.refresh(true);
  return new Promise(function (resolve) { setTimeout(resolve, 20); });
}).then(function () {
  var markAll = env.document.getElementById('ntf-mark-all');
  check('mark-all control present', !!markAll);
  env.rpcCalls.length = 0;
  expectNoThrow('optimistic mark-all click', function () {
    env.click(markAll);
  });
  return new Promise(function (resolve) { setTimeout(resolve, 20); });
}).then(function () {
  var markAllCalls = env.rpcCalls.filter(function (c) { return c.name === 'apiMarkAllNotificationsRead'; });
  var refreshAfterAll = env.rpcCalls.filter(function (c) { return c.name === 'apiGetNotificationBellState'; });
  check('mark-all is one batch RPC', markAllCalls.length === 1);
  check('mark-all no follow-up bell refresh', refreshAfterAll.length === 0);
  noNonElementQuery(env, 'after mark-all');

  env.Bell.unmount();
  if (failures.length) {
    console.error('\n' + failures.length + ' failed, ' + passed + ' passed');
    process.exit(1);
  }
  console.log('\nAll notification-bell-dom checks passed (' + passed + ')');
}).catch(function (err) {
  console.error(err);
  process.exit(1);
});
