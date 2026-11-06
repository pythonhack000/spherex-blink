// On-the-fly science in the browser: photometry, spectra and motion measurement.
import { mjdToYear, positionAt, skyToPixel, stackFrames, visitsOf } from './stack.js';

const APERTURE_ARCSEC = 7;
const ANNULUS_ARCSEC = [24, 42];
const NATIVE_PIXEL_ARCSEC = 6.15;
const MIN_ANNULUS_PIXELS = 5;
const MJY_SR_TO_UJY_PER_SR = 1e12;
const DEG = Math.PI / 180;
const CENTROID_RADIUS_PX = 6;
const CENTROID_ITERATIONS = 10;
const CENTROID_CONVERGED_PX = 0.01;
const CROP_HALF_WIDTH_PX = 24;
const BOOTSTRAP_ROUNDS = 12;
const MIN_SIGMA_ARCSEC = 0.05;
const FALLBACK_SIGMA_ARCSEC = 1;
const EDGE_MARGIN_PX = 8;
const TARGET_EXCLUSION_PX = 15;
const PEAK_HALF_WINDOW_PX = 3;
const PEAK_SIGMA = 5;
const MAD_TO_SIGMA = 1.4826;
const MAX_CONTROL_STARS = 4;

const sortedMedian = (values) => {
  const sorted = Float32Array.from(values).sort();
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** Annulus-subtracted flux in uJy, its noise and a contamination flag; null if unmeasurable. */
export function apertureFlux(frame, grid, x, y) {
  if (!(x >= 0 && x < grid.n && y >= 0 && y < grid.n)) return null;
  const arcsecPerPixel = grid.scale * 3600;
  const apertureRadius = Math.max(APERTURE_ARCSEC, arcsecPerPixel * 1.5);
  const reach = Math.ceil(ANNULUS_ARCSEC[1] / arcsecPerPixel);
  const inside = [];
  const ring = [];
  let flagged = false;
  for (let row = Math.max(0, Math.floor(y) - reach); row <= Math.min(grid.n - 1, Math.ceil(y) + reach); row += 1) {
    for (let col = Math.max(0, Math.floor(x) - reach); col <= Math.min(grid.n - 1, Math.ceil(x) + reach); col += 1) {
      const value = frame.pixels[row * grid.n + col];
      if (Number.isNaN(value)) continue;
      const distance = Math.hypot(col - x, row - y) * arcsecPerPixel;
      const bad = frame.mask?.[row * grid.n + col];
      if (distance <= apertureRadius) {
        inside.push(value);
        flagged ||= Boolean(bad);
      } else if (distance >= ANNULUS_ARCSEC[0] && distance <= ANNULUS_ARCSEC[1] && !bad) {
        ring.push(value);
      }
    }
  }
  if (ring.length < MIN_ANNULUS_PIXELS || !inside.length) return null;
  const sky = sortedMedian(ring);
  const toMicroJansky = (grid.scale * DEG) ** 2 * MJY_SR_TO_UJY_PER_SR;
  const flux = inside.reduce((sum, value) => sum + value - sky, 0) * toMicroJansky;
  const mean = ring.reduce((sum, value) => sum + value, 0) / ring.length;
  const spread = Math.sqrt(ring.reduce((sum, value) => sum + (value - mean) ** 2, 0) / ring.length);
  // Plate pixels oversample the detector, so the noise counts independent native pixels.
  const independent = Math.max(1, inside.length * (arcsecPerPixel / NATIVE_PIXEL_ARCSEC) ** 2);
  const nativeSr = ((NATIVE_PIXEL_ARCSEC / 3600) * DEG) ** 2;
  return { flux, error: spread * Math.sqrt(independent) * nativeSr * MJY_SR_TO_UJY_PER_SR, flagged };
}

export function wavelengthOnPlate(frame, grid, x, y) {
  const centre = (grid.n - 1) / 2;
  return frame.wavelength + frame.waveDx * (x - centre) + frame.waveDy * (y - centre);
}

/** Photometry of one object in every exposure, following its motion, ordered by wavelength. */
export function measureSpectrum(frames, grid, object) {
  const points = [];
  for (const frame of frames) {
    const { ra, dec } = positionAt(object, mjdToYear(frame.mjd));
    const { x, y } = skyToPixel(ra, dec, grid);
    const measured = apertureFlux(frame, grid, x, y);
    if (measured) {
      points.push({
        ...measured,
        wavelength: wavelengthOnPlate(frame, grid, x, y),
        detector: frame.detector,
        mjd: frame.mjd,
        visit: frame.visit,
      });
    }
  }
  return points.sort((first, second) => first.wavelength - second.wavelength);
}

/** Gaussian-weighted centroid in a square image, iterated from a starting guess. */
export function centroid(image, size, x0, y0, radius) {
  let x = x0;
  let y = y0;
  for (let iteration = 0; iteration < CENTROID_ITERATIONS; iteration += 1) {
    const step = centroidStep(image, size, x, y, radius);
    if (!step) return null;
    const moved = Math.hypot(step.x - x, step.y - y);
    x = step.x;
    y = step.y;
    if (moved < CENTROID_CONVERGED_PX) break;
  }
  return { x, y };
}

function centroidStep(image, size, x, y, radius) {
  const samples = [];
  const reach = Math.ceil(radius);
  for (let row = Math.max(0, Math.floor(y) - reach); row <= Math.min(size - 1, Math.ceil(y) + reach); row += 1) {
    for (let col = Math.max(0, Math.floor(x) - reach); col <= Math.min(size - 1, Math.ceil(x) + reach); col += 1) {
      const value = image[row * size + col];
      const distanceSq = (col - x) ** 2 + (row - y) ** 2;
      if (!Number.isNaN(value) && distanceSq <= radius ** 2) samples.push({ col, row, value, distanceSq });
    }
  }
  if (!samples.length) return null;
  const level = sortedMedian(samples.map((sample) => sample.value));
  let total = 0;
  let sumX = 0;
  let sumY = 0;
  for (const { col, row, value, distanceSq } of samples) {
    const weight = Math.max(0, value - level) * Math.exp(-distanceSq / (2 * (radius / 2) ** 2));
    total += weight;
    sumX += col * weight;
    sumY += row * weight;
  }
  return total > 0 ? { x: sumX / total, y: sumY / total } : null;
}

function fitAxis(years, values, weights) {
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  const meanYear = years.reduce((sum, year, index) => sum + weights[index] * year, 0) / weightSum;
  let spread = 0;
  let slope = 0;
  years.forEach((year, index) => {
    spread += weights[index] * (year - meanYear) ** 2;
    slope += weights[index] * (year - meanYear) * values[index];
  });
  return { slope: slope / spread, error: Math.sqrt(1 / spread) };
}

/** Weighted straight-line fit of offsets (arcsec) against time (years). */
export function fitProperMotion(track) {
  if (new Set(track.map((point) => point.year)).size < 2) {
    throw new Error('Motion needs at least two different dates');
  }
  const years = track.map((point) => point.year);
  const weights = track.map((point) => 1 / point.sigma ** 2);
  const east = fitAxis(years, track.map((point) => point.east), weights);
  const north = fitAxis(years, track.map((point) => point.north), weights);
  const total = Math.hypot(east.slope, north.slope);
  const totalErr = total > 0
    ? Math.hypot(east.slope * east.error, north.slope * north.error) / total
    : Math.hypot(east.error, north.error);
  return { pmEast: east.slope, pmNorth: north.slope, total, totalErr };
}

/** Brightest clear peaks away from the target, used to check the method's zero point. */
export function findControlStars(image, size, target, count = MAX_CONTROL_STARS) {
  const finite = image.filter((value) => !Number.isNaN(value));
  const level = sortedMedian(finite);
  const noise = MAD_TO_SIGMA * sortedMedian(finite.map((value) => Math.abs(value - level)));
  const threshold = level + PEAK_SIGMA * noise;
  const peaks = [];
  for (let y = EDGE_MARGIN_PX; y < size - EDGE_MARGIN_PX; y += 1) {
    for (let x = EDGE_MARGIN_PX; x < size - EDGE_MARGIN_PX; x += 1) {
      const value = image[y * size + x];
      if (value > threshold && Math.hypot(x - target.x, y - target.y) > TARGET_EXCLUSION_PX && isPeak(image, size, x, y)) {
        peaks.push({ x, y, value });
      }
    }
  }
  return peaks.sort((first, second) => second.value - first.value).slice(0, count);
}

function isPeak(image, size, x, y) {
  const value = image[y * size + x];
  for (let dy = -PEAK_HALF_WINDOW_PX; dy <= PEAK_HALF_WINDOW_PX; dy += 1) {
    for (let dx = -PEAK_HALF_WINDOW_PX; dx <= PEAK_HALF_WINDOW_PX; dx += 1) {
      if (image[(y + dy) * size + x + dx] > value) return false;
    }
  }
  return true;
}

function crop(frames, size, centreX, centreY) {
  const left = Math.max(0, Math.floor(centreX) - CROP_HALF_WIDTH_PX);
  const bottom = Math.max(0, Math.floor(centreY) - CROP_HALF_WIDTH_PX);
  const side = Math.min(CROP_HALF_WIDTH_PX * 2, size - left, size - bottom);
  const cropped = frames.map((frame) => {
    const pixels = new Float32Array(side * side);
    for (let row = 0; row < side; row += 1) {
      pixels.set(frame.pixels.subarray((bottom + row) * size + left, (bottom + row) * size + left + side), row * side);
    }
    return { pixels };
  });
  return { cropped, side, left, bottom };
}

/** Centroid of a median stack, with an error from resampling the frames. */
function locate(frames, size, guess) {
  const { cropped, side, left, bottom } = crop(frames, size, guess.x, guess.y);
  const find = (subset) =>
    centroid(stackFrames(subset, side), side, guess.x - left, guess.y - bottom, CENTROID_RADIUS_PX);
  const found = find(cropped);
  if (!found) return null;
  let seed = frames.length * 7919 + 17;
  const draw = () => {
    seed = (seed * 48271) % 2147483647;
    return seed % cropped.length;
  };
  const draws = [];
  for (let round = 0; round < BOOTSTRAP_ROUNDS && cropped.length > 1; round += 1) {
    const sample = find(Array.from(cropped, () => cropped[draw()]));
    if (sample) draws.push(sample);
  }
  return { x: found.x + left, y: found.y + bottom, sigmaPx: draws.length > 1 ? spreadOf(draws) : null };
}

function spreadOf(points) {
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const variance = points.reduce((sum, point) => sum + (point.x - meanX) ** 2 + (point.y - meanY) ** 2, 0);
  return Math.sqrt(variance / points.length);
}

function track(visits, grid, object) {
  const scale = grid.scale * 3600;
  const moving = Boolean(object.pmra || object.pmdec);
  const points = [];
  let start = null;
  let guess = null;
  for (const visit of visits) {
    if (moving || !guess) {
      const { ra, dec } = positionAt(object, mjdToYear(visit.mjd));
      guess = skyToPixel(ra, dec, grid);
    }
    const located = locate(visit.frames, grid.n, guess);
    if (located) {
      start ??= located;
      guess = located;
      points.push({
        year: mjdToYear(visit.mjd),
        x: located.x,
        y: located.y,
        east: -(located.x - start.x) * scale,
        north: (located.y - start.y) * scale,
        sigma: Math.max(located.sigmaPx === null ? FALLBACK_SIGMA_ARCSEC : located.sigmaPx * scale, MIN_SIGMA_ARCSEC),
        frames: visit.frames.length,
      });
    }
  }
  return points;
}

/** Tracks an object between visits and repeats the measurement on nearby field stars. */
export function measureMotion(frames, grid, object, detectors) {
  const chosen = frames.filter((frame) => detectors.includes(frame.detector));
  const visits = visitsOf(chosen);
  if (visits.length < 2) throw new Error('Motion needs frames from at least two dates in these bands');
  const tracked = track(visits, grid, object);
  if (tracked.length < 2) throw new Error('The source could not be located on at least two dates');
  const midYear = mjdToYear(visits[visits.length >> 1].mjd);
  const { ra, dec } = positionAt(object, midYear);
  const deep = stackFrames(chosen, grid.n);
  const controls = findControlStars(deep, grid.n, skyToPixel(ra, dec, grid))
    .map((star) => track(visits, grid, starObject(star, grid)))
    .filter((points) => points.length >= 2)
    .map(fitProperMotion);
  const catalog = Math.hypot(object.pmra ?? 0, object.pmdec ?? 0) / 1000;
  return {
    visits: tracked,
    fit: fitProperMotion(tracked),
    catalog: catalog > 0 ? catalog : null,
    controlMedian: controls.length ? sortedMedian(controls.map((item) => item.total)) : null,
    detectors,
  };
}

function starObject(star, grid) {
  const centre = (grid.n - 1) / 2;
  const cosDec = Math.max(Math.cos(grid.dec * DEG), 1e-6);
  return {
    ra: grid.ra + ((centre - star.x) * grid.scale) / cosDec,
    dec: grid.dec + (star.y - centre) * grid.scale,
    pmra: 0,
    pmdec: 0,
    epoch: 2016,
  };
}
