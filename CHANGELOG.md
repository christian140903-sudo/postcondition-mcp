# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- Raise the `@modelcontextprotocol/sdk` floor to `^1.32.1` and refresh the
  lockfile (SDK 1.29.0 -> 1.32.1 with proxy-addr, ip-address, fast-uri, hono,
  @hono/node-server and qs). `npm audit --omit=dev` on a fresh clone goes from
  7 findings (1 critical, 3 high, 3 moderate; all through the SDK's HTTP and
  OAuth parts, which the stdio server does not use) to 0. No MCP tool, SDK or
  CLI behaviour changes; the npm release 0.1.0 is unaffected until the next
  publish.

## [0.1.0] - 2026-07-17

### Added

- MCP server with seven tools, four resource shapes, and a verification prompt.
- TypeScript runtime and CLI backed by local SQLite.
- File, HTTP, Git, npm, and explicit manual verifier types.
- Four evidence classes that distinguish observation from attestation.
- Canonical evidence digests and a global hash-chained receipt ledger.
- Retractions that preserve observation history.
- Private-network blocking, redirect checks, response limits, and fixed Git
  subprocess commands.
- Cross-surface tests for SDK, CLI, MCP stdio, persistence, integrity mutation,
  network guards, and package installation.

[Unreleased]: https://github.com/christian140903-sudo/postcondition-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/christian140903-sudo/postcondition-mcp/releases/tag/v0.1.0
