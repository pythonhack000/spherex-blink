// Application state and wiring between the sky map, plate, charts and controls.
import * as api from './api.js';
import { drawLightCurve, drawSpectrum, drawWingCurve } from './chart.js';
import { isSaturated, measureMotion as trackMotion, measureSpectrum as photometry } from './science.js';
import { applyTranslations, currentLanguage, setLanguage, t } from './i18n.js';
import {
  drawPlate, limitsFor, paintComposite, paintDifference, paintMono, stacksFor, StackCache, tintFor,
} from './plate.js';
import { createSky } from './sky.js';
import { canvasToPlate, fullView, panBy, zoomAt } from './viewport.js';
import {
  channelWavelength, CHANNELS, DETECTOR_RANGES, detectorOfChannel, mjdToDate, mjdToYear, pixelToSky, positionAt, resolveBand, selectBand, skyToPixel,
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
const DRAG_THRESHOLD_PX = 4;
const FILM_TILE_DELAY_MS = 30;
const FILM_FIRST_DELAY_MS = 120;
const FOLLOW_ZOOM = 1.5;
const GAIA_EPOCH = 2016;
const EDGE_PX = 6;
const CANDIDATES_FAST = 3;
const CANDIDATES_BRIGHT = 5;
const CANDIDATE_HIT_PX = 6;
const SAME_OBJECT_DEG = 0.004;
const FAST_MOVER_MAS = 1000;
// The long-wavelength array with the best date coverage for each variable star.
const CURVE_ARRAYS = { rwaur: 5, rdra: 4 };
const SWEEP_MS = 9000;
const TRACK_MATCH_YEARS = 0.02;
const MEASURE_DELAY_MS = 350;
const DIVE_FOV = 0.4;
const ARRAY_CANVAS_SIZE = 420;
const FILM_CANVAS_SIZE = 160;
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
  view: 'one',
  follow: false,
  lock: null,
  picking: false,
  candidates: null,
  compare: { a: 0, b: 0, next: 'a' },
  plateView: { zoom: 1, x: 60, y: 60 },
  session: 0,
  auto: { spectrum: false, final: false },
};

let playTimer = null;
let filmGeneration = 0;
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

/** With the camera tied to an object, each date is centred on where that object is then. */
function viewFor(step) {
  if (!state.follow || !state.job) return state.plateView;
  const object = state.lock ?? state.target;
  const year = step ? yearOf(step) : midYear();
  const measured = state.track?.find((point) => Math.abs(point.year - year) < TRACK_MATCH_YEARS);
  const { ra, dec } = positionAt({ ...motionOf(object), ...object }, year);
  const { x, y } = measured ?? skyToPixel(ra, dec, state.job);
  return { zoom: FOLLOW_ZOOM, x: x + 0.5, y: y + 0.5 };
}

function overlayFor(step, extra = {}) {
  return {
    grid: state.job,
    year: step ? yearOf(step) : midYear(),
    target: followedObject(),
    candidates: state.picking ? state.candidates : null,
    gaia: $('gaia').checked ? state.gaia : null,
    track: state.track,
    pick: state.pick,
    view: viewFor(step),
    ...extra,
  };
}

function stepLabel(step) {
  if (!step) return t('allDates');
  return step.key === WISE_STEP ? 'AllWISE 2010' : formatDate(mjdToDate(step.mjd));
}

function render() {
  if (!state.job) return;
  const size = state.job.n;
  const step = currentStep();
  const comparing = state.view === 'compare';
  const left = comparing ? compareStep(state.compare.a) : step;
  const shown = paintStep(left, size, state.band);
  $('plate-empty').hidden = shown || !state.frames.length;
  $('plate-empty').textContent = t('noFrames');
  drawPlate($('plate'), buffer, overlayFor(left));
  $('plate-date').textContent = stepLabel(left);
  $('second-frame').hidden = !comparing;
  $('arrays').hidden = comparing;
  if (comparing) renderSecond(size);
  else renderArrays(left, size);
  document.body.dataset.layout = state.view;
  describeStep(left);
  $('explain').textContent = explainNow();
  markFilm();
  paintAmbient();
}

