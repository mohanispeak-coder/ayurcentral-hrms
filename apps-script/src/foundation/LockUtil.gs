/**
 * LockService wrapper for concurrency-sensitive operations.
 */
var HRMS = HRMS || {};

/** Same-execution nested lock depth (LockService is not re-entrant). */
var scriptLockDepth_ = 0;

/**
 * Run fn inside a script lock. Throws LOCK_TIMEOUT on failure to acquire.
 * Nested calls in the same execution reuse the outer lock (avoids self-deadlock).
 * @param {Function} fn
 * @param {number=} waitMs Max wait to acquire lock (default 30000).
 * @return {*}
 */
function withScriptLock_(fn, waitMs) {
  if (scriptLockDepth_ > 0) {
    return fn();
  }
  var lock = LockService.getScriptLock();
  var timeout = waitMs != null ? waitMs : 30000;
  if (!lock.tryLock(timeout)) {
    throw hrmsError_(HRMS.ERROR_CODES.LOCK_TIMEOUT, 'The system is busy. Please try again in a moment.');
  }
  scriptLockDepth_++;
  try {
    return fn();
  } finally {
    scriptLockDepth_--;
    lock.releaseLock();
  }
}
