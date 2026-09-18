import assert from 'node:assert/strict';
import { test } from 'node:test';
import { batchMissing, missingText } from '../dist/batch.js';

test('il campo API prevale sul legacy_id della carta tornata e conserva il suggerimento', () => {
  const body = {
    data: [{ id: 'ssp-116', legacy_id: 'sv8-116' }], requested: 2, found: 1,
    missing: [{ id: 'sv8-116', suggested_id: 'ssp-116' }],
  };
  const missing = batchMissing(['sv8-116', 'ssp-116'], body);
  assert.deepEqual(missing, body.missing);
  assert.equal(missingText(missing), '\n\nNot found: sv8-116 (use ssp-116)');
});

test('batch misto con suggerimento e id inesistente', () => {
  const body = {
    data: [{ id: 'sv8-100' }], requested: 3, found: 1,
    missing: [{ id: 'sv8-116', suggested_id: 'ssp-116' }, { id: 'inventato-xyz' }],
  };
  const missing = batchMissing(['sv8-116', 'sv8-100', 'inventato-xyz'], body);
  assert.deepEqual(missing, body.missing);
  assert.equal(missingText(missing), '\n\nNot found: sv8-116 (use ssp-116), inventato-xyz');
});

test('API precedente: alias, spazi, maiuscole e duplicati senza suggerimenti inventati', () => {
  const body = { data: [{ id: 'bs-4', legacy_id: 'base1-4' }], requested: 6, found: 1 };
  assert.deepEqual(batchMissing(['BASE1-4', ' bs-4 ', ' BS-4 ', ' inventato ', 'INVENTATO', ''], body), [{ id: 'inventato' }]);
});

test('nessun mancante anche quando requested supera found per alias o ripetizioni', () => {
  const body = { data: [{ id: 'bs-4', legacy_id: 'base1-4' }], requested: 3, found: 1 };
  const missing = batchMissing(['base1-4', 'bs-4', 'BS-4'], body);
  assert.deepEqual(missing, []);
  assert.equal(missingText(missing), '');
});

test('un array API vuoto esplicito resta autorevole', () => {
  assert.deepEqual(batchMissing(['x'], { data: [], requested: 1, found: 0, missing: [] }), []);
});
