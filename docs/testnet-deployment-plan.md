# Archived testnet deployment plan

This file is retained only to explain the repository history. The generic
testnet deployment templates were removed during Stage 3.1 because they no
longer matched the verified Robinhood mainnet dependencies, permanent locker,
or frozen canary economics.

Current work follows:

- `docs/doom-launchpad-spec.md`
- `docs/roadmap.md`
- `script/DeployRobinhoodCanaryRehearsal.s.sol` (non-broadcast)
- `script/VerifyRobinhoodCanary.s.sol` (read-only)

There is no authorized broadcast script. Testnet or mainnet deployment requires
a separately reviewed manifest, exact network dependencies, and the Stage 4
assurance gates.
