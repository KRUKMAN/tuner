// BROWSER (Node-safe): thin JSON wrapper over localStorage. Every access is
// guarded so it silently no-ops where storage is missing or blocked (private
// mode, Node tests). One key per concern; values are JSON-encoded.

/** @returns {Storage|null} the localStorage backend, or null if unavailable. */
function backend() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

/**
 * @template T
 * @param {string} key
 * @param {T} [fallback=null]
 * @returns {T} parsed value, or fallback if absent/blocked/corrupt.
 */
export function get(key, fallback = null) {
  const b = backend();
  if (!b) return fallback;
  try {
    const raw = b.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * @param {string} key
 * @param {*} value  JSON-serializable value
 * @returns {boolean} true if persisted.
 */
export function set(key, value) {
  const b = backend();
  if (!b) return false;
  try {
    b.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} key
 * @returns {boolean} true if removed.
 */
export function remove(key) {
  const b = backend();
  if (!b) return false;
  try {
    b.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
