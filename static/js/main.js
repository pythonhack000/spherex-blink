// Application state and wiring between the sky map, plate, charts and controls.
import * as api from './api.js';
import { drawLightCurve, drawSpectrum } from './chart.js';
import { measureMotion as trackMotion, measureSpectrum as photometry } from './science.js';
import { applyTranslations, currentLanguage, setLanguage, t } from './i18n.js';
import {
  drawPlate, limitsFor, paintComposite, paintDifference, paintMono, stacksFor, StackCache, tintFor,
} from './plate.js';
import { createSky } from './sky.js';
import {
  channelWavelength, CHANNELS, detectorOfChannel, mjdToDate, mjdToYear, pixelToSky, selectBand,
  visitsOf, wavelengthColor,
} from './stack.js';
import { runTour } from './tour.js';

const POLL_MS = 1500;
const FRAME_MS = 900;
const DEFAULT_FOV = 0.1;
const CUSTOM_EPOCH = 2016;
const DEFAULT_MID_MJD = 61100;
const WISE_STEP = 'wise';
const ALL_DATES = 'all';
const MOTION_SIGNIFICANCE = 3;
const AUTO_SPECTRUM_FRAMES = 12;
const FULL_RANGE_LABEL = '0.75–5 μm';
const COMPOSITE_COLOR = [255, 184, 77];
const COUNT_UP_MS = 900;
const DIVE_FOV = 0.4;
const MOTION_PAINT_DELAY_MS = 40;

const $ = (id) => document.getElementById(id);
const buffer = document.createElement('canvas');
const cache = new StackCache();

const state = {
  presets: [],
  results: [],
  staticMeta: null,
  target: null,
  job: null,
  frames: [],
  visits: [],
  wiseFrame: null,
  position: 0,
  band: { kind: 'composite' },
  mode: 'video',
  excludeFlags: false,
  gaia: [],
  chart: 'spectrum',
  spectrum: null,
  spectrumObject: null,
  pick: null,
  track: null,
  playing: false,
  session: 0,
  auto: { spectrum: false, final: false },
};

let playTimer = null;
let sky = null;

// ---------- Sequence of dates ----------

function sequence() {
  const dated = state.visits.map((visit) => ({ ...visit, key: visit.visit }));
  return state.wiseFrame && $('wise').checked
    ? [{ key: WISE_STEP, frames: [state.wiseFrame], year: state.wiseFrame.year }, ...dated]
    : dated;
}

function currentStep() {
  const steps = sequence();
  if (state.position === ALL_DATES || !steps.length) return null;
  return steps[Math.min(state.position, steps.length - 1)];
}

const yearOf = (step) => step.year ?? mjdToYear(step.mjd);

function midYear() {
  if (!state.visits.length) return mjdToYear(DEFAULT_MID_MJD);
  return mjdToYear(state.visits[Math.floor(state.visits.length / 2)].mjd);
}

// ---------- Drawing ----------

function render() {
  if (!state.job) return;
  const size = state.job.n;
  const step = currentStep();
  const shown = paintStep(step, size);
  $('plate-empty').hidden = shown || !state.frames.length;
  $('plate-empty').textContent = t('noFrames');
  drawPlate($('plate'), buffer, {
    grid: state.job,
    year: step ? yearOf(step) : midYear(),
    target: state.target,
    gaia: $('gaia').checked ? state.gaia : null,
    track: state.track,
    pick: state.pick,
  });
  describeStep(step);
  paintAmbient();
}

/** The page's background glow is the current picture itself, heavily blurred. */
function paintAmbient() {
  const ambient = $('ambient');
  ambient.getContext('2d').drawImage($('plate'), 0, 0, ambient.width, ambient.height);
}

