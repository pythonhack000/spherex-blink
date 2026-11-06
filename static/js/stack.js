// Pure image and geometry maths. No DOM, so it can be unit-tested under Node.

export const WAVE_MIN = 0.75;
export const WAVE_MAX = 5.0;
export const CHANNELS = 102;
export const CHANNELS_PER_DETECTOR = 17;
const ASINH_SOFTENING = 12;
const LOW_PERCENTILE = 0.6;
const HIGH_PERCENTILE = 0.998;
const DEG = Math.PI / 180;
const NAN_CODE = -32768;
const MIN_COVERED_SHARE = 0.92;
const COVERAGE_STRIDE = 7;
const SHARPEN_RADIUS = 2;
const SHARPEN_AMOUNT = 1.1;

export const DETECTOR_RANGES = {
  1: [0.75, 1.09],
  2: [1.1, 1.62],
  3: [1.63, 2.41],
  4: [2.42, 3.82],
  5: [3.83, 4.41],
  6: [4.42, 5.0],
};

/** Composite colour channels: long wavelengths red, short ones blue. */
export const COMPOSITE = { red: [5, 6], green: [3, 4], blue: [1, 2] };

export function detectorOfChannel(channel) {
  return Math.floor(channel / CHANNELS_PER_DETECTOR) + 1;
}

export function channelWavelength(channel) {
  const detector = detectorOfChannel(channel);
  const [low, high] = DETECTOR_RANGES[detector];
  const position = (channel % CHANNELS_PER_DETECTOR + 0.5) / CHANNELS_PER_DETECTOR;
  return low * Math.pow(high / low, position);
}

/** False-colour ramp for a wavelength: violet at 0.75 um through red at 5 um. */
export function wavelengthColor(wavelength) {
  const span = Math.log(WAVE_MAX / WAVE_MIN);
  const position = Math.min(1, Math.max(0, Math.log(wavelength / WAVE_MIN) / span));
  const stops = [
    [132, 112, 255],
    [70, 170, 255],
    [70, 225, 190],
    [205, 235, 90],
    [255, 170, 60],
    [255, 85, 70],
  ];
  const scaled = position * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  return stops[index].map((value, part) => Math.round(value + (stops[index + 1][part] - value) * mix));
}

