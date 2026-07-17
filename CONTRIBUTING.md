# Contributing

Postcondition favours a small trusted verification surface over a large plugin
catalogue.

Before proposing a verifier, explain:

1. the world state it observes;
2. why the result cannot be derived from the action's own return value;
3. which data or network access it needs;
4. how it fails to `unknown` rather than manufacturing success;
5. how secrets and unbounded input are avoided.

## Local checks

```bash
npm ci
npm test
npm run test:coverage
npm run smoke:pack
```

Changes to public contract or receipt fields need migration notes, tests, and a
changelog entry. Security changes need an update to the threat model. Do not add
telemetry, hosted dependencies, arbitrary shell execution, or private fixtures.

Use focused commits and describe observable behaviour in pull requests. By
contributing, you agree that your contribution is licensed under the MIT
License.