function paintStep(step, size) {
  if (step?.key === WISE_STEP) return paintWise(step, size);
  if (state.mode === 'diff') return paintDiffStep(step, size);
  const frames = step ? step.frames : state.frames;
  if (!selectBand(frames, state.band).length) return false;
  const key = step ? `v${step.key}` : ALL_DATES;
  const stacks = stacksFor(frames, state.band, size, state.excludeFlags, cache, key);
  if (stacks.image) paintMono(buffer, size, stacks.image, sharedLimits(size), tintFor(state.band));
  else paintComposite(buffer, size, stacks, sharedLimits(size));
  return true;
}

/** One stretch for every date, so brightness changes between frames are real. */
function sharedLimits(size) {
  const bandKey = `${state.band.kind}${state.band.detector ?? state.band.channel ?? ''}`;
  return cache.get(`limits|${bandKey}|${state.excludeFlags}`, () =>
    limitsFor(stacksFor(state.frames, state.band, size, state.excludeFlags, cache, ALL_DATES)));
}

function paintWise(step, size) {
  const image = step.frames[0].pixels;
  paintMono(buffer, size, image, limitsFor({ image }), tintFor({ kind: 'detector', detector: 6 }));
  return true;
}

function paintDiffStep(step, size) {
  const band = state.band.kind === 'composite' ? { kind: 'all' } : state.band;
  const first = state.visits[0];
  const current = step ?? state.visits.at(-1);
  if (!first || !current) return false;
  if (!selectBand(first.frames, band).length || !selectBand(current.frames, band).length) return false;
  const later = stacksFor(current.frames, band, size, state.excludeFlags, cache, `v${current.visit}`).image;
  const earlier = stacksFor(first.frames, band, size, state.excludeFlags, cache, `v${first.visit}`).image;
  paintDifference(buffer, size, later, earlier);
  return true;
}

const formatDate = (date) =>
  new Intl.DateTimeFormat(currentLanguage(), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);

function describeStep(step) {
  if (step?.key === WISE_STEP) {
    $('plate-date').textContent = 'AllWISE 2010';
    $('plate-info').textContent = '';
    return;
  }
  $('plate-date').textContent = step ? formatDate(mjdToDate(step.mjd)) : t('allDates');
  const frames = selectBand(step ? step.frames : state.frames, state.band);
  const flagged = frames.length ? frames.reduce((sum, item) => sum + item.flaggedPct, 0) / frames.length : 0;
  const parts = [t('frames', { count: frames.length }), t('flagged', { pct: flagged.toFixed(1) })];
  if (state.mode === 'diff') parts.push(t('differenceLegend'));
  else if (state.target?.pmra || state.target?.pmdec) parts.push(t('expected'));
  $('plate-info').textContent = parts.join('. ');
}

// ---------- Controls ----------

function setPressed(container, attribute, value) {
  for (const button of container.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset[attribute] === String(value)));
  }
}

function dateButton(label, position) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.setAttribute('aria-pressed', String(state.position === position));
  button.addEventListener('click', () => selectPosition(position));
  return button;
}

function renderDates() {
  const buttons = sequence().map((step, index) =>
    dateButton(step.key === WISE_STEP ? '2010' : formatDate(mjdToDate(step.mjd)), index));
  $('dates').replaceChildren(...buttons, dateButton(t('allDates'), ALL_DATES));
}

function selectPosition(position) {
  setPlaying(false);
  state.position = position;
  renderDates();
  render();
}

function setPlaying(playing) {
  state.playing = playing;
  $('play').textContent = t(playing ? 'pause' : 'play');
  clearInterval(playTimer);
  if (playing) playTimer = setInterval(advance, FRAME_MS);
}

function advance() {
  const count = sequence().length;
  if (count < 2) return;
  state.position = state.position === ALL_DATES ? 0 : (state.position + 1) % count;
  renderDates();
  render();
}

function setMode(mode) {
  state.mode = mode;
  setPressed($('modes'), 'mode', mode);
  if (mode === 'sum') {
    setPlaying(false);
    state.position = ALL_DATES;
  } else if (state.position === ALL_DATES) {
    state.position = 0;
    setPlaying(true);
  }
  renderDates();
  render();
}