function median(values, count) {
  const sorted = values.slice(0, count).sort();
  const middle = count >> 1;
  return count % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Per-pixel median of frames; NaN pixels and, optionally, flagged pixels are skipped. */
export function stackFrames(frames, size, excludeFlagged = false) {
  const area = size * size;
  const result = new Float32Array(area).fill(NaN);
  const scratch = new Float32Array(frames.length);
  for (let pixel = 0; pixel < area; pixel += 1) {
    let count = 0;
    for (const frame of frames) {
      const value = frame.pixels[pixel];
      if (Number.isNaN(value) || (excludeFlagged && frame.mask && frame.mask[pixel])) continue;
      scratch[count] = value;
      count += 1;
    }
    if (count) result[pixel] = median(scratch, count);
  }
  return result;
}

/**
 * Unsharp mask for display. It steepens star edges so the eye resolves them better;
 * every measurement keeps using the unmodified pixels.
 */
export function sharpenForDisplay(image, size, amount = SHARPEN_AMOUNT) {
  const result = new Float32Array(image);
  for (let y = SHARPEN_RADIUS; y < size - SHARPEN_RADIUS; y += 1) {
    for (let x = SHARPEN_RADIUS; x < size - SHARPEN_RADIUS; x += 1) {
      const centre = image[y * size + x];
      if (Number.isNaN(centre)) continue;
      let sum = 0;
      let count = 0;
      for (let dy = -SHARPEN_RADIUS; dy <= SHARPEN_RADIUS; dy += 1) {
        for (let dx = -SHARPEN_RADIUS; dx <= SHARPEN_RADIUS; dx += 1) {
          const value = image[(y + dy) * size + x + dx];
          if (!Number.isNaN(value)) {
            sum += value;
            count += 1;
          }
        }
      }
      // Only peaks are lifted: subtracting here would draw dark rings around bright stars.
      result[y * size + x] = centre + amount * Math.max(0, centre - sum / count);
    }
  }
  return result;
}

export function subtract(later, earlier) {
  return later.map((value, index) => value - earlier[index]);
}

/** Display limits from robust percentiles, so one hot pixel cannot wash out the plate. */
export function stretchLimits(image) {
  const finite = image.filter((value) => !Number.isNaN(value)).sort();
  if (!finite.length) return { low: 0, high: 1 };
  const low = finite[Math.floor((finite.length - 1) * LOW_PERCENTILE)];
  const high = finite[Math.floor((finite.length - 1) * HIGH_PERCENTILE)];
  return { low, high: high > low ? high : low + 1 };
}

export function asinhScale(value, { low, high }) {
  const unit = Math.max(0, (value - low) / (high - low));
  return Math.min(1, Math.asinh(unit * ASINH_SOFTENING) / Math.asinh(ASINH_SOFTENING));
}

/** Largest absolute value worth showing in a difference image. */
export function differenceLimit(image) {
  const magnitudes = image.filter((value) => !Number.isNaN(value)).map(Math.abs).sort();
  if (!magnitudes.length) return 1;
  return magnitudes[Math.floor((magnitudes.length - 1) * 0.995)] || 1;
}

/** Exposures that clip the edge of a detector would leave holes in the plate. */
export function wellCovered(frames, minimumShare = MIN_COVERED_SHARE) {
  return frames.filter((frame) => {
    let finite = 0;
    for (let index = 0; index < frame.pixels.length; index += COVERAGE_STRIDE) {
      if (!Number.isNaN(frame.pixels[index])) finite += 1;
    }
    return finite >= minimumShare * Math.ceil(frame.pixels.length / COVERAGE_STRIDE);
  });
}

/** Group frames into dated visits, ordered in time. */
export function visitsOf(frames) {
  const groups = new Map();
  for (const frame of frames) {
    const list = groups.get(frame.visit) ?? [];
    groups.set(frame.visit, [...list, frame]);
  }
  return [...groups.entries()]
    .map(([visit, members]) => ({
      visit,
      frames: members,
      mjd: members.reduce((sum, item) => sum + item.mjd, 0) / members.length,
    }))
    .sort((first, second) => first.mjd - second.mjd);
}

export function selectBand(frames, band) {
  if (band.kind === 'channel') return frames.filter((frame) => frame.channel === band.channel);
  if (band.kind === 'detector') return frames.filter((frame) => frame.detector === band.detector);
  return frames;
}

/** A single band may have no exposure here: use the closest band that does. */
export function resolveBand(frames, band) {
  if (band.kind !== 'channel' || !frames.length) return band;
  const channel = frames.reduce((best, frame) =>
    Math.abs(frame.channel - band.channel) < Math.abs(best - band.channel) ? frame.channel : best, frames[0].channel);
  return { kind: 'channel', channel };
}

/** Tangent-plane projection matching the server's north-up, east-left grid. */
export function skyToPixel(ra, dec, grid) {
  const dRa = (ra - grid.ra) * DEG;
  const dec0 = grid.dec * DEG;
  const decR = dec * DEG;
  const cosC = Math.sin(dec0) * Math.sin(decR) + Math.cos(dec0) * Math.cos(decR) * Math.cos(dRa);
  const xi = (Math.cos(decR) * Math.sin(dRa)) / cosC / DEG;
  const eta = (Math.cos(dec0) * Math.sin(decR) - Math.sin(dec0) * Math.cos(decR) * Math.cos(dRa)) / cosC / DEG;
  const centre = (grid.n - 1) / 2;
  return { x: centre - xi / grid.scale, y: centre + eta / grid.scale };
}

export function pixelToSky(x, y, grid) {
  const centre = (grid.n - 1) / 2;
  const xi = (centre - x) * grid.scale * DEG;
  const eta = (y - centre) * grid.scale * DEG;
  const dec0 = grid.dec * DEG;
  const rho = Math.hypot(xi, eta) || 1e-12;
  const c = Math.atan(rho);
  const dec = Math.asin(Math.cos(c) * Math.sin(dec0) + (eta * Math.sin(c) * Math.cos(dec0)) / rho);
  const ra = grid.ra * DEG + Math.atan2(xi * Math.sin(c), rho * Math.cos(dec0) * Math.cos(c) - eta * Math.sin(dec0) * Math.sin(c));
  return { ra: ((ra / DEG) % 360 + 360) % 360, dec: dec / DEG };
}

const MJD_J2000 = 51544.5;
const DAYS_PER_YEAR = 365.25;
const MAS_PER_DEG = 3.6e6;

export function mjdToYear(mjd) {
  return 2000 + (mjd - MJD_J2000) / DAYS_PER_YEAR;
}

export function mjdToDate(mjd) {
  return new Date(Date.UTC(2000, 0, 1, 12) + (mjd - MJD_J2000) * 86400000);
}

/** Linear proper-motion position at a given year; pmra includes cos(dec). */
export function positionAt(object, year) {
  const elapsed = year - object.epoch;
  return {
    ra: object.ra + (object.pmra * elapsed) / MAS_PER_DEG / Math.max(Math.cos(object.dec * DEG), 1e-6),
    dec: object.dec + (object.pmdec * elapsed) / MAS_PER_DEG,
  };
}

/** Median flux per band channel: the line drawn through the raw spectrum points. */
export function binSpectrum(points) {
  const bins = new Map();
  for (const point of points) {
    const edge = Math.floor((Math.log(point.wavelength / WAVE_MIN) / Math.log(WAVE_MAX / WAVE_MIN)) * CHANNELS);
    const list = bins.get(edge) ?? [];
    bins.set(edge, [...list, point]);
  }
  return [...bins.values()]
    .map((members) => {
      const fluxes = Float32Array.from(members, (item) => item.flux);
      return {
        wavelength: members.reduce((sum, item) => sum + item.wavelength, 0) / members.length,
        flux: median(fluxes, fluxes.length),
      };
    })
    .sort((first, second) => first.wavelength - second.wavelength);
}

/** Decodes the server's frame payload: JSON header, then pixel and mask blocks. */
export function decodeFrames(buffer, size) {
  const headerLength = new DataView(buffer).getUint32(0, true);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headerLength)));
  const area = size * size;
  const pixelStart = 4 + headerLength;
  const maskStart = pixelStart + meta.length * area * 4;
  return meta.map((item, index) => ({
    ...item,
    pixels: new Float32Array(buffer, pixelStart + index * area * 4, area),
    mask: new Uint8Array(buffer, maskStart + index * area, area),
  }));
}

/** Decodes the compact static format: asinh-coded int16 pixels, then uint8 masks. */
export function decodeStaticFrames(buffer, meta) {
  const area = meta.grid.n * meta.grid.n;
  const codes = new Int16Array(buffer, 0, meta.frames.length * area);
  const maskStart = meta.frames.length * area * 2;
  return meta.frames.map((item, index) => ({
    ...item,
    pixels: decodeCodes(codes.subarray(index * area, (index + 1) * area), item.soft, meta.step),
    mask: new Uint8Array(buffer, maskStart + index * area, area),
  }));
}

export function decodeCodes(codes, soft, step) {
  const pixels = new Float32Array(codes.length);
  for (let index = 0; index < codes.length; index += 1) {
    pixels[index] = codes[index] === NAN_CODE ? NaN : soft * Math.sinh(codes[index] * step);
  }
  return pixels;
}
