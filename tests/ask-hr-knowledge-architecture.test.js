/**
 * Ask HR knowledge-only architecture contracts (no live DATA/HYBRID).
 * Run: node tests/ask-hr-knowledge-architecture.test.js
 */
var fs = require('fs');
var path = require('path');

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

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(__dirname, '..', rel));
}

var ask = read('apps-script/src/knowledge/AskHrService.gs');
var hub = read('apps-script/src/knowledge/KnowledgeHubClient.gs');
var api = read('apps-script/src/knowledge/ApiAskHr.gs');
var scripts = read('apps-script/src/ui/Scripts.html');
var styles = read('apps-script/src/ui/Styles.html');
var index = read('apps-script/src/ui/Index.html');
var ats = read('apps-script/src/ats/AtsService.gs');
var leave = read('apps-script/src/leave/LeaveService.gs');
var hrmsApi = read(path.join('..', 'ayurveda-ai', 'HrmsApi.js'));
var hmac = read(path.join('..', 'ayurveda-ai', 'Hmac.js'));
var driveSearch = read(path.join('..', 'ayurveda-ai', 'DriveSearch.js'));

check('phase2-router-removed', !exists('apps-script/src/knowledge/AskHrRouter.gs'));
check('phase2-data-service-removed', !exists('apps-script/src/knowledge/AskHrDataService.gs'));
check('phase2-orchestrator-removed', !exists('apps-script/src/knowledge/AskHrOrchestrator.gs'));
check('phase2-errors-removed', !exists('apps-script/src/knowledge/AskHrErrors.gs'));

check('ask-uses-hub-submit', /KnowledgeHubClient\.submit/.test(ask));
check('ask-no-orchestrator', !/AskHrOrchestrator/.test(ask));
check('ask-no-router', !/AskHrRouter/.test(ask));
check('ask-no-data-service', !/AskHrDataService/.test(ask));
check('ask-no-mode-context', !/\bmode:\s*KnowledgeHubClient\.MODE/.test(ask) && !/context:\s*contextStr/.test(ask));
check('ask-still-employee-lookup', /AskHrEmployeeLookup\.tryAnswer/.test(ask));
check('ask-still-session-rbac', /ASK_HR/.test(ask) && /ACCESS_APP/.test(ask));
check('ask-still-rate-limit', /consumeRateLimit_/.test(ask));
check('ask-no-gemini-drive', !/callGemini/.test(ask) && !/DriveApp/.test(ask));

check('kh-no-mode-export', !/MODE:\s*MODE/.test(hub) && !/MODE\.DATA/.test(hub));
check('kh-canonicalize-question-only',
  /v1\\n\{requestId\}/.test(hub) || /'v1'/.test(hub));
check('kh-no-liveSource-sanitize', !/liveSource/.test(hub) && !/liveHrmsData/.test(hub));
check('kh-build-no-mode', !/request\.mode\s*=/.test(hub) && !/request\.context\s*=/.test(hub));

check('api-one-rpc-surface', /function apiAskHr/.test(api) && !/liveSource/.test(api));

check('single-browser-rpc',
  /callServer\('apiAskHr'/.test(scripts) &&
  (scripts.match(/callServer\('apiAskHr'/g) || []).length === 1);
check('no-askhr-polling', !/setInterval\([^)]*apiAskHr/.test(scripts));
check('no-live-chip-ui', !/ask-hr-live-chip/.test(scripts) && !/Live HRMS data/.test(scripts));
check('expand-ui-kept', /ask-hr-expand/.test(index) && /toggleAskHrExpanded/.test(scripts));
check('expand-css-kept', /is-expanded/.test(styles));
check('no-live-chip-css', !/ask-hr-live-chip/.test(styles));

check('ats-no-askhr-count-helper', !/countScheduledInterviews/.test(ats));
check('leave-no-askhr-count-helper', !/countApprovedOnDate/.test(leave));

check('hub-no-mode-allowlist', !/mode:\s*true/.test(hrmsApi) && !/context:\s*true/.test(hrmsApi));
check('hub-knowledge-only-search',
  /runKnowledgeSearch_/.test(hrmsApi) &&
  !/answerAskHrFromAuthorizedData_/.test(hrmsApi) &&
  !/answerAskHrHybrid_/.test(hrmsApi));
check('hub-no-liveSource-success', !/liveSource/.test(hrmsApi));
check('hmac-question-only',
  /function buildHrmsCanonicalString_\(requestId, timestampSeconds, nonce, actorId, question\)/.test(hmac));
check('hmac-no-mode-append', !/mode === 'data'/.test(hmac) && !/m === 'data'/.test(hmac));

check('retrieval-meaning-first',
  /selectFilesForQuestion_/.test(driveSearch) &&
  /buildAskHrSelectionPrompt_/.test(driveSearch));
check('retrieval-no-live-data-path',
  !/answerAskHrFromAuthorizedData_/.test(driveSearch) &&
  !/buildAskHrLiveDataSystemPrompt_/.test(driveSearch) &&
  !/answerAskHrHybrid_/.test(driveSearch));
check('retrieval-no-folder-category-router',
  !/if question contains "manager"/.test(driveSearch) &&
  /Filenames and folder names are secondary/.test(driveSearch));
check('knowledge-system-prompt-kept', /function buildAskHrSystemPrompt_/.test(driveSearch));

if (failures.length) {
  console.error('\n' + failures.length + ' failure(s):\n- ' + failures.join('\n- '));
  process.exit(1);
}
console.log('\nAll ask-hr-knowledge-architecture checks passed (' + passed + ')');
