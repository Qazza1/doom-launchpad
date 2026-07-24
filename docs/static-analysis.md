# Static-analysis triage

Pinned tools:

- Slither 0.11.5
- Aderyn 0.6.8

Slither is run twice in CI: once to preserve the complete report and once as a
high-severity gate. The gate excludes only `reentrancy-balance`, whose reports
are caused by deliberate before/after token-balance reconciliation around
external calls. Each affected state-changing entry point is `nonReentrant`, and
the test suite includes reentrant manager/reward mocks.

The following detector classes still require human review but are expected in
this design:

- `timestamp`: GM and claim deadlines are explicitly onchain-time products.
- `incorrect-equality`: `liquidity == 0` is a required fail-closed NPM result check.
- `unused-return`: the locker reads only the immutable position fields it needs.
- `low-level-calls`: native refunds and treasury payments require checked calls.
- `naming-convention`: `WETH9` is the canonical NPM interface and
  `INITIAL_SUPPLY` is an immutable constant-style value.
- `cyclomatic-complexity`: launch and liquidity functions enforce many
  post-conditions atomically; independent review remains required.

The initial local Slither run also reported `reentrancy-eth` because aggregate
liquidity was written after the V3 call. Stage 3.1 now reserves the full canary
liquidity envelope before any external interaction. It also explicitly
initializes locals previously reported by `uninitialized-local`.

Aderyn's npm wrapper did not complete on the local Windows host. Its pinned Linux
CI job remains a required assurance gate; this document must be updated with the
CI report before creating the audit-candidate tag.
