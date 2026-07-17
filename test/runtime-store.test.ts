import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PostconditionRuntime } from '../src/runtime.js';

async function makeRuntime() {
  const dir = await mkdtemp(join(tmpdir(), 'postcondition-runtime-'));
  return { dir, runtime: new PostconditionRuntime({ dbPath: join(dir, 'ledger.db') }) };
}

test('define creates a pending durable contract', async () => {
  const { dir, runtime } = await makeRuntime();
  const contract = runtime.define({
    statement: 'The build artifact exists',
    subject: 'artifact',
    verifier: { kind: 'file', path: join(dir, 'artifact.tgz'), check: { op: 'exists' } },
    metadata: { release: '0.1.0' },
  });
  assert.equal(contract.state, 'pending');
  assert.match(contract.id, /^pc_/);
  assert.deepEqual(runtime.get(contract.id)?.contract.metadata, { release: '0.1.0' });
  runtime.close();
});

test('define rejects vague statements and malformed digests', async () => {
  const { runtime } = await makeRuntime();
  assert.throws(() => runtime.define({ statement: 'x', verifier: { kind: 'manual', instructions: 'look' } }));
  assert.throws(() => runtime.define({
    statement: 'The digest matches',
    verifier: { kind: 'file', path: '/tmp/file', check: { op: 'sha256', equals: 'bad' } },
  }));
  assert.throws(() => runtime.define({
    statement: 'Metadata must be valid JSON data',
    verifier: { kind: 'manual', instructions: 'Inspect it' },
    metadata: { invalid: Number.NaN },
  }));
  runtime.close();
});

test('check updates state and appends a receipt', async () => {
  const { dir, runtime } = await makeRuntime();
  const path = join(dir, 'done.txt');
  await writeFile(path, 'done');
  const contract = runtime.define({ statement: 'The completion marker exists', verifier: { kind: 'file', path, check: { op: 'exists' } } });
  const observation = await runtime.check(contract.id);
  assert.equal(observation.verdict, 'satisfied');
  assert.equal(runtime.get(contract.id)?.contract.state, 'satisfied');
  assert.match(observation.evidenceHash, /^[a-f0-9]{64}$/);
  assert.match(observation.receiptHash, /^[a-f0-9]{64}$/);
  assert.equal(runtime.get(contract.id)?.observations.length, 1);
  runtime.close();
});

test('receipts form one global append-only hash chain', async () => {
  const { dir, runtime } = await makeRuntime();
  const a = runtime.define({ statement: 'The first path exists', verifier: { kind: 'file', path: join(dir, 'a'), check: { op: 'exists' } } });
  const b = runtime.define({ statement: 'The second path exists', verifier: { kind: 'file', path: join(dir, 'b'), check: { op: 'exists' } } });
  const first = await runtime.check(a.id);
  const second = await runtime.check(b.id);
  assert.equal(first.previousHash, null);
  assert.equal(second.previousHash, first.receiptHash);
  assert.deepEqual(runtime.verifyLedger(), { valid: true, checked: 2, firstInvalidId: null });
  runtime.close();
});

test('ledger verification detects modified evidence', async () => {
  const { dir, runtime } = await makeRuntime();
  const contract = runtime.define({ statement: 'The target exists', verifier: { kind: 'file', path: join(dir, 'missing'), check: { op: 'exists' } } });
  const observation = await runtime.check(contract.id);
  runtime.store.db.prepare("UPDATE observations SET evidence_json = '{\"tampered\":true}' WHERE id = ?").run(observation.id);
  assert.deepEqual(runtime.verifyLedger(), { valid: false, checked: 0, firstInvalidId: observation.id });
  runtime.close();
});

test('ledger verification detects a broken previous hash', async () => {
  const { dir, runtime } = await makeRuntime();
  const contract = runtime.define({ statement: 'The target exists', verifier: { kind: 'file', path: join(dir, 'missing'), check: { op: 'exists' } } });
  const observation = await runtime.check(contract.id);
  runtime.store.db.prepare("UPDATE observations SET previous_hash = 'forged' WHERE id = ?").run(observation.id);
  assert.equal(runtime.verifyLedger().valid, false);
  runtime.close();
});