function compareStep(index) {
  const steps = sequence();
  return steps.length ? steps[Math.min(index, steps.length - 1)] : null;
}

function renderSecond(size) {
  const right = compareStep(state.compare.b);
  paintStep(right, size, state.band);
  drawPlate($('plate-b'), buffer, overlayFor(right));
  $('plate-date-b').textContent = stepLabel(right);
}

/** Six live plates, one per detector array, for the date on the main plate. */
function renderArrays(step, size) {
  const available = step?.key === WISE_STEP ? null : step;
  for (const tile of $('arrays').children) {
    const band = { kind: 'detector', detector: Number(tile.dataset.detector) };
    const painted = paintStep(available, size, band);
    if (painted) drawPlate(tile.querySelector('canvas'), buffer, overlayFor(available, { bare: true }));
    tile.classList.toggle('empty', !painted);
    tile.setAttribute(
      'aria-pressed',
      String(state.band.kind === 'detector' && state.band.detector === band.detector),
    );
  }
}

function buildArrays() {
  const tiles = Object.entries(DETECTOR_RANGES).map(([detector, [low, high]]) => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.dataset.detector = detector;
    const color = wavelengthColor(Math.sqrt(low * high)).join(', ');
    tile.style.setProperty('--tint', color);
    const canvas = document.createElement('canvas');
    canvas.width = ARRAY_CANVAS_SIZE;
    canvas.height = ARRAY_CANVAS_SIZE;
    const label = document.createElement('b');
    label.textContent = `${low}–${high} μm`;
    tile.append(canvas, label);
    tile.addEventListener('click', () => {
      const same = state.band.kind === 'detector' && state.band.detector === Number(detector);
      setBand(same ? { kind: 'composite' } : { kind: 'detector', detector: Number(detector) });
    });
    return tile;
  });
  $('arrays').replaceChildren(...tiles);
}

/** The page's background glow is the current picture itself, heavily blurred. */
function paintAmbient() {
  const ambient = $('ambient');
  ambient.getContext('2d').drawImage($('plate'), 0, 0, ambient.width, ambient.height);
}

/** Painting is the slow part, so finished pictures are kept and only copied afterwards. */
function paintStep(step, size, wanted) {
  const key = `painted|${step?.key ?? ALL_DATES}|${wanted.kind}${wanted.detector ?? wanted.channel ?? ''}|${state.mode}|${state.excludeFlags}`;
  const stored = cache.entries.get(key);
  if (stored !== undefined) {
    if (stored) copyCanvas(stored, buffer);
    return Boolean(stored);
  }
  const shown = paintFresh(step, size, wanted);
  const copy = shown ? document.createElement('canvas') : null;
  if (copy) copyCanvas(buffer, copy);
  cache.entries.set(key, copy);
  return shown;
}

function copyCanvas(from, to) {
  to.width = from.width;
  to.height = from.height;
  to.getContext('2d').drawImage(from, 0, 0);
}

function paintFresh(step, size, wanted) {
  if (step?.key === WISE_STEP) return paintWise(step, size);
  if (state.mode === 'diff') return paintDiffStep(step, size, wanted);
  const frames = step ? step.frames : state.frames;
  const band = resolveBand(frames, wanted);
  if (!selectBand(frames, band).length) return false;
  const key = step ? `v${step.key}` : ALL_DATES;
  const stacks = stacksFor(frames, band, size, state.excludeFlags, cache, key);
  if (stacks.image) paintMono(buffer, size, stacks.image, sharedLimits(size, band), tintFor(band));
  else paintComposite(buffer, size, stacks, sharedLimits(size, band));
  return true;
}

/** One stretch for every date, so brightness changes between frames are real. */
function sharedLimits(size, band) {
  const bandKey = `${band.kind}${band.detector ?? band.channel ?? ''}`;
  return cache.get(`limits|${bandKey}|${state.excludeFlags}`, () =>
    limitsFor(stacksFor(state.frames, band, size, state.excludeFlags, cache, ALL_DATES)));
}

function paintWise(step, size) {
  const image = step.frames[0].pixels;
  paintMono(buffer, size, image, limitsFor({ image }), tintFor({ kind: 'detector', detector: 6 }));
  return true;
}

