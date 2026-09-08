/**
 * Ask HR answer-quality contracts (prompt grounding UI, skeleton, errors, sources).
 * Does not call Gemini, Drive, or the Hub. Run: node tests/ask-hr-answer-quality.test.js
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

var scripts = read('apps-script/src/ui/Scripts.html');
var styles = read('apps-script/src/ui/Styles.html');
var khClient = read('apps-script/src/knowledge/KnowledgeHubClient.gs');
var askHrService = read('apps-script/src/knowledge/AskHrService.gs');
var apiAskHr = read('apps-script/src/knowledge/ApiAskHr.gs');
var driveSearch = read(path.join('..', 'ayurveda-ai', 'DriveSearch.js'));
var hrmsApi = read(path.join('..', 'ayurveda-ai', 'HrmsApi.js'));
var hubTests = read(path.join('..', 'ayurveda-ai', 'Tests.js'));
var geminiJs = read(path.join('..', 'ayurveda-ai', 'Gemini.js'));
var configJs = read(path.join('..', 'ayurveda-ai', 'Config.js'));

check('single-rpc-apiAskHr', /function apiAskHr\(/.test(apiAskHr));
check('ask-hr-calls-apiAskHr-once',
  /callServer\('apiAskHr'/.test(scripts) &&
  (scripts.match(/callServer\('apiAskHr'/g) || []).length === 1);

check('no-browser-drive-search',
  !/drive\.google\.com\/drive\/folders/.test(scripts) &&
  !/UrlFetchApp/.test(scripts) &&
  !/KB_FOLDER_ID/.test(scripts));

check('hub-client-no-folder-from-browser',
  !/folderId/.test(khClient) || /never|must not|do not/i.test(khClient));

check('gemini-prompt-grounding',
  /buildAskHrSystemPrompt_/.test(driveSearch) &&
  /Do NOT invent/.test(driveSearch) &&
  /generic HR knowledge/.test(driveSearch) &&
  /ONLY the retrieved company HR documents/.test(driveSearch));
check('gemini-prompt-injection-hardening',
  /UNTRUSTED DOCUMENT CONTENT/.test(driveSearch) &&
  /reference information only/.test(driveSearch) &&
  /never as instructions/.test(driveSearch) &&
  /must never override/.test(driveSearch));

check('gemini-conflict-instruction', /conflict/i.test(driveSearch));
check('gemini-sources-instruction', /SOURCES:/.test(driveSearch));
check('retrieved-context-framing',
  /USER QUESTION:/.test(driveSearch) && /RETRIEVED HR KNOWLEDGE:/.test(driveSearch));

check('generation-failed-hub-code',
  /GENERATION_FAILED/.test(hrmsApi) && /GENERATION_FAILED/.test(khClient));
check('retrieval-failed-hub-code',
  /RETRIEVAL_FAILED/.test(hrmsApi) && /RETRIEVAL_FAILED/.test(khClient));

check('ui-error-retrieval-copy',
  /Unable to search the HR knowledge base right now/.test(scripts));
check('ui-error-generation-copy',
  /unable to generate the answer right now/i.test(scripts));
check('ui-error-notfound-copy',
  /couldn\\'t find enough information in the HR knowledge base/i.test(scripts) ||
  /couldn't find enough information in the HR knowledge base/i.test(scripts));

check('markdown-renderer-present', /function renderAskHrMarkdown/.test(scripts));
check('markdown-uses-text-nodes',
  /function appendInlineMarkdown/.test(scripts) &&
  /appendInlineMarkdown\(/.test(scripts) &&
  /createTextNode/.test(scripts));
(function () {
  var start = scripts.indexOf('function renderAskHrMarkdown');
  var slice = start >= 0 ? scripts.slice(start, start + 7000) : '';
  var nextFn = slice.search(/\n  function [a-zA-Z]/);
  if (nextFn > 0) slice = slice.slice(0, nextFn);
  check('markdown-no-innerhtml-injection', slice.indexOf('innerHTML') === -1);
})();

check('ask-hr-skeleton-loading',
  /ask-hr-skel-stack/.test(scripts) &&
  /hrms-skeleton-stack/.test(scripts) &&
  /function startAskHrStatus/.test(scripts));
check('ask-hr-skeleton-css', /ask-hr-skel-stack/.test(styles) && /\.skeleton/.test(styles));
check('ask-hr-status-cleared',
  /function stopAskHrStatus/.test(scripts) &&
  /stopAskHrStatus\(\)/.test(scripts));

check('sources-section-ui',
  /ask-hr-sources-block/.test(scripts) &&
  /textContent = 'Sources'/.test(scripts));
check('source-url-sanitizer',
  /function sanitizeAskHrFileUrl/.test(scripts) &&
  /drive\.google\.com/.test(scripts) &&
  /docs\.google\.com/.test(scripts));
check('source-urls-https-only',
  /protocol !== 'https:'/.test(scripts) || /parsed\.protocol !== 'https:'/.test(scripts));

check('no-result-hides-sources-when-notfound',
  /if \(!notFound\)/.test(scripts) && /sourceItems/.test(scripts));

check('busy-flag-prevents-duplicate-send',
  /if \(askHrUi\.busy\) return/.test(scripts));
check('request-seq-ignores-stale',
  /seq !== askHrUi\.requestSeq/.test(scripts));

check('hub-tests-cover-grounding',
  /testAskHrSystemPromptGrounding_/.test(hubTests) &&
  /testParseDriveSearchAnswerNotFound_/.test(hubTests) &&
  /testGenerationFailedMapping_/.test(hubTests) &&
  /testNoSupportedInformationMapping_/.test(hubTests) &&
  /testOneSearchCallPerQuestion_/.test(hubTests) &&
  /testFolderNameMismatchSelection_/.test(hubTests) &&
  /testBoundedRetrievalPerformance_/.test(hubTests));

check('gemini-diagnostic-logging', /logGeminiDiagnostic_/.test(geminiJs) && /classifyGeminiHttpError_/.test(geminiJs));
check('payload-inline-budget', /MAX_TOTAL_INLINE_BYTES/.test(configJs) && /maxInline/.test(driveSearch));
check('meaning-based-selection', /selectFilesForQuestion_/.test(driveSearch) && /buildAskHrSelectionPrompt_/.test(driveSearch));
check('no-filename-only-category-router', !/if question contains "manager"/.test(driveSearch) && /Filenames and folder names are secondary/.test(driveSearch));
check('sheet-export-csv', /getAs\(MimeType\.CSV\)/.test(read(path.join('..', 'ayurveda-ai', 'DriveService.js'))));
check('docs-export-text', /MimeType\.PLAIN_TEXT/.test(read(path.join('..', 'ayurveda-ai', 'DriveService.js'))));

check('ask-service-still-hub-only',
  /KnowledgeHubClient\.submit/.test(askHrService) &&
  !/callGemini/.test(askHrService) &&
  !/DriveApp/.test(askHrService));

check('no-polling-for-ask-hr-answer',
  !/setInterval\([^)]*apiAskHr/.test(scripts) &&
  !/setInterval\([^)]*callAskHr/.test(scripts));

check('expand-ui-kept', /ask-hr-expand/.test(scripts) || /toggleAskHrExpanded/.test(scripts));
check('no-live-source-client', !/liveSource/.test(khClient) && !/Live HRMS data/.test(scripts));
check('no-data-answer-path',
  !/answerAskHrFromAuthorizedData_/.test(driveSearch) &&
  !/buildAskHrLiveDataSystemPrompt_/.test(driveSearch));
check('knowledge-path-direct-submit',
  /KnowledgeHubClient\.submit/.test(askHrService) &&
  !/AskHrOrchestrator/.test(askHrService));

if (failures.length) {
  console.error('\n' + failures.length + ' failure(s):\n- ' + failures.join('\n- '));
  process.exit(1);
}
console.log('\nAll ask-hr-answer-quality checks passed (' + passed + ')');
