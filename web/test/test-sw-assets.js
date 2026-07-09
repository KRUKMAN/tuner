// Node. Guards web/sw.js CORE_ASSETS against the actual shipped file tree so a
// newly added module/asset/font can't silently be left out of the offline
// precache. Reads sw.js as text (it references `self`, so it can't be imported).
import { suite, assert } from './assert.js';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep, extname } from 'node:path';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..'); // web/
// Extensions that ship to the browser at runtime. IMPORTANT: extend this set when
// a new shipped asset type is introduced, or that asset silently escapes the guard.
const RUNTIME_EXT = new Set(['.html', '.css', '.js', '.webmanifest', '.woff2', '.png', '.svg', '.ico', '.json']);
const EXCLUDE_DIRS = new Set(['test']);
// package.json is tooling config, not a shipped runtime asset.
const EXCLUDE_FILES = new Set(['sw.js', 'package.json']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!EXCLUDE_DIRS.has(name)) walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

function toRel(full) {
  return './' + relative(WEB, full).split(sep).join('/');
}

export function extractCoreAssets(swText) {
  const m = swText.match(/CORE_ASSETS\s*=\s*\[([\s\S]*?)\]/);
  if (!m) return null;
  // Strip comments first: a commented-out entry is NOT precached at runtime,
  // so counting it as "listed" would let the guard pass on a real regression.
  const body = m[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const items = body.match(/['"]([^'"]+)['"]/g) || [];
  return items.map((s) => s.slice(1, -1));
}

/** Registers and runs the service-worker asset-list guard suite. */
export default function run() {
  suite('sw: extractCoreAssets ignores commented-out entries', () => {
    const lineCommented = [
      "const CORE_ASSETS = [",
      "  './',",
      "  './index.html',",
      "  // './js/app.js',",
      "  './css/styles.css',",
      "];",
    ].join('\n');
    assert(
      extractCoreAssets(lineCommented).join(',') === "./,./index.html,./css/styles.css",
      'line-commented entry is not counted as listed',
    );

    const blockCommented = "const CORE_ASSETS = [\n  './a.js', /* './b.js', */ './c.js',\n];";
    assert(
      extractCoreAssets(blockCommented).join(',') === './a.js,./c.js',
      'block-commented entry is not counted as listed',
    );

    assert(extractCoreAssets('no array here') === null, 'returns null when CORE_ASSETS is absent');
  });

  suite('sw: CORE_ASSETS covers every shipped runtime asset', () => {
    const swText = readFileSync(join(WEB, 'sw.js'), 'utf8');
    const listed = extractCoreAssets(swText);
    assert(Array.isArray(listed) && listed.length > 0, 'CORE_ASSETS array parsed from sw.js');
    const listedSet = new Set(listed || []);

    const shipped = walk(WEB)
      .filter((f) => RUNTIME_EXT.has(extname(f).toLowerCase()))
      .filter((f) => !EXCLUDE_FILES.has(relative(WEB, f).split(sep).join('/')))
      .map(toRel);

    const missing = shipped.filter((rel) => !listedSet.has(rel));
    assert(missing.length === 0, `every shipped asset is precached (missing: ${missing.join(', ') || 'none'})`);
  });

  suite('sw: every listed asset exists on disk', () => {
    const swText = readFileSync(join(WEB, 'sw.js'), 'utf8');
    const listed = extractCoreAssets(swText) || [];
    const ghosts = listed
      .filter((p) => p !== './')
      .filter((p) => !existsSync(join(WEB, p.replace(/^\.\//, ''))));
    assert(ghosts.length === 0, `no CORE_ASSETS entries point at missing files (ghosts: ${ghosts.join(', ') || 'none'})`);
  });
}
