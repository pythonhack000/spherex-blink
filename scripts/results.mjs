// Measures every challenge target with the same code the site runs, for the results table.
// Usage: node scripts/results.mjs [data-directory]
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { measureMotion, wingBrightness } from '../static/js/science.js';
import { decodeStaticFrames } from '../static/js/stack.js';

const DATA = process.argv[2] ?? 'static/data';
const TARGETS = JSON.parse(readFileSync(join(DATA, 'targets.json'), 'utf8'));
const MOTION_ARRAYS = { wise0855: [5, 6] };
const ALL_ARRAYS = [1, 2, 3, 4, 5, 6];
// The long-wavelength array with the best date coverage for each variable star.
const WING_ARRAYS = { rwaur: 5, rdra: 4 };

const results = TARGETS.map((target) => {
  const folder = join(DATA, target.key);
  const meta = JSON.parse(readFileSync(join(folder, 'meta.json'), 'utf8'));
  const raw = gunzipSync(readFileSync(join(folder, 'frames.bin.gz')));
  const buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  const frames = decodeStaticFrames(buffer, meta);
  const motion = measureMotion(frames, meta.grid, target, MOTION_ARRAYS[target.key] ?? ALL_ARRAYS);
  return {
    key: target.key,
    thumbs: meta.thumbs,
    frames: frames.length,
    available: meta.available,
    dates: motion.visits.length,
    measured: motion.fit.total,
    error: motion.fit.totalErr,
    catalog: motion.catalog,
    control: motion.controlMedian,
    variability: WING_ARRAYS[target.key] ? wingBrightness(frames, meta.grid, target, WING_ARRAYS[target.key]) : null,
  };
});
writeFileSync(join(DATA, 'results.json'), JSON.stringify(results));
console.log(JSON.stringify(results, null, 1));