function paintDiffStep(step, size, wanted) {
  const band = wanted.kind === 'composite' ? { kind: 'all' } : wanted;
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
  const pool = step ? step.frames : state.frames;
  const frames = selectBand(pool, resolveBand(pool, state.band));
  const flagged = frames.length ? frames.reduce((sum, item) => sum + item.flaggedPct, 0) / frames.length : 0;
  const parts = [
    finishedMessage(state.job), t('frames', { count: frames.length }), t('flagged', { pct: flagged.toFixed(1) }),
  ].filter(Boolean);
  if (state.mode === 'diff') parts.push(t('differenceLegend'));
  else if (state.target?.pmra || state.target?.pmdec) parts.push(t('expected'));
  $('plate-info').textContent = parts.join('. ');
}

function explainNow() {
  if (!state.target) return '';
  if (state.view === 'compare') return t('explainCompare');
  if (state.mode === 'diff') return t('explainDiff');
  if (state.picking) return t('explainChoose');
  if (state.follow) return t('explainFollow');
  if (state.mode === 'sum') return t('explainSum');
  if (state.band.kind !== 'composite') return t('explainBand');
  return t(Math.hypot(state.target.pmra ?? 0, state.target.pmdec ?? 0) > FAST_MOVER_MAS ? 'explainMover' : 'explainVideo');
}

// ---------- Controls ----------

function setPressed(container, attribute, value) {
  for (const button of container.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset[attribute] === String(value)));
  }
}

function filmTile(step, position) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'film-tile';
  button.dataset.position = String(position);
  const canvas = document.createElement('canvas');
  canvas.width = FILM_CANVAS_SIZE;
  canvas.height = FILM_CANVAS_SIZE;
  const label = document.createElement('span');
  label.textContent = stepLabel(step);
  button.append(canvas, label);
  button.addEventListener('click', () => pickFilm(position));
  return { button, canvas, step };
}

function paintFilmTile({ canvas, step }) {
  const saved = document.createElement('canvas');
  copyCanvas(buffer, saved);
  if (paintStep(step, state.job.n, { kind: 'composite' })) drawPlate(canvas, buffer, { grid: state.job, bare: true });
  copyCanvas(saved, buffer);
}

/** The strip is laid out at once in date order; its pictures fill in one per tick. */
function renderDates() {
  filmGeneration += 1;
  const generation = filmGeneration;
  if (!state.job) {
    $('dates').replaceChildren();
    return;
  }
  const tiles = [...sequence().map((step, index) => filmTile(step, index)), filmTile(null, ALL_DATES)];
  $('dates').replaceChildren(...tiles.map((tile) => tile.button));
  markFilm();
  tiles.forEach((tile, order) => {
    setTimeout(() => {
      if (generation === filmGeneration && state.job) paintFilmTile(tile);
    }, order * FILM_TILE_DELAY_MS + FILM_FIRST_DELAY_MS);
  });
}

function markFilm() {
  const comparing = state.view === 'compare';
  for (const tile of $('dates').children) {
    const position = tile.dataset.position === ALL_DATES ? ALL_DATES : Number(tile.dataset.position);
    const active = comparing
      ? position === state.compare.a || position === state.compare.b
      : position === state.position;
    tile.setAttribute('aria-pressed', String(active));
  }
}

/** In comparison, each pick replaces the plate that was not picked last. */
function pickFilm(position) {
  if (state.view !== 'compare') {
    selectPosition(position);
    return;
  }
  if (position === ALL_DATES) return;
  const side = state.compare.next;
  state.compare = { ...state.compare, [side]: position, next: side === 'a' ? 'b' : 'a' };
  render();
}

const followedObject = () => state.lock ?? state.target;

