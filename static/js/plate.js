// Draws the current stack on the plate canvas, with its overlays.
import {
  asinhScale, channelWavelength, COMPOSITE, DETECTOR_RANGES, differenceLimit, positionAt, selectBand,
  sharpenForDisplay, skyToPixel, stackFrames, stretchLimits, subtract, wavelengthColor,
} from './stack.js';
import { fullView, plateToCanvas } from './viewport.js';

const AMBER = [255, 184, 77];
const BLUE = [92, 170, 255];
const NEUTRAL = [235, 240, 248];
const GAIA_FAINT_LIMIT = 19;
const HOT_KNEE = 0.62;
const BLOOM_ALPHA = 0.32;
const BLOOM_LAYER_SIZE = 256;
const BLOOM_LAYER_BLUR = 2.5;
const PATH_START_YEAR = 2010.5;
const SCALE_BAR_ARCSEC = [120, 60, 30, 15, 10];

/** Memoises stacks; cleared whenever new frames arrive or the flag option changes. */
export class StackCache {
  constructor() {
    this.entries = new Map();
  }

  clear() {
    this.entries.clear();
  }

  get(key, build) {
    if (!this.entries.has(key)) this.entries.set(key, build());
    return this.entries.get(key);
  }
}

export function tintFor(band) {
  if (band.kind === 'channel') return wavelengthColor(channelWavelength(band.channel));
  if (band.kind === 'detector') {
    const [low, high] = DETECTOR_RANGES[band.detector];
    return wavelengthColor(Math.sqrt(low * high));
  }
  return NEUTRAL;
}

function paint(buffer, size, colorAt) {
  if (buffer.width !== size) {
    buffer.width = size;
    buffer.height = size;
  }
  const context = buffer.getContext('2d');
  const image = context.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // FITS rows run south to north, canvas rows north to south.
      const source = (size - 1 - y) * size + x;
      const target = (y * size + x) * 4;
      const [red, green, blue, alpha = 255] = colorAt(source);
      image.data[target] = red;
      image.data[target + 1] = green;
      image.data[target + 2] = blue;
      image.data[target + 3] = alpha;
    }
  }
  context.putImageData(image, 0, 0);
}

/** Black through the band's colour to a white-hot core, like an overexposed plate. */
function hotColor(tint, level) {
  if (level < HOT_KNEE) {
    const rise = level / HOT_KNEE;
    return [tint[0] * rise, tint[1] * rise, tint[2] * rise];
  }
  const burn = (level - HOT_KNEE) / (1 - HOT_KNEE);
  return tint.map((part) => part + (255 - part) * burn);
}

export function paintMono(buffer, size, image, limits, tint) {
  const display = sharpenForDisplay(image, size);
  paint(buffer, size, (pixel) => {
    const value = display[pixel];
    if (Number.isNaN(value)) return [0, 0, 0, 0];
    return hotColor(tint, asinhScale(value, limits));
  });
}

export function paintComposite(buffer, size, stacks, limits) {
  const red = sharpenForDisplay(stacks.red, size);
  const green = sharpenForDisplay(stacks.green, size);
  const blue = sharpenForDisplay(stacks.blue, size);
  paint(buffer, size, (pixel) => {
    if (Number.isNaN(red[pixel]) && Number.isNaN(green[pixel]) && Number.isNaN(blue[pixel])) return [0, 0, 0, 0];
    const part = (image, limit) => (Number.isNaN(image[pixel]) ? 0 : asinhScale(image[pixel], limit) * 255);
    return [part(red, limits.red), part(green, limits.green), part(blue, limits.blue)];
  });
}

export function paintDifference(buffer, size, later, earlier) {
  const image = subtract(later, earlier);
  const limit = differenceLimit(image);
  paint(buffer, size, (pixel) => {
    const value = image[pixel];
    if (Number.isNaN(value)) return [0, 0, 0, 0];
    const level = Math.min(1, Math.abs(value) / limit);
    const hue = value >= 0 ? AMBER : BLUE;
    return [hue[0] * level, hue[1] * level, hue[2] * level];
  });
}

/** Stacks one band selection of the given frames: one image, or three for a composite. */
export function stacksFor(frames, band, size, excludeFlagged, cache, key) {
  const stackOf = (subset, tag) =>
    cache.get(`${key}|${tag}|${excludeFlagged}`, () => stackFrames(subset, size, excludeFlagged));
  if (band.kind === 'composite') {
    const pick = (detectors) => frames.filter((frame) => detectors.includes(frame.detector));
    return {
      red: stackOf(pick(COMPOSITE.red), 'r'),
      green: stackOf(pick(COMPOSITE.green), 'g'),
      blue: stackOf(pick(COMPOSITE.blue), 'b'),
    };
  }
  return { image: stackOf(selectBand(frames, band), `${band.kind}${band.detector ?? band.channel}`) };
}

export function limitsFor(stacks) {
  if (stacks.image) return stretchLimits(stacks.image);
  return { red: stretchLimits(stacks.red), green: stretchLimits(stacks.green), blue: stretchLimits(stacks.blue) };
}

