// The all-sky map, using Aladin Lite with AllWISE tiles proxied by our own server.
const ALADIN_URL = 'https://cdn.jsdelivr.net/npm/aladin-lite@3.8.2/dist/aladin.js';
const WHOLE_SKY_FOV = 240;
const DIVE_SECONDS = 3;

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
    survey: `${location.origin}/hips`,
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