/** Ties the camera to an object. A year of SPHEREx moves a star little, so 2010 joins in. */
async function lockCamera(object) {
  state.lock = object;
  state.follow = true;
  state.picking = false;
  state.candidates = null;
  const sameAsTarget = object.key === state.target.key && Boolean(object.key);
  if (!sameAsTarget) state.track = null;
  if (state.view === 'compare') setView('one');
  if (state.mode !== 'video') setMode('video');
  if (state.staticMeta && !$('wise').checked && (object.pmra || object.pmdec)) {
    $('wise').checked = true;
    await toggleWise();
  }
  if (state.position === ALL_DATES) state.position = 0;
  setPlaying(true);
  measureSpectrum(object, null);
  if (!sameAsTarget) {
    $('motion-result').replaceChildren();
    $('measure').hidden = false;
  }
  refreshFollowUi();
  render();
}

function unlockCamera() {
  state.follow = false;
  state.lock = null;
  state.picking = false;
  state.candidates = null;
  refreshFollowUi();
  render();
}

/** Used by the guided demo: follow the main target, or stop. */
function setFollow(follow) {
  return follow ? lockCamera(targetAsObject()) : unlockCamera();
}

function targetAsObject() {
  return { ...state.target, short: state.target.name };
}

async function openChooser() {
  if (state.follow || state.picking) {
    unlockCamera();
    return;
  }
  if (!state.gaia.length && state.job) {
    try {
      state.gaia = state.staticMeta?.gaia ?? (await api.getGaia(state.job.ra, state.job.dec, state.job.fov));
    } catch {
      state.gaia = [];
    }
  }
  state.candidates = chooseCandidates();
  state.picking = true;
  setPlaying(false);
  if (state.position === ALL_DATES) state.position = 0;
  refreshFollowUi();
  render();
}

/** The target, the fastest catalogue stars and the brightest ones, without repeats. */
function chooseCandidates() {
  const mid = midYear();
  const onPlate = state.gaia.filter((star) => {
    const { x, y } = skyToPixel(star.ra, star.dec, state.job);
    return x > EDGE_PX && y > EDGE_PX && x < state.job.n - EDGE_PX && y < state.job.n - EDGE_PX && mid;
  });
  const speed = (star) => Math.hypot(star.pmra, star.pmdec);
  const fastest = [...onPlate].sort((first, second) => speed(second) - speed(first)).slice(0, CANDIDATES_FAST);
  const brightest = [...onPlate].sort((first, second) => first.g - second.g).slice(0, CANDIDATES_BRIGHT);
  const stars = [...new Set([...fastest, ...brightest])]
    .filter((star) => !isSameObject(star))
    .map((star, index) => ({
      ...star,
      epoch: GAIA_EPOCH,
      short: String(index + 1),
      name: t('gaiaStar', { g: number(star.g, 1), pm: number(speed(star) / 1000, 2) }),
    }));
  return [targetAsObject(), ...stars];
}

function isSameObject(star) {
  const target = positionAt(state.target, GAIA_EPOCH);
  return Math.hypot((star.ra - target.ra) * Math.cos((star.dec * Math.PI) / 180), star.dec - target.dec) < SAME_OBJECT_DEG;
}

function refreshFollowUi() {
  $('follow').textContent = t(state.follow || state.picking ? 'unlock' : 'tryFollow');
  $('follow').setAttribute('aria-pressed', String(state.follow || state.picking));
  document.body.classList.toggle('picking', state.picking);
  $('lock').hidden = !state.follow;
  $('lock').textContent = state.follow ? t('lockedOn', { name: followedObject().name }) : '';
  $('chooser').hidden = !state.picking;
  if (!state.picking) return;
  const chips = state.candidates.map((candidate, index) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.textContent = index ? `${candidate.short}. ${candidate.name}` : candidate.name;
    chip.addEventListener('click', () => lockCamera(candidate));
    return chip;
  });
  $('chooser-list').replaceChildren(...chips);
}

/** While choosing, a click takes the nearest mark, or else that exact point of the sky. */
function chooseAt(plate) {
  const year = midYear();
  const hit = state.candidates.find((candidate) => {
    const place = positionAt(candidate, year);
    const { x, y } = skyToPixel(place.ra, place.dec, state.job);
    return Math.hypot(x + 0.5 - plate.x, y + 0.5 - plate.y) < CANDIDATE_HIT_PX;
  });
  if (hit) {
    lockCamera(hit);
    return;
  }
  const { ra, dec } = pixelToSky(plate.x - 0.5, plate.y - 0.5, state.job);
  lockCamera({
    ra, dec, pmra: 0, pmdec: 0, epoch: GAIA_EPOCH, short: '',
    name: t('skyPoint', { ra: number(ra, 3), dec: number(dec, 3) }),
  });
}

