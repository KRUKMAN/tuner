// PURE. Tiny assertion + suite reporter helpers. No npm deps, no browser APIs.
// Counts are tracked at module scope; run-all.js calls report() once at the end.

let passCount = 0;
let failCount = 0;
/** @type {string[]} */
const failureLabels = [];
let currentSuite = null;

/**
 * Core assertion. Never throws — records pass/fail and prints a per-case line so
 * a single failure does not abort the surrounding suite.
 * @param {boolean} cond
 * @param {string} label
 * @returns {boolean} whether the assertion passed
 */
export function assert(cond, label) {
  const ok = !!cond;
  if (ok) {
    passCount++;
    console.log(`  PASS  ${label}`);
  } else {
    failCount++;
    const full = currentSuite ? `[${currentSuite}] ${label}` : label;
    failureLabels.push(full);
    console.log(`  FAIL  ${label}`);
  }
  return ok;
}

/**
 * Assert two numbers are within an absolute tolerance.
 * @param {number} actual
 * @param {number} expected
 * @param {number} tol
 * @param {string} label
 * @returns {boolean}
 */
export function assertClose(actual, expected, tol, label) {
  const ok = Math.abs(actual - expected) <= tol;
  return assert(
    ok,
    `${label}  (actual=${fmt(actual)}, expected=${fmt(expected)}, tol=${fmt(tol)}, |Δ|=${fmt(Math.abs(actual - expected))})`,
  );
}

/**
 * Assert two frequencies are within a cents tolerance.
 * cents = 1200 * log2(fActual / fExpected).
 * @param {number} fActual
 * @param {number} fExpected
 * @param {number} centsTol
 * @param {string} label
 * @returns {boolean}
 */
export function assertCentsClose(fActual, fExpected, centsTol, label) {
  const cents = 1200 * Math.log2(fActual / fExpected);
  const ok = Math.abs(cents) <= centsTol;
  return assert(
    ok,
    `${label}  (fActual=${fmt(fActual)}Hz, fExpected=${fmt(fExpected)}Hz, Δcents=${fmt(cents)}, tol=${centsTol})`,
  );
}

/**
 * Group a set of assertions under a named heading. Catches thrown errors
 * (e.g. a source module ctor blowing up) and records them as a failure.
 * @param {string} name
 * @param {() => void} fn
 */
export function suite(name, fn) {
  const prev = currentSuite;
  currentSuite = name;
  console.log(`\n=== ${name} ===`);
  try {
    fn();
  } catch (err) {
    failCount++;
    const msg = err && err.message ? err.message : String(err);
    failureLabels.push(`[${name}] THREW: ${msg}`);
    console.log(`  FAIL  ${name} threw: ${msg}`);
    if (err && err.stack) console.log(err.stack);
  } finally {
    currentSuite = prev;
  }
}

/**
 * Print a summary. Returns true if everything passed (used to set exit code).
 * @returns {boolean}
 */
export function report() {
  console.log('\n──────── SUMMARY ────────');
  console.log(`Passed: ${passCount}   Failed: ${failCount}   Total: ${passCount + failCount}`);
  if (failCount > 0) {
    console.log('\nFailures:');
    for (const l of failureLabels) console.log(`  - ${l}`);
  }
  console.log(failCount === 0 ? '\nALL TESTS PASSED' : `\n${failCount} TEST(S) FAILED`);
  return failCount === 0;
}

/** Reset module-level counts (mainly for isolated re-runs). */
export function resetCounts() {
  passCount = 0;
  failCount = 0;
  failureLabels.length = 0;
  currentSuite = null;
}

/** @param {number} x @returns {string} compact number formatting */
function fmt(x) {
  if (!Number.isFinite(x)) return String(x);
  const r = Math.round(x);
  return Math.abs(x - r) < 1e-9 ? String(r) : x.toFixed(4);
}
