// Node entry point: `node web/test/run-all.js`
// Imports every suite runner, executes them, prints a summary, exits 1 on failure.

import { report } from './assert.js';
import runTheory from './test-theory.js';
import runFilters from './test-filters.js';
import runStabilizer from './test-stabilizer.js';
import runPitch from './test-pitch.js';
import runIntegration from './test-integration.js';
import runTrail from './test-trail.js';
import runStore from './test-store.js';
import runSwAssets from './test-sw-assets.js';
import runInstruments from './test-instruments.js';
import runStrobe from './test-strobe.js';
import runConfig from './test-config.js';
import runMeter from './test-meter.js';
import runMetronome from './test-metronome.js';
import runNoteStatus from './test-note-status.js';

runTheory();
runFilters();
runStabilizer();
runPitch();
runIntegration();
runTrail();
runStore();
runSwAssets();
runInstruments();
runStrobe();
runConfig();
runMeter();
runMetronome();
runNoteStatus();

const ok = report();
process.exit(ok ? 0 : 1);