async function compareWithPast() {
  if (state.staticMeta && !$('wise').checked) {
    $('wise').checked = true;
    await toggleWise();
  }
  setView('compare');
}

function sweepBands() {
  setView('one');
  setMode('sum');
  const started = performance.now();
  const session = state.session;
  const step = () => {
    const progress = (performance.now() - started) / SWEEP_MS;
    if (session !== state.session || state.mode !== 'sum') return;
    if (progress >= 1) {
      setBand({ kind: 'composite' });
      setMode('video');
      return;
    }
    setBand({ kind: 'channel', channel: Math.floor(progress * CHANNELS) });
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function setView(view) {
  state.view = view;
  setPressed($('views'), 'view', view);
  if (view === 'compare') {
    setPlaying(false);
    if (state.mode !== 'video') setMode('video');
    state.compare = { a: 0, b: Math.max(0, sequence().length - 1), next: 'a' };
  }
  render();
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
  if (band.kind === 'detector') {
    const [low, high] = DETECTOR_RANGES[band.detector];
    return wavelengthColor(Math.sqrt(low * high));
  }
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
    auto: { spectrum: false, final: false }, view: 'one', follow: false, lock: null, picking: false, candidates: null,
  });
  refreshFollowUi();
  cache.clear();
  resetPanels(target, fov);
  setPressed($('views'), 'view', 'one');
  const { ra, dec } = centreOf(target);
  sky?.goTo(ra, dec);
  writeUrl();
  try {
    if (target.key && fov === target.fov) await openStatic(target, session);
    else await openLive(ra, dec, fov, session);
  } catch {
    if (session === state.session) showLoadProblem(target, fov);
  }
}

function showLoadProblem(target, fov) {
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'glow';
  retry.textContent = t('retry');
  retry.addEventListener('click', () => openTarget(target, fov));
  const message = document.createElement('p');
  message.textContent = t('loadFailed');
  $('progress').replaceChildren(message, retry);
}

/** The challenge targets ship with the site, so they open at once with no server. */
async function openStatic(target, session) {
  const { meta, frames } = await api.getStaticTarget(target.key);
  if (session !== state.session) return;
  state.staticMeta = meta;
  state.job = { ...meta.grid, status: 'done', available: meta.available, total: meta.total, done: frames.length, failed: 0 };
  state.plateView = fullView(meta.grid.n);
  state.frames = frames;
  state.visits = visitsOf(frames);
  state.chart = target.kind === 'variable' ? 'curve' : 'spectrum';
  renderDates();
  setPlaying(true);
  render();
  reportProgress(state.job);
  setTimeout(() => {
    if (session === state.session) autoMeasure();
  }, MEASURE_DELAY_MS);
}

async function openLive(ra, dec, fov, session) {
  state.job = await api.observe(ra, dec, fov);
  if (session !== state.session) return;
  state.plateView = fullView(state.job.n);
  setPlaying(true);
  await followJob(session);
}

function resetPanels(target, fov) {
  showPlate(true);
  $('fov').value = String(fov);
  $('wise').checked = false;
  $('gaia').checked = false;
  $('motion-result').replaceChildren();
  $('measure').hidden = false;
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
    done: () => (status.available === 0 ? t('noCoverage') : ''),
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
  const shown = bandPoints(points);
  const useWings = isSaturated(shown);
  if (state.chart === 'spectrum') drawSpectrum($('chart'), points);
  else if (useWings) drawWingCurve($('chart'), shown);
  else drawLightCurve($('chart'), shown);
  $('chart-note').textContent = t(state.chart === 'curve' && useWings ? 'wingNote' : 'flaggedNote');
}

function bandPoints(points) {
  if (state.band.kind === 'composite') {
    const array = CURVE_ARRAYS[state.target?.key];
    return array ? points.filter((point) => point.detector === array) : points;
  }
  const detector = state.band.kind === 'channel' ? detectorOfChannel(state.band.channel) : state.band.detector;
  return points.filter((point) => point.detector === detector);
}

