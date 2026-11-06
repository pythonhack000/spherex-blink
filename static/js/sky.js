// The all-sky map, using Aladin Lite with AllWISE tiles proxied by our own server.
const WHOLE_SKY_FOV = 200;
const DIVE_SECONDS = 3;

/** Falls back to a passive object if the map library or WebGL is unavailable. */
export async function createSky(containerId, onSelect) {
  const unavailable = {
    goTo() {},
    async flyTo() {},
    refresh() {},
    selected: () => ({ ra: 0, dec: 0 }),
  };
  if (!window.A) return unavailable;
  await window.A.init;
  const map = window.A.aladin(`#${containerId}`, {
    survey: `${location.origin}/hips`,
    fov: WHOLE_SKY_FOV,
    projection: 'AIT',
    cooFrame: 'ICRSd',
    showReticle: true,
    showCooGrid: false,
    showFullscreenControl: false,
    showLayersControl: false,
    showGotoControl: false,
    showSimbadPointerControl: false,
    showShareControl: false,
    showProjectionControl: false,
    showFrame: false,
    showZoomControl: true,
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
      map.gotoRaDec(ra, dec);
      map.zoomToFoV?.(fov, DIVE_SECONDS);
      await new Promise((resolve) => setTimeout(resolve, DIVE_SECONDS * 1000));
    },
    refresh: () => window.dispatchEvent(new Event('resize')),
    selected: () => chosen,
  };
}
