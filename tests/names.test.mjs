import test from 'node:test';
import assert from 'node:assert/strict';
import { findByName, suggestions } from '../static/js/names.js';

const presets = [{ key: 'm31', name: 'Andromeda Galaxy', ru: 'Галактика Андромеды', aliases: ['m31', 'andromeda', 'андромеда'] }];

test('finds objects by English, Russian and catalogue names', () => {
  assert.equal(findByName('Андромеда', presets).key, 'm31');
  assert.equal(findByName('M31', presets).key, 'm31');
  assert.equal(findByName('andromeda galaxy', presets).key, 'm31');
  assert.equal(findByName('Вега', presets).name, 'Vega');
  assert.equal(findByName('vega', presets).name, 'Vega');
});

test('tolerates case, spacing, apostrophes and ё', () => {
  assert.equal(findByName('  BODES   galaxy ', presets).aliases[0], 'm81');
  assert.equal(findByName('Туманность Кольцо', presets).aliases[0], 'm57');
});

test('prefers an exact name over a partial one', () => {
  assert.equal(findByName('m1', presets).name, 'Crab Nebula');
});

test('returns null for unknown or too short text', () => {
  assert.equal(findByName('qqqzzz', presets), null);
  assert.equal(findByName('a', presets), null);
});

test('suggestions follow the language', () => {
  assert.ok(suggestions(presets, 'ru').includes('Галактика Андромеды'));
  assert.ok(suggestions(presets, 'en').includes('Andromeda Galaxy'));
});
