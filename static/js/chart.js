// Spectrum and light-curve charts drawn as inline SVG.
import { binSpectrum, mjdToDate, wavelengthColor } from './stack.js';
import { currentLanguage, t } from './i18n.js';

const WIDTH = 460;
const HEIGHT = 200;
const MARGIN = { left: 54, right: 12, top: 26, bottom: 36 };
const NS = 'http://www.w3.org/2000/svg';
const RAMP_STOPS = 16;

// Infrared features relevant to the molecules named in the challenge statement, in micrometres.
const FEATURES = [
  { wavelength: 2.7, label: 'H₂O' },
  { wavelength: 3.3, label: 'CH₄' },
  { wavelength: 4.27, label: 'CO₂' },
  { wavelength: 4.67, label: 'CO' },
];

const element = (name, attributes = {}, text) => {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
};

function niceTicks(low, high, count = 5) {
  const step = (high - low) / count;
  const magnitude = 10 ** Math.floor(Math.log10(step || 1));
  const nice = [1, 2, 5, 10].find((value) => value * magnitude >= step) * magnitude;
  const ticks = [];
  for (let value = Math.ceil(low / nice) * nice; value <= high + 1e-9; value += nice) ticks.push(value);
  return ticks;
}

function robustRange(values) {
  const sorted = [...values].sort((first, second) => first - second);
  if (!sorted.length) return [0, 1];
  const low = sorted[Math.floor(sorted.length * 0.01)];
  const high = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))];
  const pad = Math.max((high - low) * 0.12, 1);
  return [Math.min(low - pad, 0), high + pad];
}

function axes(svg, xTicks, yTicks, x, y, xFormat, xLabel, yLabel = t('flux')) {
  const plotBottom = HEIGHT - MARGIN.bottom;
  for (const tick of yTicks) {
    svg.append(element('line', { x1: MARGIN.left, x2: WIDTH - MARGIN.right, y1: y(tick), y2: y(tick), class: 'grid' }));
    svg.append(element('text', { x: MARGIN.left - 7, y: y(tick) + 4, 'text-anchor': 'end', class: 'tick' }, String(+tick.toPrecision(4))));
  }
  for (const tick of xTicks) {
    svg.append(element('text', { x: x(tick), y: plotBottom + 16, 'text-anchor': 'middle', class: 'tick' }, xFormat(tick)));
  }
  svg.append(element('text', { x: WIDTH - MARGIN.right, y: HEIGHT - 3, 'text-anchor': 'end', class: 'axis' }, xLabel));
  svg.append(element('text', { x: 4, y: 14, class: 'axis' }, yLabel));
}

function points(svg, data, x, y, xOf) {
  for (const point of data) {
    const cx = x(xOf(point));
    svg.append(element('line', { x1: cx, x2: cx, y1: y(point.flux - point.error), y2: y(point.flux + point.error), class: 'error' }));
    svg.append(element('circle', { cx, cy: y(point.flux), r: 2.4, class: point.flagged ? 'flagged' : 'point' }));
  }
}

function frame(host) {
  host.replaceChildren();
  const svg = element('svg', { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, role: 'img' });
  host.append(svg);
  return svg;
}

const scale = (domainLow, domainHigh, rangeLow, rangeHigh) => (value) =>
  rangeLow + ((value - domainLow) / (domainHigh - domainLow || 1)) * (rangeHigh - rangeLow);

export function drawSpectrum(host, data) {
  const svg = frame(host);
  svg.setAttribute('aria-label', t('spectrum'));
  const clean = data.filter((point) => !point.flagged);
  const [yLow, yHigh] = robustRange((clean.length ? clean : data).map((point) => point.flux));
  const x = scale(0.7, 5.05, MARGIN.left, WIDTH - MARGIN.right);
  const y = scale(yLow, yHigh, HEIGHT - MARGIN.bottom, MARGIN.top);
  const yClipped = (value) => Math.min(HEIGHT - MARGIN.bottom, Math.max(MARGIN.top, y(value)));
  axes(svg, [1, 2, 3, 4, 5], niceTicks(yLow, yHigh), x, y, String, t('wavelength'));
  for (const feature of FEATURES) {
    svg.append(element('line', { x1: x(feature.wavelength), x2: x(feature.wavelength), y1: MARGIN.top, y2: HEIGHT - MARGIN.bottom, class: 'feature' }));
    svg.append(element('text', { x: x(feature.wavelength), y: MARGIN.top - 6, 'text-anchor': 'middle', class: 'feature-label' }, feature.label));
  }
  points(svg, data, x, yClipped, (point) => point.wavelength);
  const usable = data.filter((point) => !point.flagged);
  const path = binSpectrum(usable.length > 3 ? usable : data)
    .map((point, index) => `${index ? 'L' : 'M'}${x(point.wavelength).toFixed(1)} ${yClipped(point.flux).toFixed(1)}`)
    .join('');
  const baseline = yClipped(Math.max(yLow, 0)).toFixed(1);
  const span = path.match(/[ML]([\d.]+)/g) ?? [];
  if (span.length) {
    const first = span[0].slice(1);
    const last = span.at(-1).slice(1);
    svg.append(element('path', { d: `${path}L${last} ${baseline}L${first} ${baseline}Z`, class: 'area', fill: 'url(#wave-ramp)' }));
  }
  svg.append(rampGradient(x));
  svg.append(element('path', { d: path, class: 'line', stroke: 'url(#wave-ramp)' }));
}

/** Horizontal gradient whose colours are those of the wavelengths along the axis. */
function rampGradient(x) {
  const defs = element('defs');
  const gradient = element('linearGradient', {
    id: 'wave-ramp', gradientUnits: 'userSpaceOnUse', x1: x(0.75), x2: x(5), y1: 0, y2: 0,
  });
  for (let step = 0; step <= RAMP_STOPS; step += 1) {
    const fraction = step / RAMP_STOPS;
    const wavelength = 0.75 + fraction * 4.25;
    gradient.append(element('stop', {
      offset: fraction, 'stop-color': `rgb(${wavelengthColor(wavelength).join(',')})`,
    }));
  }
  defs.append(gradient);
  return defs;
}

/** Light curve of a saturated star, from the wings of its profile; relative units. */
export function drawWingCurve(host, data) {
  const usable = data.filter((point) => point.wing !== null && point.wing !== undefined);
  drawLightCurve(host, usable.map((point) => ({ ...point, flux: point.wing, error: 0, flagged: false })), t('wingAxis'));
}

export function drawLightCurve(host, data, yLabel = t('flux')) {
  const svg = frame(host);
  svg.setAttribute('aria-label', t('lightCurve'));
  const dates = data.map((point) => point.mjd);
  const xLow = Math.min(...dates) - 10;
  const xHigh = Math.max(...dates) + 10;
  const [yLow, yHigh] = robustRange(data.map((point) => point.flux));
  const x = scale(xLow, xHigh, MARGIN.left, WIDTH - MARGIN.right);
  const y = scale(yLow, yHigh, HEIGHT - MARGIN.bottom, MARGIN.top);
  const clipped = (value) => Math.min(HEIGHT - MARGIN.bottom, Math.max(MARGIN.top, y(value)));
  const monthYear = new Intl.DateTimeFormat(currentLanguage(), { month: 'short', year: '2-digit', timeZone: 'UTC' });
  axes(svg, niceTicks(xLow, xHigh, 4), niceTicks(yLow, yHigh), x, y, (value) => monthYear.format(mjdToDate(value)), t('date'), yLabel);
  points(svg, data, x, clipped, (point) => point.mjd);
}
