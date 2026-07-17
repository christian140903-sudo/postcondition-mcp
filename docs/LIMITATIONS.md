# Limitations

Postcondition `0.1` intentionally has a small verification surface.

- Receipt hashes are locally verifiable but not externally signed or anchored.
- Retraction metadata is preserved by the application but is not yet a separate
  hash-chained ledger event.
- HTTP checks are public unauthenticated GETs; there are no headers, cookies,
  request bodies, or authenticated cloud adapters.
- The DNS preflight and actual connection are not socket-pinned, so hostile DNS
  rebinding remains possible. Use outbound network isolation for untrusted input.
- Git `remote_contains` reads local remote-tracking refs. Run `git fetch` through
  your normal trusted workflow before checking if current remote state matters.
- File JSON and HTTP JSON equality can expose the selected observed value in the
  local receipt.
- SQLite is a single-host store. Multi-writer distributed consensus and hosted
  dashboards are outside this release.
- There is no policy engine, action execution, automatic retry, compensation, or
  confidence calibration yet.
- Manual and self-attested evidence remains useful context, not independent
  proof.

These boundaries are product choices, not hidden roadmap claims. Issues and
proposals are welcome when they preserve the separation between action and
verification.