function bandColor(band) {
  if (band.kind === 'channel') return wavelengthColor(channelWavelength(band.channel));
  if (band.kind === 'detector') return tintFor(band);
  return COMPOSITE_COLOR;
}

function setBand(band) {
  state.band = band;
  document.documentElement.style.setProperty('--band', bandColor(band).join(', '));
  $('composite').setAttribute('aria-pressed', String(band.kind === 'composite'));
  $('band-label').textContent = band.kind === 'channel'
    ? `${channelWavelength(band.channel).toFixed(2)} μm`
    : band.kind === 'detector' ? `D${band.detector}` : FULL_RANGE_LABEL;
  if (band.kind === 'channel') $('band').value = band.channel;
  render();
}

function buildBandScale() {
  const stops = Array.from({ length: CHANNELS }, (_, channel) => {
    const stop = document.createElement('span');
    stop.style.background = `rgb(${wavelengthColor(channelWavelength(channel)).join(',')})`;
    return stop;
  });
  $('band-scale').replaceChildren(...stops);
}

// ---------- Opening a patch of sky ----------

const centreOf = (target) => ({ ra: target.centreRa ?? target.ra, dec: target.centreDec ?? target.dec });

async function openTarget(target, fov = target.fov ?? DEFAULT_FOV) {
  const session = state.session + 1;
  Object.assign(state, {
    session, target, job: null, staticMeta: null, frames: [], visits: [], wiseFrame: null, position: 0, gaia: [],
    spectrum: null, spectrumObject: null, track: null, pick: null, band: { kind: 'composite' }, mode: 'video',
    auto: { spectrum: false, final: false },
  });
  cache.clear();
  resetPanels(target, fov);
  const { ra, dec } = centreOf(target);
  sky?.goTo(ra, dec);
  writeUrl();
  try {
    if (target.key && fov === target.fov) await openStatic(target, session);
    else await openLive(ra, dec, fov, session);
  } catch (error) {
    if (session === state.session) $('progress').textContent = error.message;
  }
}

/** The challenge targets ship with the site, so they open at once with no server. */
async function openStatic(target, session) {
  const { meta, frames } = await api.getStaticTarget(target.key);
  if (session !== state.session) return;
  state.staticMeta = meta;
  state.job = { ...meta.grid, status: 'done', available: meta.available, total: meta.total, done: frames.length, failed: 0 };
  state.frames = frames;
  state.visits = visitsOf(frames);
  renderDates();
  setPlaying(true);
  render();
  reportProgress(state.job);
  autoMeasure();
}

async function openLive(ra, dec, fov, session) {
  state.job = await api.observe(ra, dec, fov);
  if (session !== state.session) return;
  setPlaying(true);
  await followJob(session);
}

function resetPanels(target, fov) {
  showPlate(true);
  $('fov').value = String(fov);
  $('wise').checked = false;
  $('gaia').checked = false;
  $('motion-result').replaceChildren();
  $('chart').replaceChildren();
  $('chart-note').textContent = t('clickHint');
  $('progress').textContent = target.key ? '' : t('searching');
  describeTarget(target);
  setPressed($('modes'), 'mode', 'video');
  setBand({ kind: 'composite' });
  renderDates();
}

function describeTarget(target) {
  const { ra, dec } = centreOf(target);
  $('object-name').textContent = target.name;
  $('object-kind').textContent = t(`kind${target.kind ?? 'custom'}`);
  $('object-coords').textContent = `RA ${ra.toFixed(4)}°, Dec ${dec >= 0 ? '+' : ''}${dec.toFixed(4)}°`;
}

