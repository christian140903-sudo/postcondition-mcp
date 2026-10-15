import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { copyFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const entry = fileURLToPath(new URL('../src/index.js', import.meta.url));
const exampleContract = fileURLToPath(new URL('../../examples/file-exists.json', import.meta.url));

function run(args: string[], db: string, cwd?: string) {
  return spawnSync(process.execPath, [entry, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, POSTCONDITION_DB: db },
    timeout: 10_000,
  });
}

function sql(db: string, statement: string): void {
  const handle = new Database(db);
  try {
    handle.prepare(statement).run();
  } finally {
    handle.close();
  }
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

test('CLI verify-ledger exits 0 for an intact chain and 1 after the README tamper step', async () => {
  // Same steps as "To watch the tamper check fail on purpose" in the README, run
  // from a scratch directory so ./dist/release.tgz from the example is absent.
  const dir = await mkdtemp(join(tmpdir(), 'postcondition-cli-'));
  const db = join(dir, 'demo.db');
  const defined = run(['define', '--file', exampleContract], db, dir);
  assert.equal(defined.status, 0, defined.stderr);
  const id = JSON.parse(defined.stdout).contract.id as string;

  const empty = run(['verify-ledger'], db, dir);
  assert.equal(empty.status, 0, empty.stderr);
  assert.deepEqual(JSON.parse(empty.stdout), { valid: true, checked: 0, firstInvalidId: null });

  const checked = run(['check', id], db, dir);
  assert.equal(checked.status, 0, checked.stderr);
  const observation = JSON.parse(checked.stdout).observation as { id: string; verdict: string };
  assert.equal(observation.verdict, 'violated');

  const intact = run(['verify-ledger'], db, dir);
  assert.equal(intact.status, 0, intact.stderr);
  assert.deepEqual(JSON.parse(intact.stdout), { valid: true, checked: 1, firstInvalidId: null });

  sql(db, "UPDATE observations SET verdict = 'satisfied'");
  const tampered = run(['verify-ledger'], db, dir);
  assert.equal(tampered.status, 1);
  assert.deepEqual(JSON.parse(tampered.stdout), { valid: false, checked: 0, firstInvalidId: observation.id });
});

test('CLI verify-ledger fails closed when the database is missing, empty or unreadable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'postcondition-cli-'));

  const missing = join(dir, 'missing', 'postcondition.db');
  const absent = run(['verify-ledger'], missing);
  assert.equal(absent.status, 1);
  assert.equal(absent.stdout, '');
  assert.match(absent.stderr, /No Postcondition database/);
  assert.equal(existsSync(missing), false, 'verify-ledger must not create a database');

  const zeroBytes = join(dir, 'zero.db');
  await writeFile(zeroBytes, '');
  const empty = run(['verify-ledger'], zeroBytes);
  assert.equal(empty.status, 1);
  assert.equal(empty.stdout, '');
  assert.match(empty.stderr, /not a readable Postcondition database/);
  assert.equal(statSync(zeroBytes).size, 0, 'verify-ledger must not migrate an empty file');

  const text = join(dir, 'text.db');
  await writeFile(text, 'This is a text file, not a SQLite database. '.repeat(4));
  const notDatabase = run(['verify-ledger'], text);
  assert.equal(notDatabase.status, 1);
  assert.equal(notDatabase.stdout, '');

  const intact = join(dir, 'intact.db');
  const marker = join(dir, 'marker.txt');
  await writeFile(marker, 'ready');
  const input = JSON.stringify({ statement: 'The marker exists', verifier: { kind: 'file', path: marker, check: { op: 'exists' } } });
  const id = JSON.parse(run(['define', '--json', input], intact).stdout).contract.id as string;
  assert.equal(run(['check', id], intact).status, 0);
  const unparseable = join(dir, 'unparseable.db');
  await copyFile(intact, unparseable);
  sql(unparseable, "UPDATE observations SET evidence_json = '{broken'");
  const broken = run(['verify-ledger'], unparseable);
  assert.equal(broken.status, 1);
  assert.equal(broken.stdout, '');
  assert.match(broken.stderr, /Could not read every receipt/);
});
