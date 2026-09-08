/**
 * Opt-in request-path timing. No PII, OTPs, tokens, or sheet contents.
 * Enable with Script Property HRMS_PERF_TIMING=1.
 * Client: localStorage.HRMS_PERF_TIMING=1 or window.HRMS_PERF_TIMING=1.
 *
 * When enabled, hrmsRun_ attaches `_perf` on the { ok, data } envelope only.
 * Business payloads are unchanged.
 */
var HRMS = HRMS || {};

var HrmsPerf = (function () {
  var enabledCached_ = null;
  var current_ = null;

  function enabled() {
    if (enabledCached_ !== null) return enabledCached_;
    try {
      enabledCached_ = PropertiesService.getScriptProperties().getProperty(HRMS.PROPS.PERF_TIMING) === '1';
    } catch (e) {
      enabledCached_ = false;
    }
    return enabledCached_;
  }

  function newId_() {
    return 's' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  }

  function inferApiName_() {
    try {
      var stack = String((new Error()).stack || '');
      var match = stack.match(/\b(api[A-Za-z0-9_]+)\b/);
      return match ? match[1] : '';
    } catch (e) {
      return '';
    }
  }

  function emptyCounts_() {
    return {
      resolveSession: 0,
      permissionRequire: 0,
      openById: 0,
      getSheetByName: 0,
      getLastRow: 0,
      getDataRange: 0,
      getValues: 0,
      setValue: 0,
      setValues: 0,
      appendRow: 0,
      settingsCacheHit: 0,
      settingsCacheMiss: 0,
      sheetCacheHit: 0,
      valuesCacheHit: 0,
      sheetReads: {},
      writes: {}
    };
  }

  function begin(apiName) {
    if (!enabled()) return null;
    current_ = {
      requestId: newId_(),
      api: apiName || inferApiName_() || '',
      t0: Date.now(),
      stages: {},
      counts: emptyCounts_(),
      marks: []
    };
    mark('fnStart');
    return current_;
  }

  function mark(name) {
    if (!current_) return;
    current_.marks.push({ name: String(name || ''), t: Date.now() - current_.t0 });
  }

  function addStage(name, ms) {
    if (!current_ || !name) return;
    var n = Number(ms) || 0;
    if (n < 0) n = 0;
    current_.stages[name] = (current_.stages[name] || 0) + n;
  }

  function bumpMap_(map, key) {
    if (!key) return;
    map[key] = (map[key] || 0) + 1;
  }

  /**
   * @param {string} key Counter name.
   * @param {string=} sheetName Optional sheet for read/write maps.
   */
  function count(key, sheetName) {
    if (!current_ || !key) return;
    if (current_.counts.hasOwnProperty(key)) {
      current_.counts[key]++;
    }
    if (!sheetName) return;
    if (key === 'setValue' || key === 'setValues' || key === 'appendRow') {
      bumpMap_(current_.counts.writes, sheetName);
    } else if (key === 'getDataRange' || key === 'getValues' || key === 'getLastRow' || key === 'getSheetByName') {
      bumpMap_(current_.counts.sheetReads, sheetName);
    }
  }

  /**
   * @param {string} name Metric name (no sensitive data).
   * @param {number} ms Duration milliseconds.
   */
  function log(name, ms) {
    if (!enabled()) return;
    Logger.log('HRMS_PERF ' + name + '=' + Math.round(ms) + 'ms');
  }

  /**
   * @param {string} name
   * @param {Function} fn
   * @return {{result: *, ms: number}}
   */
  function measure(name, fn) {
    var t0 = Date.now();
    var result = fn();
    var ms = Date.now() - t0;
    log(name, ms);
    return { result: result, ms: ms };
  }

  function snapshot() {
    if (!current_) return null;
    var totalMs = Date.now() - current_.t0;
    var stages = current_.stages;
    var accounted = 0;
    Object.keys(stages).forEach(function (k) {
      if (k === 'total' || k === 'other' || k === 'business') return;
      accounted += Number(stages[k]) || 0;
    });
    var other = totalMs - accounted;
    if (other < 0) other = 0;
    return {
      requestId: current_.requestId,
      api: current_.api,
      totalMs: totalMs,
      sessionMs: Math.round(stages.session || 0),
      permissionMs: Math.round(stages.permission || 0),
      openByIdMs: Math.round(stages.openById || 0),
      sheetLookupMs: Math.round(stages.sheetLookup || 0),
      getDataRangeMs: Math.round(stages.getDataRange || 0),
      writeMs: Math.round(stages.write || 0),
      ensureMs: Math.round(stages.ensure || 0),
      serializeMs: Math.round(stages.serialize || 0),
      otherMs: Math.round(other),
      stages: stages,
      counts: current_.counts,
      marks: current_.marks
    };
  }

  function end() {
    if (!current_) return null;
    mark('fnEnd');
    var snap = snapshot();
    try {
      Logger.log('HRMS_PERF ' + JSON.stringify(snap));
    } catch (ignore) {}
    current_ = null;
    return snap;
  }

  function current() {
    return current_;
  }

  /** Test helper — forget the cached flag so the next enabled() re-reads properties. */
  function resetEnabledCacheForTests() {
    enabledCached_ = null;
  }

  return {
    enabled: enabled,
    log: log,
    measure: measure,
    begin: begin,
    mark: mark,
    addStage: addStage,
    count: count,
    snapshot: snapshot,
    end: end,
    current: current,
    inferApiName: inferApiName_,
    resetEnabledCacheForTests: resetEnabledCacheForTests
  };
})();
