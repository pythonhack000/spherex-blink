// Zoom and pan state of the plate, as pure maths on plate pixel coordinates.
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const ZOOM_STEP = 1.2;

/** The whole plate, centred. Coordinates here run 0..size across pixel edges. */
export function fullView(size) {
  return { zoom: 1, x: size / 2, y: size / 2 };
}

function clampCentre(value, size, zoom) {
  const half = size / zoom / 2;
  return Math.min(size - half, Math.max(half, value));
}

/** Zooms about a plate position, which stays under the cursor. */
export function zoomAt(view, size, plateX, plateY, wheelDelta) {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * (wheelDelta < 0 ? ZOOM_STEP : 1 / ZOOM_STEP)));
  const ratio = view.zoom / zoom;
  return {
    zoom,
    x: clampCentre(plateX + (view.x - plateX) * ratio, size, zoom),
    y: clampCentre(plateY + (view.y - plateY) * ratio, size, zoom),
  };
}

/** Pans by a distance in plate pixels. */
export function panBy(view, size, dx, dy) {
  return { ...view, x: clampCentre(view.x - dx, size, view.zoom), y: clampCentre(view.y - dy, size, view.zoom) };
}

/** Edge-based plate position under a fractional canvas position (y grows north). */
export function canvasToPlate(view, size, fractionX, fractionY) {
  const span = size / view.zoom;
  return { x: view.x - span / 2 + fractionX * span, y: view.y + span / 2 - fractionY * span };
}

/** Canvas pixels of a plate pixel whose centre is at integer (x, y). */
export function plateToCanvas(view, size, canvasSize, x, y) {
  const span = size / view.zoom;
  const scale = canvasSize / span;
  return { x: (x + 0.5 - (view.x - span / 2)) * scale, y: (view.y + span / 2 - (y + 0.5)) * scale };
}