function plateFractions(canvas, event) {
  const box = canvas.getBoundingClientRect();
  return { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height };
}

function pickAt(canvas, event) {
  const fraction = plateFractions(canvas, event);
  const plate = canvasToPlate(viewFor(currentStep()), state.job.n, fraction.x, fraction.y);
  if (state.picking) {
    chooseAt(plate);
    return;
  }
  const position = pixelToSky(plate.x - 0.5, plate.y - 0.5, state.job);
  measureSpectrum(position, position);
}

/** Wheel zooms, dragging pans, a click measures the spot, a double click resets the view. */
function bindPlateGestures(canvas) {
  let drag = null;
  canvas.addEventListener('wheel', (event) => {
    if (!state.job) return;
    event.preventDefault();
    const fraction = plateFractions(canvas, event);
    const plate = canvasToPlate(state.plateView, state.job.n, fraction.x, fraction.y);
    state.plateView = zoomAt(state.plateView, state.job.n, plate.x, plate.y, event.deltaY);
    render();
  }, { passive: false });
  canvas.addEventListener('pointerdown', (event) => {
    drag = { x: event.clientX, y: event.clientY, moved: false };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drag || !state.job) return;
    const distance = Math.hypot(event.clientX - drag.x, event.clientY - drag.y);
    if (!drag.moved && distance < DRAG_THRESHOLD_PX) return;
    const box = canvas.getBoundingClientRect();
    const perPixel = state.job.n / state.plateView.zoom / box.width;
    state.plateView = panBy(state.plateView, state.job.n, (event.clientX - drag.x) * perPixel, (drag.y - event.clientY) * perPixel);
    drag = { x: event.clientX, y: event.clientY, moved: true };
    render();
  });
  canvas.addEventListener('pointerup', (event) => {
    if (drag && !drag.moved && state.job) pickAt(canvas, event);
    drag = null;
  });
  canvas.addEventListener('dblclick', () => {
    if (!state.job) return;
    state.plateView = fullView(state.job.n);
    render();
  });
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
  const floor = Math.max(result.controlMedian ?? Infinity, result.fit.totalErr);
  const real = result.fit.total > MOTION_SIGNIFICANCE * floor;
  const big = document.createElement('div');
  big.className = real ? 'big-number' : 'big-words';
  if (real) countUp(big, result.fit.total, unit);
  else big.textContent = t('notDetected');
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
  const summary = document.createElement('p');
  summary.textContent = `${t(real ? 'motionVerdict' : 'motionWeak')} ${t('motionBaseline', {
    count: result.visits.length, detectors: result.detectors.join(', '),
  })}`;
  $('motion-result').replaceChildren(big, table, summary);
  $('measure').hidden = true;
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
  setFollow,
  measureMotion,
  async showWise() {
    $('wise').checked = true;
    await toggleWise();
    setFollow(false);
    setView('compare');
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
  bindPlateGestures($('plate'));
  bindPlateGestures($('plate-b'));
  $('follow').addEventListener('click', openChooser);
  $('chooser-close').addEventListener('click', unlockCamera);
  $('try-compare').addEventListener('click', compareWithPast);
  $('try-bands').addEventListener('click', sweepBands);
  $('views').addEventListener('click', (event) => event.target.dataset.view && setView(event.target.dataset.view));
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
  if (state.candidates) state.candidates = chooseCandidates();
  refreshFollowUi();
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
  const brightness = result.variability?.faintest.level > 0
    ? t('timesBrighter', {
      ratio: number(result.variability.brightest.level / result.variability.faintest.level, 1),
      detector: result.variability.detector,
    })
    : t('noneMeasured');
  const cells = [
    preset.name,
    `${result.frames} / ${result.available}`,
    String(result.dates),
    result.measured > MOTION_SIGNIFICANCE * result.error
      ? `${number(result.measured)} ± ${number(result.error)}`
      : t('notDetected'),
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
  buildArrays();
  bindControls();
  setPressed($('modes'), 'mode', 'video');
  setPressed($('views'), 'view', 'one');
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
