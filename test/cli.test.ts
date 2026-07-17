import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../src/index.js', import.meta.url));

function run(args: string[], db: string) {
  return spawnSync(process.execPath, [entry, ...args], {
    encoding: 'utf8',
    env: { ...process.env, POSTCONDITION_DB: db },
    timeout: 10_000,
  });
}

test('CLI reports help and version', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'postcondition-cli-'));
  const db = join(dir, 'db.sqlite');
  const help = run(['help'], db);
  const version = run(['--version'], db);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /outcome verification/);
  assert.equal(version.stdout.trim(), '0.1.0');
});

test('CLI define, check, get, list, and status share durable state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'postcondition-cli-'));
  const db = join(dir, 'db.sqlite');
  const marker = join(dir, 'marker.txt');
  await writeFile(marker, 'ready');
  const input = JSON.stringify({
    statement: 'The CLI fixture marker exists',
    verifier: { kind: 'file', path: marker, check: { op: 'exists' } },
  });
  const defined = run(['define', '--json', input], db);
  assert.equal(defined.status, 0, defined.stderr);
  const id = JSON.parse(defined.stdout).contract.id as string;
  const checked = run(['check', id], db);
  assert.equal(JSON.parse(checked.stdout).observation.verdict, 'satisfied');
  assert.equal(JSON.parse(run(['get', id], db).stdout).contract.state, 'satisfied');
  assert.equal(JSON.parse(run(['list', '--state', 'satisfied'], db).stdout).contracts.length, 1);
  assert.equal(JSON.parse(run(['status'], db).stdout).ledger.valid, true);
});

test('CLI accepts contract JSON from a file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'postcondition-cli-'));
  const db = join(dir, 'db.sqlite');
  const contractFile = join(dir, 'contract.json');
  await writeFile(contractFile, JSON.stringify({
    statement: 'A reviewer must inspect the result',
    verifier: { kind: 'manual', instructions: 'Inspect it.' },
  }));
  const result = run(['define', '--file', contractFile], db);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).contract.state, 'pending');
});

test('CLI rejects unknown commands with a nonzero exit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'postcondition-cli-'));
  const result = run(['does-not-exist'], join(dir, 'db.sqlite'));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown command/);
});
