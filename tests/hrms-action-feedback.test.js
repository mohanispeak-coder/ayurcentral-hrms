/**
 * Client action-feedback tests for HrmsApp.callServer loading / restore.
 * Run: node tests/hrms-action-feedback.test.js
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
    add: function (c) { set[c] = true; el.className = Object.keys(set).join(' '); },
    remove: function (c) { delete set[c]; el.className = Object.keys(set).join(' '); },
    contains: function (c) { return !!set[c]; },
    toggle: function (c, on) {
      if (on === false || (on === undefined && set[c])) this.remove(c);
      else this.add(c);
    }
  };
}

function fakeEl(tag, id) {
  var attrs = {};
  var children = [];
  var el = {
    nodeType: 1,
    tagName: String(tag || 'DIV').toUpperCase(),
    id: id || '',
    innerHTML: '',
    _text: '',
    disabled: false,
    className: '',
    style: { minWidth: '' },
    offsetWidth: 80,
    parentNode: null,
    children: children,
    getAttribute: function (k) { return attrs.hasOwnProperty(k) ? attrs[k] : null; },
    setAttribute: function (k, v) { attrs[k] = String(v); },
    removeAttribute: function (k) { delete attrs[k]; },
    appendChild: function (c) { children.push(c); if (c) c.parentNode = el; return c; },
    querySelector: function (sel) {
      if (sel === '.btn-loading-label') {
        var i;
        for (i = 0; i < children.length; i++) {
          if (children[i].className && children[i].className.indexOf('btn-loading-label') !== -1) return children[i];
        }
      }
      if (sel.indexOf('#') === 0) return null;
      return null;
    },
    querySelectorAll: function () { return []; },
    addEventListener: function () {},
    focus: function () {},
    click: function () {}
  };
  el.classList = fakeClassList(el);
  Object.defineProperty(el, 'textContent', {
    get: function () { return el._text; },
    set: function (v) {
      el._text = v == null ? '' : String(v);
      el.innerHTML = el._text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }
  });
  return el;
}

function loadApp(controller) {
  var byId = {};
  var created = [];
  var listeners = {};

  var document = {
    getElementById: function (id) { return byId[id] || null; },
    createElement: function (tag) {
      var el = fakeEl(tag);
      created.push(el);
      return el;
    },
    addEventListener: function (type, fn) {
      listeners[type] = listeners[type] || [];
      listeners[type].push(fn);
    },
    body: fakeEl('body'),
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; }
  };

  var store = {};
  var sessionStorage = {
    getItem: function (k) { return store.hasOwnProperty(k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; }
  };

  controller.calls = [];
  controller.success = null;
  controller.failure = null;
  controller.pending = true;
  controller.result = { ok: true, data: { value: 1 } };
  controller.error = { message: 'boom' };

  var runObj = {
    withSuccessHandler: function (fn) {
      controller.success = fn;
      return this;
    },
    withFailureHandler: function (fn) {
      controller.failure = fn;
      return new Proxy({}, {
        get: function (t, prop) {
          if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined;
          return function () {
            controller.fnName = String(prop);
            controller.args = Array.prototype.slice.call(arguments);
            controller.calls.push({ fn: controller.fnName, args: controller.args });
            if (controller.mode === 'throw') throw new Error('RPC unavailable');
            if (controller.mode === 'success') controller.success(controller.result);
            else if (controller.mode === 'failure') controller.failure(controller.error);
            else if (controller.mode === 'throw-success') {
              controller.success = controller.success;
              throw new Error('handler explode');
            }
          };
        }
      });
    }
  };

  var sandbox = {
    window: null,
    document: document,
    google: { script: { run: runObj } },
    sessionStorage: sessionStorage,
    Promise: Promise,
    Date: Date,
    Array: Array,
    Object: Object,
    String: String,
    Number: Number,
    Boolean: Boolean,
    Error: Error,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval,
    console: console,
    URL: URL,
    atob: function () { return ''; }
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.global = sandbox;

  var srcPath = path.join(__dirname, '..', 'apps-script', 'src', 'ui', 'Scripts.html');
  var raw = fs.readFileSync(srcPath, 'utf8');
  var js = raw.replace(/^\s*<script>/i, '').replace(/<\/script>\s*$/i, '');
  vm.createContext(sandbox);
  vm.runInContext(js, sandbox);

  return {
    App: sandbox.window.HrmsApp,
    document: document,
    byId: byId,
    controller: controller,
    register: function (id, el) { byId[id] = el; el.id = id; }
  };
}

function wait(p) {
  return Promise.resolve(p);
}

var ctrl = {};
var env = loadApp(ctrl);
var App = env.App;

check('HrmsApp exported', !!App && typeof App.callServer === 'function');
check('setButtonLoading exported', typeof App.setButtonLoading === 'function');
check('restoreButton exported', typeof App.restoreButton === 'function');
check('Ask HR callServer still present', typeof App.callServer === 'function' && !!env.App);

var btn = fakeEl('button');
btn.innerHTML = 'Save';
btn.disabled = false;
var didLoad = App.setButtonLoading(btn, 'Saving employee...');
check('setButtonLoading returns true', didLoad === true);
check('setButtonLoading disables', btn.disabled === true);
check('setButtonLoading marks data attr', btn.getAttribute('data-hrms-loading') === '1');
check('setButtonLoading spinner html', String(btn.innerHTML).indexOf('btn-spinner') !== -1);
check('setButtonLoading label', String(btn.innerHTML).indexOf('Saving employee...') !== -1);
check('isButtonLoading true', App.isButtonLoading(btn) === true);

var second = App.setButtonLoading(btn, 'Again');
check('double setButtonLoading refused', second === false);

App.restoreButton(btn);
check('restoreButton re-enables', btn.disabled === false);
check('restoreButton original html', btn.innerHTML === 'Save');
check('restoreButton clears loading', App.isButtonLoading(btn) === false);

App.restoreButton(btn);
check('restoreButton idempotent', btn.disabled === false);

var disabledBtn = fakeEl('button');
disabledBtn.innerHTML = 'Wait';
disabledBtn.disabled = true;
App.setButtonLoading(disabledBtn, 'Working…');
App.restoreButton(disabledBtn);
check('restore preserves originally-disabled', disabledBtn.disabled === true);

function runAsync() {
  ctrl.mode = 'success';
  ctrl.result = { ok: true, data: { employee_id: 'EMP001' } };
  ctrl.calls = [];
  var payload = { first_name: 'Ada', net_pay: 0 };
  return App.callServer('apiCreateEmployee', payload).then(function (data) {
    check('callServer unwraps ok envelope', data && data.employee_id === 'EMP001');
    var firstArgs = ctrl.calls[0] && ctrl.calls[0].args;
    check('payload not treated as action opts', firstArgs && firstArgs[0] && firstArgs[0].first_name === 'Ada' && firstArgs[0].net_pay === 0);
    check('session token appended', firstArgs && typeof firstArgs[firstArgs.length - 1] === 'string');
  }).then(function () {
    var actionBtn = fakeEl('button');
    actionBtn.innerHTML = 'Submit';
    var feedback = fakeEl('div');
    feedback.classList.add('action-feedback');
    feedback.classList.add('hidden');
    ctrl.mode = 'success';
    ctrl.result = { ok: true, data: { ok: true } };
    return App.callServer('apiLeaveSubmit', { leave_type_id: 'LT1' }, {
      button: actionBtn,
      loadingText: 'Submitting...',
      feedback: feedback,
      successMessage: 'Leave submitted.'
    }).then(function () {
      check('action button restored after success', actionBtn.disabled === false && actionBtn.innerHTML === 'Submit');
      check('inline success message', feedback._text === 'Leave submitted.');
    });
  }).then(function () {
    var failBtn = fakeEl('button');
    failBtn.innerHTML = 'Approve';
    var failFb = fakeEl('div');
    failFb.classList.add('action-feedback');
    ctrl.mode = 'failure';
    ctrl.error = { message: 'Not allowed' };
    return App.callServer('apiLeaveApprove', 'LR1', 'ok', {
      button: failBtn,
      loadingText: 'Approving...',
      feedback: failFb
    }).then(function () {
      check('failure rejects', false);
    }).catch(function (err) {
      check('failure rejects with message', err && err.message === 'Not allowed');
      check('action button restored after failure', failBtn.disabled === false && failBtn.innerHTML === 'Approve');
      check('inline error near operation', failFb._text === 'Not allowed');
    });
  }).then(function () {
    ctrl.mode = 'success';
    ctrl.result = { ok: false, error: { message: 'Validation failed', details: { fields: {} } } };
    var valBtn = fakeEl('button');
    valBtn.innerHTML = 'Save';
    return App.callServer('apiUpdateEmployee', 'EMP1', { first_name: 'x' }, {
      button: valBtn,
      loadingText: 'Saving employee...'
    }).then(function () {
      check('envelope error rejects', false);
    }).catch(function () {
      check('envelope error rejects', true);
      check('restore after envelope error', valBtn.disabled === false && valBtn.innerHTML === 'Save');
    });
  }).then(function () {
    ctrl.mode = null;
    ctrl.calls = [];
    var dbl = fakeEl('button');
    dbl.innerHTML = 'Calculate';
    var p1 = App.callServer('apiCalculatePayroll', 'RUN1', { net_pay: 0 }, {
      button: dbl,
      loadingText: 'Calculating payroll...'
    });
    var p2 = App.callServer('apiCalculatePayroll', 'RUN1', { net_pay: 0 }, {
      button: dbl,
      loadingText: 'Calculating payroll...'
    });
    check('double-submit single RPC', ctrl.calls.length === 1);
    check('double-submit same promise', p1 === p2);
    check('double-submit stays loading', App.isButtonLoading(dbl) === true);
    var calcArgs = ctrl.calls[0] && ctrl.calls[0].args;
    check('calculate payload kept', calcArgs && calcArgs[1] && calcArgs[1].net_pay === 0);
    ctrl.success({ ok: true, data: { status: 'CALCULATED' } });
    return p1.then(function (data) {
      check('double-submit resolves once', data && data.status === 'CALCULATED');
      check('double-submit restores after resolve', App.isButtonLoading(dbl) === false && dbl.disabled === false);
    });
  }).then(function () {
    ctrl.mode = 'success';
    ctrl.result = { ok: true, data: 42 };
    var throwBtn = fakeEl('button');
    throwBtn.innerHTML = 'Go';
    return App.callServer('apiLockPayroll', 'RUN1', { button: throwBtn, loadingText: 'Locking...' })
      .then(function () {
        throw new Error('user callback exploded');
      })
      .then(function () {
        check('user then-throw propagates', false);
      }, function (err) {
        check('user then-throw still restores button', throwBtn.disabled === false && throwBtn.innerHTML === 'Go');
        check('user then-throw propagates', err && err.message === 'user callback exploded');
      });
  }).then(function () {
    ctrl.mode = 'success';
    ctrl.result = { ok: true, data: 'x' };
    ctrl.calls = [];
    return App.callServer('apiFoo', { button: 'not-a-dom-node', loadingText: 'x' }).then(function () {
      var last = ctrl.calls[0] && ctrl.calls[0].args && ctrl.calls[0].args[0];
      check('plain object with string button is payload', last && last.button === 'not-a-dom-node');
    });
  }).then(function () {
    ctrl.mode = 'throw';
    var missingBtn = fakeEl('button');
    missingBtn.innerHTML = 'Send';
    return App.callServer('apiMissing', { button: missingBtn, loadingText: 'Sending…' }).then(function () {
      check('invoke throw restores', false);
    }).catch(function () {
      check('invoke throw restores', missingBtn.disabled === false && App.isButtonLoading(missingBtn) === false);
    });
  }).then(function () {
    if (failures.length) {
      console.error('\n' + failures.length + ' failed, ' + passed + ' passed');
      process.exit(1);
    }
    console.log('\nAll action-feedback checks passed (' + passed + ')');
  }).catch(function (err) {
    console.error(err);
    process.exit(1);
  });
}

runAsync();