async function followJob(session) {
  for (;;) {
    const status = await api.jobStatus(state.job.id);
    if (session !== state.session) return;
    state.job = status;
    await pullFrames(session);
    if (session !== state.session) return;
    reportProgress(status);
    if (status.status === 'done') autoMeasure();
    if (status.status === 'done' || status.status === 'error') return;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

async function pullFrames(session) {
  if (state.job.done <= state.frames.length) return;
  const incoming = await api.getFrames(state.job.id, state.frames.length, state.job.n);
  if (session !== state.session || !incoming.length) return;
  state.frames = [...state.frames, ...incoming];
  state.visits = visitsOf(state.frames);
  cache.clear();
  renderDates();
  render();
  autoMeasure();
}

/** Named targets show their spectrum and motion without being asked. */
function autoMeasure() {
  if (!state.target?.key) return;
  const { auto } = state;
  const finished = state.job.status === 'done';
  if (!auto.spectrum && state.frames.length >= AUTO_SPECTRUM_FRAMES) {
    auto.spectrum = true;
    spectrumOfTarget();
  }
  if (!auto.final && finished) {
    auto.final = true;
    spectrumOfTarget();
    if (state.target.pmra || state.target.pmdec) measureMotion();
  }
}

function reportProgress(status) {
  const messages = {
    searching: () => t('searching'),
    downloading: () => t('downloading', { done: status.done, total: status.total }),
    error: () => status.error,
    done: () => finishedMessage(status),
  };
  $('progress').textContent = messages[status.status]?.() ?? '';
}

function finishedMessage(status) {
  if (status.available === 0) return t('noCoverage');
  const notes = [];
  if (status.total < status.available) notes.push(t('subset', { total: status.total, available: status.available }));
  if (status.failed) notes.push(t('failedFrames', { count: status.failed }));
  return notes.join(' ');
}

function showPlate(open) {
  document.body.dataset.view = open ? 'plate' : 'sky';
  $('observatory').hidden = !open;
  $('hero').hidden = open;
  $('about').hidden = open;
  scrollTo(0, 0);
  if (!open) {
    setPlaying(false);
    sky?.refresh();
  }
}

/** Flies the map into the target, then opens the plate. */
async function diveInto(target) {
  const { ra, dec } = centreOf(target);
  document.body.dataset.view = 'diving';
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) await sky?.flyTo(ra, dec, DIVE_FOV);
  return openTarget(target);
}

// ---------- Spectrum and motion ----------

const motionOf = (object) => ({
  pmra: object?.pmra ?? 0,
  pmdec: object?.pmdec ?? 0,
  epoch: object?.epoch ?? CUSTOM_EPOCH,
});

function measureSpectrum(object, pick) {
  state.pick = pick;
  state.spectrumObject = object;
  state.spectrum = photometry(state.frames, state.job, { ...motionOf(object), ...object });
  render();
  drawChart();
}

function drawChart() {
  setPressed($('chart-kind'), 'chart', state.chart);
  const points = state.spectrum;
  if (!points) return;
  if (!points.length) {
    $('chart').replaceChildren();
    $('chart-note').textContent = t('noSpectrum');
    return;
  }
  if (state.chart === 'spectrum') drawSpectrum($('chart'), points);
  else drawLightCurve($('chart'), bandPoints(points));
  $('chart-note').textContent = t('flaggedNote');
}

function bandPoints(points) {
  if (state.band.kind === 'composite') return points;
  const detector = state.band.kind === 'channel' ? detectorOfChannel(state.band.channel) : state.band.detector;
  return points.filter((point) => point.detector === detector);
}

function pickFromPlate(event) {
  if (!state.job) return;
  const box = $('plate').getBoundingClientRect();
  const x = ((event.clientX - box.left) / box.width) * state.job.n - 0.5;
  const y = (1 - (event.clientY - box.top) / box.height) * state.job.n - 0.5;
  const position = pixelToSky(x, y, state.job);
  measureSpectrum(position, position);
}

function spectrumOfTarget() {
  return measureSpectrum(state.target, null);
}

/** Arrays where a target stands out clearly from its neighbours. */
const BEST_ARRAYS = { wise0855: [5, 6] };

function activeDetectors() {
  if (state.band.kind === 'channel') return [detectorOfChannel(state.band.channel)];
  if (state.band.kind === 'detector') return [state.band.detector];
  return BEST_ARRAYS[state.target?.key] ?? [1, 2, 3, 4, 5, 6];
}

async function measureMotion() {
  if (!state.job) return;
  const session = state.session;
  const object = state.spectrumObject ?? state.target;
  $('motion-result').textContent = t('measuring');
  // Let the message paint before the measurement occupies the page for a moment.
  await new Promise((resolve) => setTimeout(resolve, MOTION_PAINT_DELAY_MS));
  if (session !== state.session) return;
  try {
    const result = trackMotion(state.frames, state.job, { ...motionOf(object), ...object }, activeDetectors());
    state.track = result.visits;
    showMotion(result);
    render();
  } catch (error) {
    $('motion-result').textContent = error.message;
  }
}

function showMotion(result) {
  const unit = t('perYear');
  const big = document.createElement('div');
  big.className = 'big-number';
  countUp(big, result.fit.total, unit);
  const rows = [
    [t('measured'), `${result.fit.total.toFixed(2)} ± ${result.fit.totalErr.toFixed(2)}${unit}`],
    ...(result.catalog ? [[t('catalogue'), `${result.catalog.toFixed(2)}${unit}`]] : []),
    ...(result.controlMedian !== null ? [[t('controls'), `${result.controlMedian.toFixed(2)}${unit}`]] : []),
  ];
  const table = document.createElement('table');
  for (const [label, value] of rows) {
    const row = table.insertRow();
    row.insertCell().textContent = label;
    row.insertCell().textContent = value;
  }
  const floor = Math.max(result.controlMedian ?? Infinity, result.fit.totalErr);
  const real = result.fit.total > MOTION_SIGNIFICANCE * floor;
  const summary = document.createElement('p');
  summary.textContent = `${t(real ? 'motionVerdict' : 'motionWeak')} ${t('motionBaseline', {
    count: result.visits.length, detectors: result.detectors.join(', '),
  })}`;
  $('motion-result').replaceChildren(big, table, summary);
}

function countUp(node, value, unit) {
  const write = (shown) => {
    const small = document.createElement('small');
    small.textContent = unit;
    node.replaceChildren(shown.toFixed(2), small);
  };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    write(value);
    return;
  }
  const started = performance.now();
  const step = (now) => {
    const progress = Math.min(1, (now - started) / COUNT_UP_MS);
    write(value * (1 - (1 - progress) ** 3));
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- Overlays ----------

async function toggleGaia() {
  if ($('gaia').checked && !state.gaia.length && state.job) {
    try {
      state.gaia = state.staticMeta?.gaia ?? (await api.getGaia(state.job.ra, state.job.dec, state.job.fov));
    } catch {
      $('progress').textContent = t('gaiaFailed');
      $('gaia').checked = false;
    }
  }
  render();
}

async function toggleWise() {
  if ($('wise').checked && !state.wiseFrame && state.job) {
    try {
      state.wiseFrame = state.staticMeta
        ? await api.getStaticWise(state.target.key, state.staticMeta)
        : await api.getWiseFrame(state.job.id, state.job.n);
    } catch {
      $('progress').textContent = t('wiseFailed');
      $('wise').checked = false;
    }
  }
  state.position = 0;
  renderDates();
  render();
}

// ---------- Search and URL ----------

function customTarget(ra, dec, fov) {
  return { name: `${ra.toFixed(3)}, ${dec.toFixed(3)}`, ra, dec, pmra: 0, pmdec: 0, epoch: CUSTOM_EPOCH, kind: 'custom', fov };
}

async function search(text) {
  const query = text.trim();
  if (!query) return;
  try {
    const { ra, dec } = await api.parsePosition(query);
    openTarget(customTarget(ra, dec));
    return;
  } catch (error) {
    if (error.status !== 422) throw error;
  }
  try {
    openTarget({ kind: 'custom', ...(await api.resolveName(query)) });
  } catch (error) {
    showMessage(error.status === 404 ? t('notFound') : error.message);
  }
}

function showMessage(message) {
  $('caption').hidden = !message;
  $('caption').textContent = message ?? '';
}

function writeUrl() {
  const { ra, dec } = centreOf(state.target);
  const params = new URLSearchParams(location.search);
  params.delete('target');
  if (state.target.key) params.set('target', state.target.key);
  params.set('ra', ra.toFixed(5));
  params.set('dec', dec.toFixed(5));
  params.set('fov', $('fov').value);
  history.replaceState(null, '', `?${params}`);
}

function openFromUrl() {
  const params = new URLSearchParams(location.search);
  document.body.classList.toggle('embed', params.get('embed') === '1');
  const fov = Number(params.get('fov')) || undefined;
  const preset = state.presets.find((item) => item.key === params.get('target'));
  if (preset) {
    openTarget(preset, fov ?? preset.fov);
    return;
  }
  const ra = Number(params.get('ra'));
  const dec = Number(params.get('dec'));
  if (params.has('ra') && params.has('dec') && Number.isFinite(ra) && Number.isFinite(dec)) {
    openTarget(customTarget(ra, dec, fov), fov);
  }
}

// ---------- Actions used by the guided demo ----------

const demoActions = {
  caption: showMessage,
  showSky() {
    state.session += 1;
    showPlate(false);
    $('about').hidden = true;
  },
  finish() {
    state.session += 1;
    showPlate(false);
    showMessage(null);
  },
  skyGoTo: (ra, dec, fov) => sky?.flyTo(ra, dec, fov),
  open: (key) => openTarget(state.presets.find((item) => item.key === key)),
  frameCount: () => state.frames.length,
  visitCount: () => state.visits.length,
  setBand,
  setMode,
  setPlaying,
  spectrumOfTarget,
  measureMotion,
  async showWise() {
    $('wise').checked = true;
    await toggleWise();
    setPlaying(true);
  },
};

// ---------- Start ----------

function bindControls() {
  $('search').addEventListener('submit', (event) => {
    event.preventDefault();
    showMessage(null);
    search($('search-input').value).catch((error) => showMessage(error.message));
  });
  $('play').addEventListener('click', () => setPlaying(!state.playing));
  $('modes').addEventListener('click', (event) => event.target.dataset.mode && setMode(event.target.dataset.mode));
  $('composite').addEventListener('click', () => setBand({ kind: 'composite' }));
  $('band').addEventListener('input', () => setBand({ kind: 'channel', channel: Number($('band').value) }));
  $('fov').addEventListener('change', () => openTarget(state.target, Number($('fov').value)));
  $('gaia').addEventListener('change', toggleGaia);
  $('wise').addEventListener('change', toggleWise);
  $('flags').addEventListener('change', () => {
    state.excludeFlags = $('flags').checked;
    render();
  });
  $('plate').addEventListener('click', pickFromPlate);
  $('measure').addEventListener('click', measureMotion);
  $('chart-kind').addEventListener('click', (event) => {
    if (!event.target.dataset.chart) return;
    state.chart = event.target.dataset.chart;
    drawChart();
  });
  $('back-to-sky').addEventListener('click', () => {
    state.session += 1;
    showPlate(false);
  });
  $('language').addEventListener('click', toggleLanguage);
  $('tour').addEventListener('click', () => runTour(demoActions, $('tour')));
  $('hero-tour').addEventListener('click', () => runTour(demoActions, $('tour')));
  $('open-here').addEventListener('click', () => {
    const { ra, dec } = sky.selected();
    openTarget(customTarget(ra, dec));
  });
}

function translate() {
  applyTranslations();
  $('language').textContent = currentLanguage() === 'ru' ? 'EN' : 'RU';
  $('play').textContent = t(state.playing ? 'pause' : 'play');
}

function toggleLanguage() {
  setLanguage(currentLanguage() === 'ru' ? 'en' : 'ru');
  translate();
  buildLanding();
  if (!state.job) return;
  describeTarget(state.target);
  renderDates();
  render();
  drawChart();
  reportProgress(state.job);
}

const PRESET_BAND = { barnard: 1.4, wise0855: 4.7, epsindib: 2.2, rwaur: 0.9, rdra: 3.4 };
const BLINK_MS = 900;

/** A looping pair of real plates; which one shows is driven by one attribute on the body. */
function blinkTile(key, thumbs) {
  const tile = document.createElement('div');
  tile.className = 'blink';
  thumbs.frames.forEach((frame, index) => {
    const side = index ? 'b' : 'a';
    const image = document.createElement('img');
    image.src = `data/${key}/${frame.file}`;
    image.alt = '';
    image.className = `plate-${side}`;
    const label = document.createElement('b');
    label.className = `label-${side}`;
    label.textContent = frame.label;
    tile.style.setProperty(`--${side}x`, `${frame.x * 100}%`);
    tile.style.setProperty(`--${side}y`, `${frame.y * 100}%`);
    tile.append(image, label);
  });
  const ring = document.createElement('i');
  ring.className = 'ring';
  tile.append(ring);
  return tile;
}

function startBlinking() {
  setInterval(() => {
    document.body.dataset.blink = document.body.dataset.blink === 'b' ? 'a' : 'b';
  }, BLINK_MS);
}

function resultOf(key) {
  return state.results.find((item) => item.key === key);
}

function presetCard(preset) {
  const result = resultOf(preset.key);
  const button = document.createElement('button');
  button.type = 'button';
  button.style.setProperty('--tint', wavelengthColor(PRESET_BAND[preset.key]).join(', '));
  const name = document.createElement('strong');
  name.textContent = preset.name;
  const hook = document.createElement('small');
  hook.textContent = t(`hook_${preset.key}`);
  const words = document.createElement('span');
  words.className = 'card-words';
  words.append(name, hook);
  button.replaceChildren(...(result?.thumbs ? [blinkTile(preset.key, result.thumbs)] : []), words);
  button.addEventListener('click', () => diveInto(preset));
  return button;
}

function buildPresets() {
  $('presets').replaceChildren(...state.presets.map(presetCard));
}

function buildProof() {
  const hero = resultOf('wise0855');
  if (hero?.thumbs) $('proof-plate').replaceChildren(blinkTile('wise0855', hero.thumbs));
  $('proof').hidden = !hero?.thumbs;
}

const number = (value, digits = 2) =>
  new Intl.NumberFormat(currentLanguage(), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);

function resultRow(preset) {
  const result = resultOf(preset.key);
  const row = document.createElement('tr');
  const brightness = result.variability && result.variability.faintest > 0
    ? t('timesBrighter', { ratio: number(result.variability.brightest / result.variability.faintest, 1) })
    : t('noneMeasured');
  const cells = [
    preset.name,
    `${result.frames} / ${result.available}`,
    String(result.dates),
    `${number(result.measured)} ± ${number(result.error)}`,
    result.catalog === null ? t('noneMeasured') : number(result.catalog),
    result.control === null ? t('noneMeasured') : number(result.control),
    brightness,
  ];
  for (const text of cells) {
    const cell = row.insertCell();
    cell.textContent = text;
  }
  return row;
}

function buildResults() {
  $('results-body').replaceChildren(...state.results.flatMap((result) => {
    const preset = state.presets.find((item) => item.key === result.key);
    return preset ? [resultRow(preset)] : [];
  }));
}

function buildLanding() {
  buildPresets();
  buildProof();
  buildResults();
}

async function start() {
  setLanguage(currentLanguage());
  translate();
  buildBandScale();
  bindControls();
  setPressed($('modes'), 'mode', 'video');
  setPressed($('chart-kind'), 'chart', 'spectrum');
  $('composite').setAttribute('aria-pressed', 'true');
  state.presets = await api.getTargets();
  state.results = await api.getResults().catch(() => []);
  buildLanding();
  startBlinking();
  openFromUrl();
  sky = await createSky('sky', (ra, dec) => {
    $('open-here').hidden = false;
    $('open-here').textContent = `${t('openHere')}: ${ra.toFixed(2)}, ${dec.toFixed(2)}`;
  });
}

start().catch((error) => showMessage(error.message));
