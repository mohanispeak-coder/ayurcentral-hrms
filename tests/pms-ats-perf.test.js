/**
 * Source-level contracts for PMS + ATS performance (Phase 5).
 * Run: node tests/pms-ats-perf.test.js
 */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'apps-script', 'src');
const failures = [];

function read(rel) {
  return fs.readFileSync(path.join(src, rel), 'utf8');
}

function fnBlock(source, name, nextName) {
  const start = source.indexOf('function ' + name);
  if (start < 0) return '';
  if (!nextName) return source.slice(start);
  const end = source.indexOf('function ' + nextName, start + 1);
  return end < 0 ? source.slice(start) : source.slice(start, end);
}

function check(name, cond, detail) {
  if (cond) {
    console.log('PASS ' + name + (detail ? ' — ' + detail : ''));
  } else {
    failures.push(name + (detail ? ': ' + detail : ''));
    console.log('FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}

function maybeRead(rel) {
  var full = path.join(src, rel);
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : '';
}

const pms = maybeRead('pms/PmsService.gs');
const pmsApi = maybeRead('pms/ApiPms.gs');
const pmsClient = maybeRead('pms/PmsClient.html');
const ats = read('ats/AtsService.gs');
const atsClient = read('ats/AtsClient.html');

if (pms) {
  check('pms-read-no-ensure-cycle', !/function getCycle[\s\S]{0,80}ensure_\(\)/.test(pms));
  check('pms-read-no-ensure-review', !/function getReviewBundle[\s\S]{0,80}ensure_\(\)/.test(pms));
  check('pms-read-no-ensure-team', !/function listTeamReviews[\s\S]{0,80}ensure_\(\)/.test(pms));
  check('pms-read-no-ensure-assign', !/function listAssignableEmployees[\s\S]{0,80}ensure_\(\)/.test(pms));
  const teamFnPms = fnBlock(pms, 'listTeamReviews', 'listAppraisals');
  const dashFn = fnBlock(pms, 'getDashboard', 'listRatingScale');
  check('pms-team-indexed-reviews', /PmsEngine\.findReview\(allReviews/.test(teamFnPms));
  check('pms-team-single-goals-read', /allGoals/.test(teamFnPms) && /allReviews/.test(teamFnPms));
  check('pms-dashboard-inmemory-review', /PmsEngine\.findReview\(reviews/.test(dashFn));
  check('pms-namemap-single-pass', !/function nameMap_[\s\S]{0,200}listActiveEmployees_/.test(pms));
  check('pms-cycle-bundle-api', /function apiPmsGetCycleBundle/.test(pmsApi));
  check('pms-cycle-bundle-service', /function getCycleBundle/.test(pms));
  check('pms-client-cycle-bundle', /apiPmsGetCycleBundle/.test(pmsClient));
  check('pms-client-no-triple-cycle', !/Promise\.all\([\s\S]{0,120}apiPmsGetCycle/.test(pmsClient));
} else {
  check('pms-module-absent-phase1', true, 'PMS is out of Phase 1; ATS contracts still run');
}

const candFn = fnBlock(ats, 'getCandidate', 'addComment');

check('ats-job-no-full-candidate-scan', !/function getJob[\s\S]{0,700}listCandidates\(\)/.test(ats));
check('ats-job-per-app-find', /function getJob[\s\S]{0,700}findCandidate\(/.test(ats));
check('ats-candidate-job-map', /jobById/.test(candFn) && /packed\.jobs\.forEach/.test(candFn));
check('ats-list-candidates-once', !/function listCandidates[\s\S]{0,900}listCandidates\(\)[\s\S]{0,400}listCandidates\(\)/.test(ats));
check('ats-list-app-count-index', /appCountByCandidate/.test(ats));
check('ats-sharepack-light', !/function getSharePack[\s\S]{0,120}getJob\(/.test(ats));
check('ats-scoped-interview-index', /interviewsByJob_/.test(ats));
check('ats-move-stage-locked', /function moveStage[\s\S]{0,200}runLocked_/.test(ats));
check('ats-create-job-reentrant-lock', /function createJob[\s\S]{0,400}runLocked_/.test(ats) &&
  /options\.alreadyLocked/.test(ats));
check('ats-client-patch-move', /patchJobDetailAfterMove_/.test(atsClient));

if (failures.length) {
  console.error('\n' + failures.length + ' failed');
  process.exit(1);
}
console.log('\nAll pms-ats-perf contracts passed');
