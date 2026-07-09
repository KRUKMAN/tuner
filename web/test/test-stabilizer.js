// Node. Stabilizer gate/median/octave/hysteresis/hold behaviors (Section 6).
// Drives Stabilizer.update(frame, tMs) with synthetic PitchFrames and 16.67 ms steps.

import { suite, assert, assertClose } from './assert.js';
import { Stabilizer } from '../js/dsp/stabilizer.js';
import { CONFIG } from '../js/config.js';

const DT = 1000 / 60; // ≈ 16.67 ms per rAF tick

/** Build a PitchFrame. */
function frame(frequency, clarity, rmsDb) {
  return { frequency, clarity, rmsDb };
}

/** A "silent"/dropout frame: no pitch. rmsDb controls whether the gate is open. */
function dropout(rmsDb) {
  return frame(-1, -1, rmsDb);
}

/** Build a v2 PitchFrame that carries an explicit harmonicity (0..1). */
function hframe(frequency, clarity, rmsDb, harmonicity) {
  return { frequency, clarity, rmsDb, harmonicity };
}

/** Fresh stabilizer in chromatic mode at A4=440. */
function makeStab() {
  return new Stabilizer({ config: CONFIG, a4: 440, tuning: null, lockedString: null });
}

export default function run() {
  suite('stabilizer: silence gate', () => {
    const s = makeStab();
    let t = 0;
    let ds;
    for (let i = 0; i < 6; i++) {
      ds = s.update(dropout(-70), t);
      t += DT;
    }
    assert(ds.status === 'silent', `quiet frames (rmsDb -70) → status 'silent' (got '${ds.status}')`);
    assert(ds.noteName === null, 'silent → noteName blanked (null)');
  });

  suite('stabilizer: loud but unclear never activates', () => {
    const s = makeStab();
    let t = 0;
    // Establish a good reading first.
    for (let i = 0; i < 8; i++) {
      s.update(frame(110, 0.97, -20), t);
      t += DT;
    }
    // Now feed loud, low-clarity frames for well over holdMs (400 ms ≈ 24 ticks).
    let sawActive = false;
    let lastStatus = null;
    for (let i = 0; i < 40; i++) {
      const ds = s.update(frame(110, 0.5, -20), t);
      if (ds.status === 'active') sawActive = true;
      lastStatus = ds.status;
      t += DT;
    }
    assert(!sawActive, "low-clarity (0.5) frames are never 'active'");
    assert(lastStatus === 'rejected', `after > 400 ms of unclear frames → blank ('rejected'), got '${lastStatus}'`);
  });

  suite('stabilizer: steady 110 Hz locks to A2', () => {
    const s = makeStab();
    let t = 0;
    let ds;
    for (let i = 0; i < 15; i++) {
      ds = s.update(frame(110, 0.97, -20), t);
      t += DT;
    }
    assert(ds.status === 'active', `steady clear tone → 'active' (got '${ds.status}')`);
    assert(ds.noteName === 'A', `note name 'A' (got '${ds.noteName}')`);
    assert(ds.octave === 2, `octave 2 (got ${ds.octave})`);
    assert(Math.abs(ds.cents) < 1, `|cents| < 1 after settling (got ${num(ds.cents)})`);
    assert(ds.inTune === true, 'inTune true for a perfectly-tuned A2');
  });

  suite('stabilizer: single octave outlier is absorbed', () => {
    const s = makeStab();
    let t = 0;
    // Prime with steady 110 Hz so history/median is established (needs ≥3 entries).
    for (let i = 0; i < 8; i++) {
      s.update(frame(110, 0.97, -20), t);
      t += DT;
    }
    let prevCents = s.update(frame(110, 0.97, -20), t).cents;
    t += DT;
    let maxJump = 0;
    let maxAbsCents = 0;
    // One 220 Hz (octave-up) outlier, then back to 110.
    const seq = [220, 110, 110, 110, 110, 110];
    for (const f of seq) {
      const ds = s.update(frame(f, 0.97, -20), t);
      maxJump = Math.max(maxJump, Math.abs(ds.cents - prevCents));
      maxAbsCents = Math.max(maxAbsCents, Math.abs(ds.cents));
      assert(ds.noteName === 'A', `outlier frame f=${f}: note stays 'A' (got '${ds.noteName}')`);
      prevCents = ds.cents;
      t += DT;
    }
    assert(maxJump <= 10, `displayed cents never jumps > 10 across the outlier (maxJump=${num(maxJump)})`);
    assert(maxAbsCents < 10, `displayed cents stays near 0 (maxAbs=${num(maxAbsCents)})`);
  });

  suite('stabilizer: A2 → A#2 note hysteresis (no flicker)', () => {
    const s = makeStab();
    let t = 0;
    // Settle on A2.
    for (let i = 0; i < 8; i++) {
      s.update(frame(110, 0.97, -20), t);
      t += DT;
    }
    // Jump to A#2 = 116.54 Hz and hold. Record note per frame.
    const A_sharp = 116.54;
    const notes = [];
    for (let i = 0; i < 14; i++) {
      const ds = s.update(frame(A_sharp, 0.97, -20), t);
      notes.push(ds.noteName);
      t += DT;
    }
    // Must not switch on the very first frames (needs ≥3 consistent frames).
    assert(notes[0] === 'A', "no immediate switch: frame 0 still 'A'");
    assert(notes[1] === 'A', "no immediate switch: frame 1 still 'A'");
    // Eventually switches to A#.
    const switchIdx = notes.findIndex((n) => n === 'A#');
    assert(switchIdx >= 2, `switch happens only after ≥3 frames (switchIdx=${switchIdx})`);
    // No flicker: once A#, stays A#.
    const stable = switchIdx >= 0 && notes.slice(switchIdx).every((n) => n === 'A#');
    assert(stable, 'once switched to A#, never flickers back to A');
    assert(notes[notes.length - 1] === 'A#', 'ends displaying A#');
  });

  suite('stabilizer: hold then blank on dropout', () => {
    const s = makeStab();
    let t = 0;
    for (let i = 0; i < 10; i++) {
      s.update(frame(110, 0.97, -20), t);
      t += DT;
    }
    const tLastGood = t - DT; // timestamp of the last good frame
    // Stop feeding good frames — gate still open (loud) but no pitch → hold, then reject.
    let sawHoldEarly = false;
    let sawRejectLate = false;
    for (let i = 0; i < 40; i++) {
      const ds = s.update(dropout(-20), t);
      const elapsed = t - tLastGood;
      if (elapsed < 380 && ds.status === 'hold') sawHoldEarly = true;
      if (elapsed > 420 && ds.status === 'rejected') sawRejectLate = true;
      t += DT;
    }
    assert(sawHoldEarly, "within 400 ms of last good reading → status 'hold'");
    assert(sawRejectLate, "after 400 ms → blank ('rejected')");
  });

  // ==================================================================
  // v2 stabilizer behavior lock-in (adaptive gate, onset, confidence,
  // harmonicity gate, target-aware octave snap).
  // ==================================================================

  suite('stabilizer(v2): adaptive floor keeps gate shut on quiet noise, opens on a real note', () => {
    const s = makeStab();
    let t = 0;
    let ds;
    // Very quiet broadband frames: floor collapses toward -80, open threshold
    // clamps at -60, and -80 < -60 → gate stays shut → 'silent'.
    for (let i = 0; i < 60; i++) {
      ds = s.update(hframe(-1, -1, -80, 0), t);
      t += DT;
    }
    assert(ds.status === 'silent', `quiet noise (rmsDb -80) → 'silent' (got '${ds.status}')`);
    assert(ds.noiseFloorDb <= -78, `floor tracked down toward the quiet level (got ${num(ds.noiseFloorDb)})`);
    // Now a genuine, loud, clear note. Floor is still low so -40 clears the gate.
    let sawActive = false;
    for (let i = 0; i < 12; i++) {
      ds = s.update(hframe(110, 0.97, -40, 0.98), t);
      if (ds.status === 'active') sawActive = true;
      t += DT;
    }
    assert(sawActive, "steady -40 dB clear note opens the gate and reaches 'active'");
    assert(ds.status === 'active', `ends 'active' (got '${ds.status}')`);
  });

  suite('stabilizer(v2): a sustained clean loud note never drags the floor up', () => {
    const s = makeStab();
    let t = 0;
    let ds;
    for (let i = 0; i < 300; i++) {
      ds = s.update(hframe(110, 0.97, -20, 0.98), t);
      t += DT;
    }
    assert(
      Math.abs(ds.noiseFloorDb - (-70)) <= 0.5,
      `clean high-clarity note leaves floor at its init ≈ -70 (got ${num(ds.noiseFloorDb)})`,
    );
    assert(ds.status === 'active', `note still tracked as 'active' (got '${ds.status}')`);
  });

  suite('stabilizer(v2): broadband hum raises the floor and never locks', () => {
    const s = makeStab();
    let t = 0;
    let ds;
    let everActive = false;
    // ~7 s of loud, low-clarity, pitch-less broadband energy. The floor may only
    // rise on low-clarity frames, and it drifts up slowly (3 dB/s) toward -40.
    for (let i = 0; i < 460; i++) {
      ds = s.update(hframe(-1, 0.3, -40, 0.2), t);
      if (ds.status === 'active') everActive = true;
      t += DT;
    }
    assert(ds.noiseFloorDb > -50, `hum dragged the floor up toward -40 (got ${num(ds.noiseFloorDb)})`);
    assert(!everActive, "pitch-less hum never reaches 'active'");
  });

  suite('stabilizer(v2): dual clarity threshold — strict cold, relaxed once locked', () => {
    // (a) Cold start at clarity 0.72 (< clarityThreshold 0.80) never activates.
    const cold = makeStab();
    let t = 0;
    let sawActiveCold = false;
    for (let i = 0; i < 30; i++) {
      const ds = cold.update(hframe(110, 0.72, -20, 0.95), t);
      if (ds.status === 'active') sawActiveCold = true;
      t += DT;
    }
    assert(!sawActiveCold, "clarity 0.72 from a cold start never reaches 'active' (0.72 < 0.80)");

    // (b) Lock the note with high-clarity frames past sustainLockMs (250 ms),
    // then feed clarity 0.72: still accepted because 0.72 ≥ claritySustain 0.68.
    const s = makeStab();
    t = 0;
    let ds;
    for (let i = 0; i < 20; i++) { // 20 frames ≈ 333 ms > 250 ms → sustain armed
      ds = s.update(hframe(110, 0.97, -20, 0.98), t);
      t += DT;
    }
    assert(ds.status === 'active', `locked 'active' before relaxing (got '${ds.status}')`);
    let sustained = true;
    for (let i = 0; i < 6; i++) {
      ds = s.update(hframe(110, 0.72, -20, 0.98), t);
      if (ds.status !== 'active') sustained = false;
      t += DT;
    }
    assert(sustained, "a locked note stays 'active' at clarity 0.72 (relaxed sustain threshold)");
  });

  suite('stabilizer(v2): onset confirmation needs two consecutive good frames', () => {
    // One good frame then a rejecting frame → never displays.
    const a = makeStab();
    let t = 0;
    let sawActiveA = false;
    let ds = a.update(hframe(110, 0.97, -20, 0.98), t); t += DT;
    if (ds.status === 'active') sawActiveA = true;
    ds = a.update(dropout(-20), t); t += DT; // rejecting frame breaks the streak
    if (ds.status === 'active') sawActiveA = true;
    ds = a.update(hframe(110, 0.97, -20, 0.98), t); t += DT; // fresh streak, still warming
    if (ds.status === 'active') sawActiveA = true;
    assert(!sawActiveA, 'a single good frame (streak broken) never reaches active');

    // Two consecutive good frames → active on the 2nd.
    const b = makeStab();
    t = 0;
    const d0 = b.update(hframe(110, 0.97, -20, 0.98), t); t += DT;
    const d1 = b.update(hframe(110, 0.97, -20, 0.98), t);
    assert(d0.status !== 'active', "first good frame is a warm-up (not 'active')");
    assert(d1.status === 'active', "second consecutive good frame → 'active'");
  });

  suite('stabilizer(v2): confidence decays monotonically through the hold', () => {
    const s = makeStab();
    let t = 0;
    let ds;
    for (let i = 0; i < 12; i++) {
      ds = s.update(hframe(110, 0.97, -20, 0.98), t);
      t += DT;
    }
    assert(ds.status === 'active', `reached 'active' (got '${ds.status}')`);
    assert(ds.confidence > 0, `active confidence > 0 (got ${num(ds.confidence)})`);

    let sawHold = false;
    let monotonic = true;
    let prevConf = Infinity;
    let finalStatus = null;
    let finalConf = null;
    for (let i = 0; i < 40; i++) {
      ds = s.update(dropout(-20), t); // gate open, no pitch → hold then blank
      if (ds.status === 'hold') {
        sawHold = true;
        if (!(ds.confidence < prevConf)) monotonic = false;
        prevConf = ds.confidence;
      }
      finalStatus = ds.status;
      finalConf = ds.confidence;
      t += DT;
    }
    assert(sawHold, "status walked active → 'hold' on dropout");
    assert(monotonic, 'confidence strictly decreases across consecutive hold frames');
    assert(finalStatus === 'rejected', `after holdMs → blank 'rejected' (got '${finalStatus}')`);
    assert(finalConf === 0, `confidence reaches 0 after the hold (got ${num(finalConf)})`);
  });

  suite('stabilizer(v2): harmonicity gate rejects clear-but-inharmonic frames', () => {
    const s = makeStab();
    let t = 0;
    let sawActive = false;
    for (let i = 0; i < 30; i++) {
      const ds = s.update(hframe(110, 0.95, -20, 0.30), t); // clarity fine, harm 0.30 < 0.55
      if (ds.status === 'active') sawActive = true;
      t += DT;
    }
    assert(!sawActive, "harmonicity 0.30 (< harmonicityMin 0.55) never reaches 'active'");
  });

  suite('stabilizer(v2): target-aware octave snap fixes an octave-up detection', () => {
    // Guitar standard. Detector reports D4 (293.66 Hz) — an octave-up error off the
    // open D3 string (the classic weak-fundamental / strong-2nd-harmonic buzz trap).
    // Snap must pull it back down to the real D3 string (midi 50), not display D4.
    //
    // NOTE: an *E2* octave-up error (E3 = 164.81) is deliberately NOT used here — in
    // guitar-standard both E2 (40) and E4 (64) are strings exactly one octave from E3,
    // so f/2 and f*2 are equidistant in cents and the snap is genuinely ambiguous (a
    // float tie-break, not a definable behavior). The real weak-fundamental E2 buzz
    // recovery is locked in end-to-end by test-integration.js instead. D3's octave-up
    // (D4) is not a string, so this snap is unambiguous and robust.
    const s = new Stabilizer({
      config: CONFIG,
      a4: 440,
      tuning: [40, 45, 50, 55, 59, 64],
      lockedString: null,
    });
    let t = 0;
    let ds;
    for (let i = 0; i < 6; i++) {
      ds = s.update(hframe(293.66, 0.95, -20, 0.9), t);
      t += DT;
    }
    assert(ds.status === 'active', `snapped note reaches 'active' (got '${ds.status}')`);
    assert(ds.midi === 50, `octave-snapped down to D3 midi 50, NOT D4 62 (got ${ds.midi})`);
    assert(ds.noteName === 'D', `noteName 'D' (got '${ds.noteName}')`);
    assert(ds.octave === 3, `octave 3, NOT D4 (got ${ds.octave})`);
    assert(ds.stringIndex === 2, `D string index 2 (got ${ds.stringIndex})`);
  });

  suite('stabilizer(v2): legacy fixed-gate path (adaptiveGate:false) still locks', () => {
    const legacyCfg = { ...CONFIG, adaptiveGate: false };
    const s = new Stabilizer({ config: legacyCfg, a4: 440, tuning: null, lockedString: null });
    let t = 0;
    let ds;
    for (let i = 0; i < 15; i++) {
      ds = s.update(hframe(110, 0.97, -20, 0.98), t);
      t += DT;
    }
    assert(ds.status === 'active', `fixed -45/-55 gate still activates (got '${ds.status}')`);
    assert(ds.noteName === 'A' && ds.octave === 2, `note A2 (got ${ds.noteName}${ds.octave})`);
    assert(Math.abs(ds.cents) < 1, `|cents| < 1 (got ${num(ds.cents)})`);
  });

  // ==================================================================
  // lockedString (UI "pin a string" wiring). The Stabilizer has supported
  // this since it was built; only web/js/ui/controls.js + app.js were
  // missing the wiring to call setLockedString(). These prove the DSP
  // side the UI now relies on: a locked string overrides auto-select
  // regardless of what's actually being played, and unlocking restores
  // auto-select.
  // ==================================================================

  suite('stabilizer: lockedString pins the reference regardless of detected pitch', () => {
    const s = new Stabilizer({
      config: CONFIG,
      a4: 440,
      tuning: [40, 45, 50, 55, 59, 64],
      lockedString: 1, // A2 (110 Hz) pinned as the target
    });
    let t = 0;
    let ds;
    // Feed E2 (82.41 Hz — string index 0's own pitch) well past the gate + onset.
    for (let i = 0; i < 20; i++) {
      ds = s.update(hframe(82.41, 0.95, -20, 0.9), t);
      t += DT;
    }
    assert(ds.status === 'active', `locked + steady input → 'active' (got '${ds.status}')`);
    assert(
      ds.stringIndex === 1,
      `stays locked to string index 1 (A2), does NOT auto-select string 0 (got ${ds.stringIndex})`,
    );
    assert(ds.midi === 45, `displayed midi is the locked A2 (45), not E2's 40 (got ${ds.midi})`);
    assertClose(ds.cents, -500, 5, 'cents reflect E2 played against the locked A2 target (~ -500c)');

    // Unlock: the same steady E2 input should now auto-select string 0 (E2)
    // after a few consistent frames (note-switch hysteresis).
    s.setLockedString(null);
    for (let i = 0; i < 10; i++) {
      ds = s.update(hframe(82.41, 0.95, -20, 0.9), t);
      t += DT;
    }
    assert(ds.status === 'active', `still 'active' after unlocking (got '${ds.status}')`);
    assert(ds.stringIndex === 0, `auto-selects string index 0 (E2) once unlocked (got ${ds.stringIndex})`);
    assert(ds.midi === 40, `displayed midi is E2 (40) (got ${ds.midi})`);
    assertClose(ds.cents, 0, 3, 'cents settle near 0 once auto-locked onto the matching string');
  });
}

/** @param {number|null} x @returns {string} */
function num(x) {
  return typeof x === 'number' && Number.isFinite(x) ? x.toFixed(4) : String(x);
}
