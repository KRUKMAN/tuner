// Node entry point: `node web/test/run-all.js`
// Imports every suite runner, executes them, prints a summary, exits 1 on failure.

import { report } from './assert.js';
import runTheory from './test-theory.js';
import runFilters from './test-filters.js';
import runStabilizer from './test-stabilizer.js';
import runPitch from './test-pitch.js';
import runIntegration from './test-integration.js';
import runTrail from './test-trail.js';

runTheory();
runFilters();
runStabilizer();
runPitch();
runIntegration();
runTrail();

const ok = report();
process.exit(ok ? 0 : 1);
