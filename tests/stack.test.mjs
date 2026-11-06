import test from 'node:test';
import assert from 'node:assert/strict';
import {
  asinhScale, binSpectrum, channelWavelength, decodeFrames, detectorOfChannel, pixelToSky,
  positionAt, selectBand, skyToPixel, stackFrames, stretchLimits, subtract, visitsOf,
} from '../static/js/stack.js';

const near = (actual, expected, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not near ${expected}`);

const frame = (values, mask) => ({ pixels: Float32Array.from(values), mask: mask && Uint8Array.from(mask) });

test('median stack rejects a single-frame outlier', () => {
  const stack = stackFrames([frame([1, 1, 1, 1]), frame([1, 1, 1, 900]), frame([1, 1, 1, 1])], 2);
  assert.deepEqual([...stack], [1, 1, 1, 1]);
});

test('stack ignores NaN and keeps NaN only where no frame has data', () => {
  const stack = stackFrames([frame([NaN, 2, NaN, 4]), frame([NaN, 4, 6, NaN])], 2);
  assert.ok(Number.isNaN(stack[0]));
  assert.deepEqual([...stack.slice(1)], [3, 6, 4]);
});

test('stack can leave out flagged pixels', () => {
  const stack = stackFrames([frame([9, 1, 1, 1], [1, 0, 0, 0]), frame([2, 1, 1, 1], [0, 0, 0, 0])], 2, true);
  assert.equal(stack[0], 2);
});

test('difference of two stacks leaves a moving source as a positive and negative pair', () => {
  const result = subtract(Float32Array.from([0, 5]), Float32Array.from([5, 0]));
  assert.deepEqual([...result], [-5, 5]);
});

test('stretch limits resist a single hot pixel', () => {
  const image = new Float32Array(10000).map((_, index) => index / 10000);
  image[0] = 1e6;
  const { high } = stretchLimits(image);
  assert.ok(high < 2);
});

test('asinh scale runs from 0 to 1', () => {
  assert.equal(asinhScale(-5, { low: 0, high: 1 }), 0);
  near(asinhScale(1, { low: 0, high: 1 }), 1);
});

test('102 channels cover every array in increasing wavelength', () => {
  assert.equal(detectorOfChannel(0), 1);
  assert.equal(detectorOfChannel(101), 6);
  for (let channel = 1; channel < 102; channel += 1) {
    assert.ok(channelWavelength(channel) > channelWavelength(channel - 1));
  }
});

test('visits are ordered by time', () => {
  const visits = visitsOf([{ visit: 1, mjd: 200 }, { visit: 0, mjd: 100 }, { visit: 1, mjd: 202 }]);
  assert.deepEqual(visits.map((item) => item.visit), [0, 1]);
  assert.equal(visits[1].frames.length, 2);
  assert.equal(visits[1].mjd, 201);
});

test('band selection picks an array or a single channel', () => {
  const frames = [{ detector: 1, channel: 3 }, { detector: 2, channel: 20 }];
  assert.equal(selectBand(frames, { kind: 'detector', detector: 2 }).length, 1);
  assert.equal(selectBand(frames, { kind: 'channel', channel: 3 }).length, 1);
  assert.equal(selectBand(frames, { kind: 'composite' }).length, 2);
});

test('sky and pixel conversion round-trip and match the east-left grid', () => {
  const grid = { ra: 133.76, dec: -7.24, n: 120, scale: 0.1 / 120 };
  const centre = skyToPixel(133.76, -7.24, grid);
  near(centre.x, 59.5);
  const east = skyToPixel(133.77, -7.24, grid);
  assert.ok(east.x < centre.x, 'east must lie to the left');
  const sky = pixelToSky(30.2, 80.7, grid);
  const back = skyToPixel(sky.ra, sky.dec, grid);
  near(back.x, 30.2, 1e-6);
  near(back.y, 80.7, 1e-6);
});

test('proper motion moves Barnard-like star north by about 10 arcsec a year', () => {
  const object = { ra: 269.45, dec: 4.74, pmra: 0, pmdec: 10362, epoch: 2016 };
  near((positionAt(object, 2026).dec - 4.74) * 3600, 103.62, 1e-6);
});

test('spectrum binning takes the median inside each channel', () => {
  const line = binSpectrum([
    { wavelength: 1.0, flux: 1 }, { wavelength: 1.0005, flux: 3 }, { wavelength: 1.001, flux: 100 },
    { wavelength: 4.5, flux: 7 },
  ]);
  assert.equal(line.length, 2);
  assert.equal(line[0].flux, 3);
});

test('frame payload decodes meta, pixels and masks', () => {
  const header = new TextEncoder().encode(JSON.stringify([{ visit: 3 }]).padEnd(16, ' '));
  const buffer = new ArrayBuffer(4 + header.length + 4 * 4 + 4);
  new DataView(buffer).setUint32(0, header.length, true);
  new Uint8Array(buffer, 4).set(header);
  new Float32Array(buffer, 4 + header.length, 4).set([1, 2, 3, 4]);
  new Uint8Array(buffer, 4 + header.length + 16, 4).set([0, 1, 0, 1]);
  const [decoded] = decodeFrames(buffer, 2);
  assert.equal(decoded.visit, 3);
  assert.deepEqual([...decoded.pixels], [1, 2, 3, 4]);
  assert.deepEqual([...decoded.mask], [0, 1, 0, 1]);
});
