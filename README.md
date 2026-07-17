# Postcondition

**Agents call tools. Postcondition checks whether the world changed.**

[![CI](https://github.com/christian140903-sudo/postcondition-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/christian140903-sudo/postcondition-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/postcondition-mcp.svg)](https://www.npmjs.com/package/postcondition-mcp)
[![license](https://img.shields.io/npm/l/postcondition-mcp.svg)](./LICENSE)

An agent receiving `success: true` from a tool only knows that the call returned.
It does not know that a release is public, a file contains the intended data, a
commit reached a remote-tracking branch, or an API now exposes the required
state.

Postcondition adds that missing step. It is a local-first MCP server, TypeScript
SDK, and CLI for declaring observable outcomes, checking them with constrained
read-only verifiers, and keeping hash-chained observation receipts.

```text
intent → action in any tool → independent observation → honest verdict
                                         ├─ satisfied
                                         ├─ violated
                                         └─ unknown
```

It does **not** execute the action, expose hidden chain-of-thought, or turn an
agent's own claim into external proof.

## Quick start

Run the MCP server without a global install:

```bash
npx -y postcondition-mcp serve
```

Add it to an MCP client:

```json
{
  "mcpServers": {
    "postcondition": {
      "command": "npx",
      "args": ["-y", "postcondition-mcp", "serve"]
    }
  }
}
```

The database defaults to `~/.postcondition/postcondition.db`. Set
`POSTCONDITION_DB` to use a different absolute path.

## The smallest useful flow

Define the world state that should be true:

```bash
postcondition define --json '{
  "statement": "soul-mcp 4.0.1 is visible in the public npm registry",
  "subject": "npm:soul-mcp@4.0.1",
  "verifier": {
    "kind": "npm",
    "package": "soul-mcp",
    "check": { "op": "version_exists", "version": "4.0.1" }
  }
}'
```

After the publishing action, check the returned contract id:

```bash
postcondition check pc_...
```

The result contains an observation, an evidence digest, the previous receipt
hash, and the current receipt hash. `postcondition verify-ledger` recomputes the
chain.

## Verifiers

| Kind | Supported checks | Network/process behaviour |
|---|---|---|
| `file` | exists, absent, SHA-256, text, JSON pointer, size | Local read only; content inspection capped at 16 MiB |
| `http` | status, text, JSON pointer | GET only; no custom headers; 3 redirects; 30 s maximum |
| `git` | branch, clean state, HEAD, tag, remote containment | Fixed read-only `git` argument sets; no shell; no fetch/push |
| `npm` | published version, dist-tag | Public registry GET |
| `manual` | explicit human or agent attestation | No automatic observation |

HTTP and registry checks block loopback, link-local, private, and reserved
addresses by default. For intentional local development checks, opt in with
`POSTCONDITION_ALLOW_PRIVATE=1`. Read [the threat model](./docs/SECURITY-MODEL.md)
before enabling it in an environment that can reach sensitive services.

## MCP surface

Seven tools:

- `postcondition_define` — record a testable outcome and verifier.
- `postcondition_check` — observe now and append a receipt.
- `postcondition_get` — read one contract and its history.
- `postcondition_list` — filter recent contracts by verdict.
- `postcondition_attest` — record a labelled human or agent attestation.
- `postcondition_retract` — invalidate a bad contract without deleting history.
- `postcondition_verify_ledger` — recompute evidence digests and the receipt chain.

Resources:

- `postcondition://status`
- `postcondition://contracts`
- `postcondition://receipts`
- `postcondition://contract/{id}`

Prompt: `verify-before-done`.

## TypeScript SDK

```ts
import { PostconditionRuntime } from 'postcondition-mcp';

const runtime = new PostconditionRuntime({ dbPath: './postconditions.db' });

const contract = runtime.define({
  statement: 'The generated manifest declares version 1.2.0',
  verifier: {
    kind: 'file',
    path: './package.json',
    check: { op: 'json_equals', pointer: '/version', value: '1.2.0' },
  },
});

const receipt = await runtime.check(contract.id);
console.log(receipt.verdict); // satisfied | violated | unknown

runtime.close();
```

## Evidence is classified, not flattened

| Evidence class | Meaning |
|---|---|
| `externally_observed` | A remote HTTP/npm endpoint was read independently |
| `configured_verifier` | A constrained local file or Git check ran |
| `manual_attestation` | A human supplied the result |
| `self_attestation` | An agent supplied its own result |

These labels remain in every receipt. An attestation can be useful, but it is
never silently presented as external observation.

## Design rules

- **Outcome, not execution:** Postcondition observes after an action; it is not a
  second orchestration framework.
- **Unknown is a valid result:** timeouts, parsing failures, blocked targets, and
  unavailable evidence do not become false violations or fabricated success.
- **No arbitrary command verifier:** Git checks use fixed argument sets and
  `execFile`, never a user-provided shell command.
- **Corrections stay visible:** contracts can be retracted, not erased through
  the public API.
- **Protocol-clean stdout:** MCP mode reserves stdout for JSON-RPC.
- **Local-first:** no account, telemetry, hosted control plane, or API key is
  required.

## What the receipt chain proves

Each observation stores a canonical evidence digest and includes the prior
receipt hash. The verifier can detect modified evidence, modified receipt
fields, reordered receipts, or a broken link in the local chain.

It does **not** yet provide cryptographic non-repudiation against an attacker who
can rewrite the database and recompute the entire chain. Signed checkpoints and
external anchors are future work. This boundary is intentional and tested; see
[limitations](./docs/LIMITATIONS.md).

## Development

Requires Node.js 20 or newer.

```bash
npm install
npm test
npm run test:coverage
npm run smoke:pack
```

The test suite covers the SDK, SQLite persistence, receipt mutation, CLI, an
actual MCP stdio handshake, file limits, fixed Git checks, redirects, network
blocking, and registry observations across the supported Node versions in CI.

## Origin

Postcondition grew from a repeated design principle across Christian Bucher's
Soul and Miguel systems: autonomy should carry evidence, permission boundaries,
corrections, and observable outcomes. It is a clean public implementation, not
an export of personal memory, private session logs, or the Miguel monolith.
Read [ORIGINS.md](./docs/ORIGINS.md) for the public lineage.

## Status

`0.1.x` is an early public interface. Contract and receipt schemas may gain
fields before `1.0`; existing SQLite data will be migrated rather than silently
discarded. Please report security issues through the private process in
[SECURITY.md](./SECURITY.md).

MIT © Christian Bucher
