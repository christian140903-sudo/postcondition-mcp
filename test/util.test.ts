import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, newId, parseJsonPointer, safeUrl, sha256 } from '../src/util.js';

test('canonicalJson sorts object keys recursively', () => {
  assert.equal(canonicalJson({ z: 1, a: { y: 2, b: 3 } }), '{"a":{"b":3,"y":2},"z":1}');
});

test('canonicalJson preserves array order', () => {
  assert.equal(canonicalJson([3, { b: 2, a: 1 }]), '[3,{"a":1,"b":2}]');
});

test('canonicalJson rejects undefined and non-finite numbers', () => {
  assert.throws(() => canonicalJson(undefined), /not JSON-compatible/);
  assert.throws(() => canonicalJson(Number.NaN), /finite JSON numbers/);
});

test('sha256 is deterministic', () => {
  assert.equal(sha256('hello'), '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
});

test('newId adds the prefix and produces different ids', () => {
  const a = newId('pc');
  const b = newId('pc');
  assert.match(a, /^pc_[a-f0-9]{20}$/);
  assert.notEqual(a, b);
});

test('parseJsonPointer resolves and unescapes path segments', () => {
  const input = { 'a/b': { '~key': [1, 2] } };
  assert.deepEqual(parseJsonPointer(input, '/a~1b/~0key'), [1, 2]);
});

test('parseJsonPointer returns the whole document for the empty pointer', () => {
  const input = { ok: true };
  assert.equal(parseJsonPointer(input, ''), input);
});

test('parseJsonPointer rejects malformed pointers', () => {
  assert.throws(() => parseJsonPointer({}, 'missing-slash'), /must be empty or start/);
});

test('safeUrl strips credentials, query strings, and fragments', () => {
  assert.equal(safeUrl('https://user:secret@example.com/path?token=secret#part'), 'https://example.com/path');
});
