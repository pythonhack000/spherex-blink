import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasToPlate, fullView, panBy, plateToCanvas, zoomAt } from '../static/js/viewport.js';

const near = (actual, expected, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not near ${expected}`);

test('the full view shows the whole plate with north up', () => {
  const view = fullView(120);
  const topLeft = canvasToPlate(view, 120, 0, 0);
  near(topLeft.x, 0);
  near(topLeft.y, 120);
  const bottomRight = canvasToPlate(view, 120, 1, 1);
  near(bottomRight.x, 120);
  near(bottomRight.y, 0);
});

test('canvas and plate conversions agree', () => {
  const view = { zoom: 3, x: 50, y: 70 };
  const canvas = plateToCanvas(view, 120, 900, 44.5, 66.5);
  const back = canvasToPlate(view, 120, canvas.x / 900, canvas.y / 900);
  near(back.x, 45);
  near(back.y, 67);
});

test('zooming keeps the point under the cursor in place', () => {
  const view = zoomAt(fullView(120), 120, 80, 40, -1);
  assert.ok(view.zoom > 1);
  const before = plateToCanvas(fullView(120), 120, 1000, 80, 40);
  const after = plateToCanvas(view, 120, 1000, 80, 40);
  near(after.x, before.x, 1.5);
  near(after.y, before.y, 1.5);
});

test('zoom stops at its limits', () => {
  assert.equal(zoomAt(fullView(120), 120, 60, 60, 1).zoom, 1);
  let view = fullView(120);
  for (let step = 0; step < 40; step += 1) view = zoomAt(view, 120, 60, 60, -1);
  assert.equal(view.zoom, 8);
});

test('panning cannot leave the plate', () => {
  const view = panBy({ zoom: 2, x: 60, y: 60 }, 120, 500, -500);
  near(view.x, 30);
  near(view.y, 90);
});
