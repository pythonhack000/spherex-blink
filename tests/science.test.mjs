import test from 'node:test';
import assert from 'node:assert/strict';
import {
  apertureFlux, centroid, findControlStars, fitProperMotion, measureMotion, measureSpectrum, wavelengthOnPlate,
} from '../static/js/science.js';
import { skyToPixel } from '../static/js/stack.js';

const near = (actual, expected, tolerance) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not near ${expected}`);

const GRID = { ra: 10, dec: 0, n: 60, scale: 0.05 / 60 };

function gaussianImage(size, sources) {
  const image = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      for (const { x: sx, y: sy, peak = 100, sigma = 2.5 } of sources) {
        image[y * size + x] += peak * Math.exp(-((x - sx) ** 2 + (y - sy) ** 2) / (2 * sigma ** 2));
      }
    }
  }
  return image;
}

test('aperture flux sums the source above the local background', () => {
  const pixels = new Float32Array(3600).fill(2);
  pixels[30 * 60 + 30] = 12;
  const result = apertureFlux({ pixels, mask: new Uint8Array(3600) }, GRID, 30, 30);
  const pixelSr = (GRID.scale * Math.PI / 180) ** 2;
  near(result.flux, 10 * pixelSr * 1e12, 0.05 * 10 * pixelSr * 1e12);
  assert.equal(result.flagged, false);
});

test('aperture reports flagged pixels inside it', () => {
  const mask = new Uint8Array(3600);
  mask[30 * 60 + 31] = 1;
  const result = apertureFlux({ pixels: new Float32Array(3600), mask }, GRID, 30, 30);
  assert.equal(result.flagged, true);
});

test('aperture gives no result off the plate or without data', () => {
  const frame = { pixels: new Float32Array(3600).fill(NaN), mask: new Uint8Array(3600) };
  assert.equal(apertureFlux(frame, GRID, 500, 30), null);
  assert.equal(apertureFlux(frame, GRID, 30, 30), null);
});

test('wavelength varies linearly across the plate', () => {
  const frame = { wavelength: 2, waveDx: 0.01, waveDy: -0.02 };
  near(wavelengthOnPlate(frame, GRID, 39.5, 19.5), 2.3, 1e-9);
});

test('spectrum is ordered by wavelength and skips frames with no data', () => {
  const pixels = new Float32Array(3600).fill(1);
  const make = (wavelength, data = pixels) => ({
    pixels: data, mask: new Uint8Array(3600), wavelength, waveDx: 0, waveDy: 0, detector: 1, mjd: 61000, visit: 0,
  });
  const points = measureSpectrum(
    [make(3), make(1), make(2, new Float32Array(3600).fill(NaN))],
    GRID,
    { ra: 10, dec: 0, pmra: 0, pmdec: 0, epoch: 2016 },
  );
  assert.deepEqual(points.map((point) => point.wavelength), [1, 3]);
});

test('centroid recovers a subpixel position', () => {
  const found = centroid(gaussianImage(41, [{ x: 20.3, y: 18.7 }]), 41, 19, 20, 6);
  near(found.x, 20.3, 0.05);
  near(found.y, 18.7, 0.05);
});

test('centroid returns null for an empty window', () => {
  assert.equal(centroid(new Float32Array(1681).fill(NaN), 41, 20, 20, 6), null);
});

test('fit recovers a known motion', () => {
  const track = [2025.4, 2025.9, 2026.4].map((year) => ({
    year, east: 4 * (year - 2025.4), north: -8 * (year - 2025.4), sigma: 0.1,
  }));
  const fit = fitProperMotion(track);
  near(fit.pmEast, 4, 1e-6);
  near(fit.pmNorth, -8, 1e-6);
  near(fit.total, Math.hypot(4, 8), 1e-6);
  assert.ok(fit.totalErr > 0);
});

test('fit needs two different dates', () => {
  assert.throws(() => fitProperMotion([{ year: 2025, east: 0, north: 0, sigma: 1 }]));
});

test('control stars exclude the target', () => {
  const image = gaussianImage(81, [{ x: 40, y: 40, peak: 500 }, { x: 15, y: 60, peak: 100 }]);
  const [star] = findControlStars(image, 81, { x: 40, y: 40 }, 1);
  near(star.x, 15, 1);
  near(star.y, 60, 1);
});

test('measured motion matches an injected mover while a field star stays still', () => {
  const grid = { ra: 10, dec: 0, n: 120, scale: 0.1 / 120 };
  const object = { ra: 10, dec: 0, pmra: -9000, pmdec: 0, epoch: 2026 };
  const mjds = [60800, 61000, 61200];
  const frames = mjds.flatMap((mjd, visit) => {
    const year = 2000 + (mjd - 51544.5) / 365.25;
    const offsetDeg = (-9 * (year - 2026)) / 3600;
    const { x, y } = skyToPixel(10 + offsetDeg, 0, grid);
    const pixels = gaussianImage(120, [{ x, y, peak: 50 }, { x: 25, y: 90, peak: 200 }, { x: 95, y: 25, peak: 200 }]);
    return [0, 1, 2].map(() => ({ pixels, detector: 6, mjd, visit }));
  });
  const result = measureMotion(frames, grid, object, [6]);
  near(result.fit.total, 9, 0.5);
  assert.ok(result.fit.pmEast < 0, 'moves west');
  near(result.catalog, 9, 1e-9);
  assert.ok(result.controlMedian < 0.3, `field stars moved ${result.controlMedian}`);
});
