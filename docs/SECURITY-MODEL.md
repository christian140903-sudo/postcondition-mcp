# Security model

## Assets

- Local contract statements and metadata.
- Local filesystem and repository paths.
- Observation evidence and attestations.
- The SQLite receipt ledger.
- Network services reachable from the host.

## Default protections

- Verifiers are discriminated, strictly validated data structures.
- There is no arbitrary shell or command verifier.
- Git uses `execFile` with fixed commands, bounded output, and a timeout.
- HTTP is GET-only, has no user-supplied headers, follows at most three checked
  redirects, caps time and inspected response size, and strips query strings and
  credentials from recorded observation URLs.
- DNS results resolving to loopback, link-local, private, or reserved address
  space are rejected by default.
- File content inspection is capped; large files can be checked by streaming
  SHA-256.
- Text searched in a file is represented by its digest in evidence rather than
  echoed into the receipt.
- MCP stdout contains protocol traffic only.

## Trust boundaries

The caller is allowed to define local paths and contract metadata. Postcondition
therefore assumes that access to its MCP server or CLI is already access to the
local user account. It does not provide per-client authorization in `0.1`.

The HTTP DNS check and the later connection are separate operations in Node's
built-in fetch stack. A hostile domain with DNS rebinding capability could race
that boundary. Run Postcondition behind an outbound network policy when checks
come from untrusted users. Never enable `POSTCONDITION_ALLOW_PRIVATE=1` for an
untrusted client.

## Sensitive data

Contracts and manual evidence are stored locally in plaintext SQLite. Do not put
tokens, passwords, session cookies, private keys, signed URLs, or raw private
documents into statements, metadata, URLs, or attestations. Postcondition does
not need secrets for its built-in public GET verifiers.

JSON equality receipts include the observed value because it is necessary to
explain a mismatch. Choose a non-sensitive JSON pointer.

## Integrity boundary

Hash chaining detects mutation when the attacker has not recomputed the full
chain. Anyone with write access to both the database and this program can forge
a new local chain. Deleting the newest receipts needs no recomputation and is
not detected either, because nothing outside the database records the length
of the chain. Future signed checkpoints may raise that boundary; until
then, do not describe receipts as third-party notarization or non-repudiation.

## Reporting

Follow `SECURITY.md`. Do not open a public issue containing an exploit or private
data.