test('contracts and receipts survive reopening the database', async () => {
  const { dir, runtime } = await makeRuntime();
  const dbPath = join(dir, 'ledger.db');
  const contract = runtime.define({ statement: 'The target remains absent', verifier: { kind: 'file', path: join(dir, 'missing'), check: { op: 'not_exists' } } });
  await runtime.check(contract.id);
  runtime.close();
  const reopened = new PostconditionRuntime({ dbPath });
  assert.equal(reopened.get(contract.id)?.contract.state, 'satisfied');
  assert.equal(reopened.receipts().length, 1);
  assert.equal(reopened.verifyLedger().valid, true);
  reopened.close();
});

test('list filters contracts by current state', async () => {
  const { dir, runtime } = await makeRuntime();
  const pending = runtime.define({ statement: 'This remains pending', verifier: { kind: 'manual', instructions: 'Inspect it' } });
  const checked = runtime.define({ statement: 'This path remains absent', verifier: { kind: 'file', path: join(dir, 'missing'), check: { op: 'not_exists' } } });
  await runtime.check(checked.id);
  assert.deepEqual(runtime.list({ state: 'pending' }).map((item) => item.id), [pending.id]);
  assert.deepEqual(runtime.list({ state: 'satisfied' }).map((item) => item.id), [checked.id]);
  runtime.close();
});

test('manual verifier produces unknown without pretending to inspect the world', async () => {
  const { runtime } = await makeRuntime();
  const contract = runtime.define({ statement: 'A person approves the visual result', verifier: { kind: 'manual', instructions: 'Inspect the rendered page.' } });
  const observation = await runtime.check(contract.id);
  assert.equal(observation.verdict, 'unknown');
  assert.equal(observation.evidenceClass, 'manual_attestation');
  runtime.close();
});

test('human and agent attestations keep different evidence classes', async () => {
  const { runtime } = await makeRuntime();
  const humanContract = runtime.define({ statement: 'A reviewer approves the output', verifier: { kind: 'manual', instructions: 'Review it' } });
  const agentContract = runtime.define({ statement: 'The agent reports completion', verifier: { kind: 'manual', instructions: 'Ask it' } });
  const human = runtime.attest(humanContract.id, { verdict: 'satisfied', summary: 'Reviewed by a human.', source: 'human' });
  const agent = runtime.attest(agentContract.id, { verdict: 'satisfied', summary: 'The agent says it is done.', source: 'agent' });
  assert.equal(human.evidenceClass, 'manual_attestation');
  assert.equal(agent.evidenceClass, 'self_attestation');
  runtime.close();
});

test('retraction preserves history and blocks further checks', async () => {
  const { dir, runtime } = await makeRuntime();
  const contract = runtime.define({ statement: 'This contract is later found invalid', verifier: { kind: 'file', path: join(dir, 'x'), check: { op: 'exists' } } });
  await runtime.check(contract.id);
  const retracted = runtime.retract(contract.id, 'The contract observed the wrong target.');
  assert.equal(retracted.state, 'retracted');
  assert.equal(runtime.get(contract.id)?.observations.length, 1);
  await assert.rejects(runtime.check(contract.id), /retracted/);
  runtime.close();
});

test('deadline status is recorded without overriding an observed success', async () => {
  const { dir, runtime } = await makeRuntime();
  const path = join(dir, 'ready');
  await writeFile(path, 'yes');
  const contract = runtime.define({
    statement: 'The target exists even after the declared deadline',
    verifier: { kind: 'file', path, check: { op: 'exists' } },
    deadline: '2020-01-01T00:00:00.000Z',
  });
  const observation = await runtime.check(contract.id);
  assert.equal(observation.verdict, 'satisfied');
  assert.equal(observation.evidence.deadlinePassed, true);
  runtime.close();
});

test('status reports counts and integrity', async () => {
  const { runtime } = await makeRuntime();
  runtime.define({ statement: 'A pending manual contract exists', verifier: { kind: 'manual', instructions: 'Wait' } });
  const status = runtime.status() as { contracts: Record<string, number>; observations: number; ledger: { valid: boolean } };
  assert.equal(status.contracts.pending, 1);
  assert.equal(status.observations, 0);
  assert.equal(status.ledger.valid, true);
  runtime.close();
});
