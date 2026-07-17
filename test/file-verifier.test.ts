import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyFile } from '../src/verifiers/file.js';
import { sha256 } from '../src/util.js';

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'postcondition-file-'));
  const text = join(dir, 'note.txt');
  const json = join(dir, 'data.json');
  await writeFile(text, 'proof lives here\n', 'utf8');
  await writeFile(json, JSON.stringify({ release: { version: '1.2.3', ready: true } }), 'utf8');
  return { dir, text, json, missing: join(dir, 'missing.txt') };
}

test('file exists and not_exists checks distinguish world state', async () => {
  const f = await fixture();
  assert.equal((await verifyFile({ kind: 'file', path: f.text, check: { op: 'exists' } })).verdict, 'satisfied');
  assert.equal((await verifyFile({ kind: 'file', path: f.text, check: { op: 'not_exists' } })).verdict, 'violated');
  assert.equal((await verifyFile({ kind: 'file', path: f.missing, check: { op: 'not_exists' } })).verdict, 'satisfied');
  assert.equal((await verifyFile({ kind: 'file', path: f.missing, check: { op: 'exists' } })).verdict, 'violated');
});

test('file size checks return satisfied and violated', async () => {
  const f = await fixture();
  assert.equal((await verifyFile({ kind: 'file', path: f.text, check: { op: 'min_size', bytes: 2 } })).verdict, 'satisfied');
  assert.equal((await verifyFile({ kind: 'file', path: f.text, check: { op: 'min_size', bytes: 10_000 } })).verdict, 'violated');
  assert.equal((await verifyFile({ kind: 'file', path: f.text, check: { op: 'max_size', bytes: 10_000 } })).verdict, 'satisfied');
  assert.equal((await verifyFile({ kind: 'file', path: f.text, check: { op: 'max_size', bytes: 2 } })).verdict, 'violated');
});

test('contains check does not echo the expected text into evidence', async () => {
  const f = await fixture();
  const result = await verifyFile({ kind: 'file', path: f.text, check: { op: 'contains', text: 'proof lives' } });
  assert.equal(result.verdict, 'satisfied');
  assert.equal(JSON.stringify(result.evidence).includes('proof lives'), false);
  assert.match(String(result.evidence.expectedTextSha256), /^[a-f0-9]{64}$/);
});

test('contains check detects absent text', async () => {
  const f = await fixture();
  assert.equal((await verifyFile({ kind: 'file', path: f.text, check: { op: 'contains', text: 'not present' } })).verdict, 'violated');
});

test('sha256 check compares the complete file', async () => {
  const f = await fixture();
  const expected = sha256('proof lives here\n');
  assert.equal((await verifyFile({ kind: 'file', path: f.text, check: { op: 'sha256', equals: expected } })).verdict, 'satisfied');
  assert.equal((await verifyFile({ kind: 'file', path: f.text, check: { op: 'sha256', equals: '0'.repeat(64) } })).verdict, 'violated');
});

test('JSON pointer check supports nested values', async () => {
  const f = await fixture();
  const result = await verifyFile({ kind: 'file', path: f.json, check: { op: 'json_equals', pointer: '/release/version', value: '1.2.3' } });
  assert.equal(result.verdict, 'satisfied');
});

test('a missing JSON pointer is a violation with explicit missing evidence', async () => {
  const f = await fixture();
  const result = await verifyFile({ kind: 'file', path: f.json, check: { op: 'json_equals', pointer: '/release/missing', value: true } });
  assert.equal(result.verdict, 'violated');
  assert.equal(result.evidence.found, false);
});

test('invalid JSON produces unknown rather than a false violation', async () => {
  const f = await fixture();
  const result = await verifyFile({ kind: 'file', path: f.text, check: { op: 'json_equals', pointer: '/release', value: true } });
  assert.equal(result.verdict, 'unknown');
});

test('content checks on directories produce unknown', async () => {
  const f = await fixture();
  await mkdir(join(f.dir, 'folder'));
  const result = await verifyFile({ kind: 'file', path: join(f.dir, 'folder'), check: { op: 'contains', text: 'x' } });
  assert.equal(result.verdict, 'unknown');
});

test('large files require digest checks for content inspection', async () => {
  const f = await fixture();
  const large = join(f.dir, 'large.bin');
  await writeFile(large, '');
  await truncate(large, 16 * 1024 * 1024 + 1);
  const result = await verifyFile({ kind: 'file', path: large, check: { op: 'contains', text: 'x' } });
  assert.equal(result.verdict, 'unknown');
  assert.equal(result.evidence.error, 'inspection_limit');
});
