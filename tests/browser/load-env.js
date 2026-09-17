/**
 * Load repo-root .env into process.env (no dotenv package required).
 * @param {string} repoRoot Absolute path to repository root
 */
function loadRepoEnv(repoRoot) {
  const fs = require('fs');
  const path = require('path');
  const envPath = path.join(repoRoot, '.env');
  if (!fs.existsSync(envPath)) {
    return { path: envPath, loaded: false, keys: [] };
  }
  let raw = fs.readFileSync(envPath, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  const keys = [];
  raw.split(/\r?\n/).forEach(function (line) {
    line = line.trim();
    if (!line || line.charAt(0) === '#') return;
    var eq = line.indexOf('=');
    if (eq <= 0) return;
    var key = line.slice(0, eq).trim();
    var val = line.slice(eq + 1).trim();
    if (
      (val.charAt(0) === '"' && val.charAt(val.length - 1) === '"') ||
      (val.charAt(0) === "'" && val.charAt(val.length - 1) === "'")
    ) {
      val = val.slice(1, -1);
    }
    if (!Object.prototype.hasOwnProperty.call(process.env, key) || !process.env[key]) {
      process.env[key] = val;
    }
    keys.push(key);
  });
  return { path: envPath, loaded: true, keys: keys };
}

module.exports = { loadRepoEnv };
