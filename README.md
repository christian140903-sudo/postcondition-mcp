# Postcondition

**Agents call tools. Postcondition checks whether the world changed.**

[![CI](https://github.com/christian140903-sudo/postcondition-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/christian140903-sudo/postcondition-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/postcondition-mcp.svg)](https://www.npmjs.com/package/postcondition-mcp)
[![license](https://img.shields.io/npm/l/postcondition-mcp.svg)](./LICENSE)

Postcondition is a local-first MCP server, TypeScript SDK and CLI for anyone who
lets an AI agent act on real systems. You declare the outcome that should be
true; Postcondition observes it with constrained read-only verifiers and keeps a
hash-chained receipt of every observation.

```text
intent → action in any tool → independent observation → honest verdict
                                         ├─ satisfied
                                         ├─ violated
                                         └─ unknown
```

It does **not** execute the action, expose hidden chain-of-thought, or turn an
agent's own claim into external proof.

## Try it in two minutes

Requires Node.js 20 or newer. In Claude Code:

```bash
claude mcp add postcondition -- npx -y postcondition-mcp serve
```

In any other MCP client:

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

The agent then has `postcondition_define` and `postcondition_check`. The
`verify-before-done` prompt asks it to define the observable result before it
reports a task as done, check it, and report `satisfied`, `violated` or
`unknown` exactly as returned.

The database defaults to `~/.postcondition/postcondition.db`. Set
`POSTCONDITION_DB` to use a different absolute path.

### The smallest useful flow, from the command line

Define the world state that should be true:

```bash
npx -y postcondition-mcp define --json '{
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
npx -y postcondition-mcp check pc_...
```

The result contains an observation, an evidence digest, the previous receipt
hash, and the current receipt hash. `npx -y postcondition-mcp verify-ledger`
recomputes the chain. After `npm install -g postcondition-mcp` the same CLI is
available as `postcondition`.

## Why it exists

An agent receiving `success: true` from a tool only knows that the call returned.
It does not know that a release is public, a file contains the intended data, a
commit reached a remote-tracking branch, or an API now exposes the required
state. Postcondition adds that missing step.

The closest alternative is a check you script yourself after the action:
`npm view <package>@<version> version`, `git branch -r --contains <commit>`, a
`curl`. It observes the same thing. Postcondition adds what such a script usually
lacks: the expected outcome is written down before the action, a failed
observation is reported as `unknown` instead of a pass or a fail, and every
observation lands in a local, hash-chained receipt that labels where the evidence
came from.

## How it works

### Verifiers

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

### Evidence is classified, not flattened

| Evidence class | Meaning |
|---|---|
| `externally_observed` | A remote HTTP/npm endpoint was read independently |
| `configured_verifier` | A constrained local file or Git check ran |
| `manual_attestation` | A human supplied the result |
| `self_attestation` | An agent supplied its own result |

These labels remain in every receipt. An attestation can be useful, but it is
never silently presented as external observation.

### MCP surface

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

### TypeScript SDK

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

### Design rules

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

## Verify it yourself

```bash
git clone https://github.com/christian140903-sudo/postcondition-mcp && cd postcondition-mcp
npm ci && npm test        # expected: 53 passing (last verified 2026-10-08, Node 22, fresh clone)
```

The tests cover the SDK, SQLite persistence, receipt mutation, the CLI, an
actual MCP stdio handshake, file limits, fixed Git checks, redirects, network
blocking, and npm registry responses. CI runs them on Node 20, 22 and 24.

What they do not cover: no test contacts the public npm registry or a real
website (HTTP and npm checks run against a local test server on `127.0.0.1`);
CI runs on Linux only; there is no test against an attacker who rewrites the
database and recomputes the whole chain, because that attack is out of scope
(see below).

To watch the tamper check fail on purpose, after `npm ci && npm test`:

```bash
export POSTCONDITION_DB="$PWD/demo.db"
node dist/src/index.js define --file examples/file-exists.json   # prints a contract id
node dist/src/index.js check pc_...                              # "verdict": "violated" (./dist/release.tgz does not exist)
node -e "require('better-sqlite3')(process.env.POSTCONDITION_DB).prepare(\"UPDATE observations SET verdict = 'satisfied'\").run()"
node dist/src/index.js verify-ledger                             # "valid": false, "firstInvalidId": "obs_..."
```

Further checks: `npm run test:coverage` (coverage report) and
`npm run smoke:pack` (packs the tarball, installs it into a scratch project,
runs the CLI and imports the SDK).

## What it does not do

- **It does not act.** Postcondition observes after an action; it does not run,
  retry or roll back anything, and it has no policy engine.
- **It does not provide non-repudiation.** Each observation stores a canonical
  evidence digest and the prior receipt hash, so `verify-ledger` detects
  modified evidence, modified receipt fields, reordered receipts, or a broken
  link in the local chain. Someone who can rewrite the database and recompute
  the entire chain is not detected. Signed checkpoints and external anchors are
  not implemented.
- **It does not reach private or authenticated systems by default.** HTTP checks
  are unauthenticated public GETs; there are no database, cloud or
  authenticated API verifiers.
- **It does not turn attestations into observations.** Manual and self-attested
  receipts stay labelled as such.
- **It does not fail the process on a broken chain.** In 0.1.0,
  `verify-ledger` reports `"valid": false` in its JSON output but exits with
  code 0; scripts must read the `valid` field.

The full list is in [LIMITATIONS.md](./docs/LIMITATIONS.md); the threat model
is in [SECURITY-MODEL.md](./docs/SECURITY-MODEL.md).

## How this was built

Most of the code was written by AI coding agents under my direction. I wrote the
specification, set the constraints, decided what to test, reviewed the result
and rejected what did not hold. Release decisions and every claim in this README
are mine.

The public history starts at the finished 0.1.0 code (two commits on
2026-07-17); the agent sessions behind it are not published. The idea comes from
my earlier agent projects, where one rule kept recurring: autonomy should carry
evidence. This repository is a clean public implementation, not an export of
their code or memory ([ORIGINS.md](./docs/ORIGINS.md)).

## Status

`0.1.0` on npm (2026-07-17) · experimental · single maintainer · no known
external users · last verified 2026-10-08.

Contract and receipt schemas may gain fields before `1.0`; existing SQLite data
will be migrated rather than silently discarded. Please report security issues
through the private process in [SECURITY.md](./SECURITY.md).

## License

MIT © Christian Bucher