export function drawPlate(canvas, buffer, overlay) {
  const context = canvas.getContext('2d');
  const size = overlay.grid.n;
  const view = overlay.view ?? fullView(size);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.fillStyle = '#060b16';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const span = size / view.zoom;
  const source = [view.x - span / 2, size - view.y - span / 2, span, span];
  context.drawImage(buffer, ...source, 0, 0, canvas.width, canvas.height);
  drawBloom(context, buffer, canvas, source, size);
  if (overlay.bare) return;
  const toCanvas = ({ x, y }) => plateToCanvas(view, size, canvas.width, x, y);
  const scale = (canvas.width / size) * view.zoom;
  drawGaia(context, overlay, toCanvas);
  drawTrack(context, overlay, toCanvas);
  drawExpected(context, overlay, toCanvas, scale);
  drawPick(context, overlay, toCanvas);
  drawScale(context, overlay, scale, canvas);
}

const bloomLayer = document.createElement('canvas');
bloomLayer.width = BLOOM_LAYER_SIZE;
bloomLayer.height = BLOOM_LAYER_SIZE;

/** Lets bright stars glow. The blur runs on a small copy, because blurring a full plate is slow. */
function drawBloom(context, buffer, canvas, source, size) {
  const layer = bloomLayer.getContext('2d');
  layer.clearRect(0, 0, BLOOM_LAYER_SIZE, BLOOM_LAYER_SIZE);
  layer.filter = `blur(${BLOOM_LAYER_BLUR}px)`;
  layer.drawImage(buffer, 0, 0, BLOOM_LAYER_SIZE, BLOOM_LAYER_SIZE);
  const ratio = BLOOM_LAYER_SIZE / size;
  context.save();
  context.globalCompositeOperation = 'lighter';
  context.globalAlpha = BLOOM_ALPHA;
  context.drawImage(bloomLayer, ...source.map((value) => value * ratio), 0, 0, canvas.width, canvas.height);
  context.restore();
}

function project(object, year, grid) {
  const { ra, dec } = positionAt(object, year);
  return skyToPixel(ra, dec, grid);
}

function drawGaia(context, { gaia, year, grid }, toCanvas) {
  if (!gaia?.length) return;
  context.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  context.lineWidth = 1;
  for (const star of gaia) {
    const { x, y } = toCanvas(project({ ...star, epoch: 2016 }, year, grid));
    context.beginPath();
    context.arc(x, y, Math.max(2.5, (GAIA_FAINT_LIMIT - star.g) * 0.8), 0, Math.PI * 2);
    context.stroke();
  }
}

function drawExpected(context, { target, year, grid }, toCanvas, scale) {
  if (!target || !(target.pmra || target.pmdec)) return;
  context.save();
  context.shadowColor = '#ffffff';
  context.shadowBlur = 14;
  context.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  context.setLineDash([3, 7]);
  context.lineWidth = 1.5;
  const from = toCanvas(project(target, PATH_START_YEAR, grid));
  const to = toCanvas(project(target, year, grid));
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.stroke();
  context.setLineDash([]);
  context.strokeStyle = '#ffffff';
  context.lineWidth = 2.5;
  context.beginPath();
  context.arc(to.x, to.y, Math.max(20, 7 * scale), 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

function drawTrack(context, { track }, toCanvas) {
  if (!track?.length) return;
  context.strokeStyle = `rgb(${AMBER.join(',')})`;
  context.fillStyle = context.strokeStyle;
  context.lineWidth = 1.5;
  context.beginPath();
  track.forEach((point, index) => {
    const { x, y } = toCanvas(point);
    if (index) context.lineTo(x, y);
    else context.moveTo(x, y);
  });
  context.stroke();
  for (const point of track) {
    const { x, y } = toCanvas(point);
    context.beginPath();
    context.arc(x, y, 2.5, 0, Math.PI * 2);
    context.fill();
  }
}

function drawPick(context, { pick, grid }, toCanvas) {
  if (!pick) return;
  const { x, y } = toCanvas(skyToPixel(pick.ra, pick.dec, grid));
  const inner = 7;
  const outer = 16;
  context.strokeStyle = '#ffffff';
  context.lineWidth = 1.5;
  context.beginPath();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    context.moveTo(x + dx * inner, y + dy * inner);
    context.lineTo(x + dx * outer, y + dy * outer);
  }
  context.stroke();
}

function drawScale(context, { grid }, scale, canvas) {
  const arcsecPerCanvasPixel = (grid.scale * 3600) / scale;
  const widest = canvas.width * 0.25 * arcsecPerCanvasPixel;
  const arcsec = SCALE_BAR_ARCSEC.find((value) => value <= widest) ?? 5;
  const margin = canvas.width * 0.03;
  const bottom = canvas.height - margin;
  context.strokeStyle = '#ffffff';
  context.fillStyle = '#ffffff';
  context.lineWidth = 2;
  context.font = `${Math.round(canvas.width * 0.022)}px Commissioner, sans-serif`;
  context.textAlign = 'left';
  context.beginPath();
  context.moveTo(margin, bottom);
  context.lineTo(margin + arcsec / arcsecPerCanvasPixel, bottom);
  context.stroke();
  context.fillText(`${arcsec}″`, margin, bottom - 8);
  const arm = canvas.width * 0.04;
  const cornerX = canvas.width - margin;
  const cornerY = margin + arm + 14;
  context.beginPath();
  context.moveTo(cornerX, cornerY);
  context.lineTo(cornerX, cornerY - arm);
  context.moveTo(cornerX, cornerY);
  context.lineTo(cornerX - arm, cornerY);
  context.stroke();
  context.textAlign = 'center';
  context.fillText('N', cornerX, cornerY - arm - 5);
  context.textAlign = 'right';
  context.fillText('E', cornerX - arm - 5, cornerY + 5);
  context.textAlign = 'left';
}
