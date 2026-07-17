# Public lineage

Postcondition is a new public implementation built from a recurring principle
in Christian Bucher's AI systems work:

> Autonomy is only trustworthy when intent, permission, evidence, correction,
> and actual outcome remain distinguishable.

Several private and public systems contributed tested design lessons:

- **Soul MCP** established durable receipts, provenance, corrections, and
  explicit uncertainty as infrastructure rather than prompt decoration.
- **Miguel** explored permission rings, typed action registries, predictions,
  drift detection, recovery, truth maintenance, and anti-performance audits.
- **SBP Studio** treats generated answers and factual claims as artifacts that
  need computed checks and pinned evidence.
- **OPUS48-style build workflows** treat completion as a claim that must survive
  clean-environment and regression checks.

Postcondition extracts one general primitive from those lessons: observe the
world after an action and state the result honestly.

The repository contains no personal Miguel memory, Claude session transcript,
private filesystem archive, credential, or copied monolith code. The public
history begins with this clean-room TypeScript implementation.
