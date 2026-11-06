// The all-sky map, using Aladin Lite with AllWISE tiles.
const ALADIN_URL = 'https://cdn.jsdelivr.net/npm/aladin-lite@3.8.2/dist/aladin.js';
const TILES_FROM_CDS = 'https://alasky.cds.unistra.fr/AllWISE/RGB-W4-W2-W1';
const PROBE_TIMEOUT_MS = 2500;
const WHOLE_SKY_FOV = 240;
const DIVE_SECONDS = 3;

/** CDS has every zoom level, but some networks cannot reach it; the site carries a coarse copy. */
async function chooseTiles() {
  try {
    const response = await fetch(`${TILES_FROM_CDS}/properties`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (response.ok) return TILES_FROM_CDS;
  } catch {
    // Unreachable from this network: use the copy below.
  }
  return new URL('data/sky', location.href).href.replace(/\/$/, '');
}

/** Falls back to a passive object if the map library or WebGL is unavailable. */
export async function createSky(containerId, onSelect) {
  const unavailable = {
    goTo() {},
    async flyTo() {},
    refresh() {},
    selected: () => ({ ra: 0, dec: 0 }),
  };
  let A;
  try {
    A = (await import(ALADIN_URL)).default;
    await A.init;
  } catch (error) {
    console.error('The sky map could not start:', error);
    return unavailable;
  }
  const map = A.aladin(`#${containerId}`, {
    survey: await chooseTiles(),
    fov: WHOLE_SKY_FOV,
    projection: 'AIT',
    cooFrame: 'GAL',
    showReticle: false,
    showCooLocation: false,
    showFov: false,
    showContextMenu: false,
    showStatusBar: false,
    showCooGrid: false,
    showFullscreenControl: false,
    showLayersControl: false,
    showGotoControl: false,
    showSimbadPointerControl: false,
    showShareControl: false,
    showProjectionControl: false,
    showFrame: false,
    showZoomControl: false,
  });
  let chosen = { ra: 0, dec: 0 };
  map.on('click', (event) => {
    if (event?.ra === undefined) return;
    chosen = { ra: event.ra, dec: event.dec };
    onSelect(event.ra, event.dec);
  });
  return {
    goTo: (ra, dec) => map.gotoRaDec(ra, dec),
    async flyTo(ra, dec, fov) {
      map.animateToRaDec?.(ra, dec, DIVE_SECONDS);
      map.zoomToFoV?.(fov, DIVE_SECONDS);
      await new Promise((resolve) => setTimeout(resolve, DIVE_SECONDS * 1000));
    },
    refresh: () => window.dispatchEvent(new Event('resize')),
    selected: () => chosen,
  };
}
