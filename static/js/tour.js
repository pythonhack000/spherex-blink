// The guided demo: a scripted walk through the five moments of the pitch.
import { t } from './i18n.js';

const FRAME_WAIT_MS = 45000;
const POLL_MS = 400;
const BAND_STEP_MS = 90;
const CHANNELS = 102;
const WHOLE_SKY_FOV = 200;
const SKY_MS = 4000;
const CLOSE_UP_FOV = 1;
const MIN_FRAMES = 6;
const BARNARD = { ra: 269.4465, dec: 4.7687 };

let activeRun = null;

class Stopped extends Error {}

function sleeper(run) {
  return (milliseconds) =>
    new Promise((resolve, reject) => {
      setTimeout(() => (run.stopped ? reject(new Stopped()) : resolve()), milliseconds);
    });
}

async function waitForFrames(actions, sleep) {
  const started = Date.now();
  while (Date.now() - started < FRAME_WAIT_MS) {
    if (actions.visitCount() >= 2 && actions.frameCount() >= MIN_FRAMES) return;
    await sleep(POLL_MS);
  }
}

async function showSky(actions, sleep) {
  actions.showSky();
  actions.caption(t('captionSky'));
  await actions.skyGoTo(BARNARD.ra, BARNARD.dec, WHOLE_SKY_FOV);
  await sleep(SKY_MS);
  await actions.skyGoTo(BARNARD.ra, BARNARD.dec, CLOSE_UP_FOV);
}

async function showBarnard(actions, sleep) {
  actions.caption(t('captionBarnard'));
  actions.open('barnard');
  await sleep(500);
  await waitForFrames(actions, sleep);
  actions.setPlaying(true);
  await sleep(9000);
}

async function sweepBands(actions, sleep) {
  actions.caption(t('captionBands'));
  actions.setMode('sum');
  for (let channel = 0; channel < CHANNELS; channel += 1) {
    actions.setBand({ kind: 'channel', channel });
    await sleep(BAND_STEP_MS);
  }
  actions.setBand({ kind: 'composite' });
  actions.setMode('video');
}

async function showSpectrum(actions, sleep) {
  actions.caption(t('captionSpectrum'));
  await actions.spectrumOfTarget();
  await sleep(6000);
}

async function showWise(actions, sleep) {
  actions.caption(t('captionWise'));
  actions.open('wise0855');
  await sleep(500);
  await waitForFrames(actions, sleep);
  actions.setBand({ kind: 'detector', detector: 6 });
  actions.setPlaying(true);
  await sleep(7000);
  actions.caption(t('captionWiseMotion'));
  actions.setBand({ kind: 'composite' });
  await actions.measureMotion();
  await sleep(7000);
  actions.caption(t('captionWise2010'));
  await actions.showWise();
  await sleep(9000);
  actions.caption(t('captionEnd'));
  await sleep(5000);
}

/** Starts the demo, or stops it if it is already running. */
export async function runTour(actions, button) {
  if (activeRun) {
    activeRun.stopped = true;
    return;
  }
  const run = { stopped: false };
  activeRun = run;
  button.textContent = t('stopTour');
  const sleep = sleeper(run);
  try {
    await showSky(actions, sleep);
    await showBarnard(actions, sleep);
    await sweepBands(actions, sleep);
    await showSpectrum(actions, sleep);
    await showWise(actions, sleep);
  } catch (error) {
    if (!(error instanceof Stopped)) actions.caption(error.message);
  } finally {
    activeRun = null;
    button.textContent = t('tour');
    if (run.stopped) actions.caption(null);
  }
}
