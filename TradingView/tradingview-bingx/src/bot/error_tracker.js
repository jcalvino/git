// ─────────────────────────────────────────────────────────────────
//  Error Tracker
//  In-memory circular buffer of bot errors — surfaced on dashboard.
//  Each module calls logError() to push an event; the API serves
//  the list via GET /api/errors so the dashboard can show a banner.
// ─────────────────────────────────────────────────────────────────

const MAX_ERRORS = 50;
const _errors = [];
let _seq = 1;

/**
 * @param {"error"|"warning"|"info"} level
 * @param {string} source  — e.g. "SCANNER", "EXECUTOR", "MONITOR"
 * @param {string} message
 * @param {object} [details]
 */
export function logError(level = "error", source, message, details = {}) {
  _errors.push({
    id:        _seq++,
    level,
    source,
    message,
    details,
    timestamp: new Date().toISOString(),
    dismissed: false,
  });
  if (_errors.length > MAX_ERRORS) _errors.shift();
}

/** Convenience wrappers */
export const logWarn  = (source, msg, d) => logError("warning", source, msg, d);
export const logInfo  = (source, msg, d) => logError("info",    source, msg, d);

/** Returns most recent errors, newest first */
export function getRecentErrors(limit = 20) {
  return _errors.slice(-limit).reverse();
}

/** Returns true when any non-dismissed 'error' level entry exists */
export function hasActiveErrors() {
  return _errors.some((e) => e.level === "error" && !e.dismissed);
}

/** Mark all current errors as dismissed */
export function dismissErrors() {
  for (const e of _errors) e.dismissed = true;
}
