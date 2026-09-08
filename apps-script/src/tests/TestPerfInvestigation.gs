/**
 * Performance investigation helpers — no optimizations.
 * Enable Script Property HRMS_PERF_TIMING=1 then run from the Apps Script editor:
 *   testPerfInvestigation_Smoke()
 *   testPerfInvestigation_MarkAsRead()   (authorized editor session)
 *
 * Browser: localStorage.setItem('HRMS_PERF_TIMING','1') then HrmsApp.getPerfLog()
 */

function testPerfInvestigation_ExpectedCounts() {
  return {
    markAsRead: {
      googleScriptRun: 1,
      followUpRpc: 'none — client applies unread_count / status / read_at from the same response',
      appsScriptExecutions: '1',
      openById: 1,
      resolveSession: 1,
      usersFullRead: '0 on identity-cache hit (15s TTL); else 1 targeted Users column+row',
      employeesFullRead: '0 on identity-cache hit; else 1 targeted Employees column+row',
      settings: 'CacheService hit (typical) or Settings getDataRange miss',
      ensureSheets: '0 on normal mark-read (schema repair is setup-only)',
      notificationInboxGetDataRange: '0 — notification_id column + one row + one row setValues',
      setValues: 1,
      notes: [
        'store.find uses DbService.findOne (column index, not getDataRange)',
        'updateRecord writes the whole row with one setValues',
        'response includes unread_count so the bell does not refresh'
      ]
    },
    markAllRead: {
      googleScriptRun: 1,
      followUpRpc: 0,
      inboxFullReadPerUnread: '1 list to identify unread rows, then one batched setValues (contiguous blocks)',
      setValuePerUnread: 0,
      unread_count: 0
    },
    bellOpen: {
      googleScriptRun: 1,
      api: 'apiGetNotificationBellState',
      inboxFullRead: 1,
      separateUnreadCountRpc: false
    },
    postLoginHerd: {
      apis: [
        'apiGetAppBootstrap',
        'apiGetHomeDashboard (primary cards)',
        'apiGetHomeDashboardMore (after primary paint)',
        'idle apiGetModuleUi × 1 at a time (never all at once)'
      ],
      typicalRpcCount: '2 immediately (bootstrap + primary dashboard); secondary + idle preload do not block clicks'
    }
  };
}

function testPerfInvestigation_Smoke() {
  var expected = testPerfInvestigation_ExpectedCounts();
  var enabled = typeof HrmsPerf !== 'undefined' && HrmsPerf.enabled();
  Logger.log('HRMS_PERF_TIMING enabled=' + enabled);
  Logger.log('HRMS_PERF expectedCounts=' + JSON.stringify(expected));
  return {
    enabled: enabled,
    expected: expected,
    timingsNote: 'Set Script Property HRMS_PERF_TIMING=1 and use the web app. Logger and console show HRMS_PERF lines with requestId.'
  };
}

/**
 * Live mark-as-read probe. Uses the first inbox row if present.
 * Does not change status unless a row exists and is unread — then it marks that row read.
 * Prefer running against a copy / after enabling timing only.
 */
function testPerfInvestigation_MarkAsRead() {
  if (typeof HrmsPerf !== 'undefined' && HrmsPerf.resetEnabledCacheForTests) {
    HrmsPerf.resetEnabledCacheForTests();
  }
  var t0 = Date.now();
  var wrap = apiGetNotificationBellState('');
  var listMs = Date.now() - t0;
  var items = wrap && wrap.ok && wrap.data && wrap.data.items ? wrap.data.items : [];
  var target = null;
  for (var i = 0; i < items.length; i++) {
    if (items[i] && (items[i].unread || items[i].status === 'UNREAD')) {
      target = items[i];
      break;
    }
  }
  var markWrap = null;
  var markMs = null;
  if (target && target.notification_id) {
    var t1 = Date.now();
    markWrap = apiMarkNotificationRead(target.notification_id, '');
    markMs = Date.now() - t1;
  }
  var report = {
    bellListMs: listMs,
    bellPerf: wrap && wrap._perf,
    markMs: markMs,
    markPerf: markWrap && markWrap._perf,
    markedId: target ? target.notification_id : '',
    skipped: !target
  };
  Logger.log('HRMS_PERF markAsReadProbe=' + JSON.stringify(report));
  return report;
}
