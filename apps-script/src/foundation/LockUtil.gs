/**
 * LockService wrapper for concurrency-sensitive operations.
 */
var HRMS = HRMS || {};

/**
 * Run fn inside a script lock. Throws LOCK_TIMEOUT on failure to acquire.
 * Nested calls in the same execution reuse the outer lock (avoids self-deadlock).
 * Uses Lock.hasLock() so concurrent USER_DEPLOYING requests cannot skip the lock
 * via a leaked process-wide depth counter.
 * @param {Function} fn
 * @param {number=} waitMs Max wait to acquire lock (default 30000).
 * @return {*}
 */
function withScriptLock_(fn, waitMs) {
  var lock = LockService.getScriptLock();
  var alreadyHeld = false;
  try {
    alreadyHeld = typeof lock.hasLock === 'function' && lock.hasLock();
  } catch (ignoreHeld) {
    alreadyHeld = false;
  }
  if (alreadyHeld) {
    return fn();
  }
  var timeout = waitMs != null ? waitMs : 30000;
  if (!lock.tryLock(timeout)) {
    throw hrmsError_(HRMS.ERROR_CODES.LOCK_TIMEOUT, 'The system is busy. Please try again in a moment.');
  }
  try {
    return fn();
  } finally {
    try {
      lock.releaseLock();
    } catch (ignoreRelease) {}
  }
}
