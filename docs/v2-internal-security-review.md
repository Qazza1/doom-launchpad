# Doom Launchpad V2 internal pre-deployment security review

Review date: 2026-08-12

Reviewed engineering commit: `523ed18074a8515860d8417b24196cb7a4fe16b9`

Review type: author-assisted internal adversarial review, **not independent audit**

Deployment status: **blocked**

## Scope and method

The review covered every Solidity file under `v2/src`, the economic model,
unit/fuzz/invariant tests, canonical-V3 integration tests, permanent custody,
fee accounting, role and binding surfaces, external calls, rounding, supply
conservation, bytecode size, and deployment sequencing.

The canonical Uniswap V3 factory, pool, and periphery sources vendored under
`lib/` were inspected at the relevant pool-creation and initialization paths.
The V2 tests passed before this review, but passing tests do not remove the
finding below.

## Summary

| Severity | Open | Resolved |
|---|---:|---:|
| Critical | 0 | 0 |
| High | 1 | 0 |
| Medium | 1 | 0 |
| Low | 0 | 0 |
| Informational | 2 | 0 |

## H-01: Permissionless V3 pool initialization can permanently block graduation

Status: open, deployment blocking

Affected contract: `V3GraduationManagerV2`

The bonding-curve token exists and is publicly known before graduation. The
canonical Uniswap V3 factory permits any caller to create a supported pool, and
an uninitialized pool permits any caller to set its first price. Initialization
is one-time.

At graduation, `V3GraduationManagerV2` calls
`createAndInitializePoolIfNecessary` and then requires the existing pool price
to equal the curve's exact terminal price. An attacker can create or initialize
the token/WETH 1% pool at any other valid price before graduation. The exact
price check then reverts every graduation attempt. The attacker does not need a
privileged key or a profitable trade.

The integration test
`testPreinitializedWrongPriceBlocksGraduation` reproduces the failure.

### Recommended resolution

Preserving canonical V3 requires both controls below:

1. Deploy each token at a non-pre-squattable address and initialize its intended
   canonical pool atomically during the launch transaction.
2. Until graduation, restrict token transfers to the bonding curve and escrow
   paths. Otherwise a holder can seed and move the early V3 pool price before
   the graduation liquidity is minted. The restriction must unlock
   irreversibly only after permanent liquidity registration succeeds.

A CREATE2 salt supplied openly in calldata is not sufficient by itself because
it is visible in the public mempool. The deployment design must include an
unpredictable component and a private-transaction/rehearsal threat analysis.

The alternative is a permissioned/custom V3 factory, but that would no longer
be the currently selected canonical V3 deployment.

This mitigation changes pre-graduation ERC-20 transfer behavior and therefore
requires explicit product approval before implementation.

## M-01: Immutable single-wallet operational authority

Status: risk accepted verbally, not remediated

Affected contract: `DoomLaunchFactoryV2`

The operator can allowlist creators and resume launches, and the immutable
operator cannot be rotated. The user elected to retain the existing Rabby EOA
instead of a multisig. Compromise can authorize creators or resume after a
pause; loss of the key permanently removes those operator capabilities. The
guardian can pause but cannot restore or rotate the operator.

Recommended operational controls are a dedicated hardware-backed account,
transaction simulation, minimal connected applications, and an incident plan.
A multisig remains the preferred remediation.

## I-01: Local dual-RPC fork validation is not currently available

The current Codex shell does not expose `ROBINHOOD_RPC_URL` or
`ROBINHOOD_FALLBACK_RPC_URL`. They may have been added to Railway, but Railway
service variables do not automatically enter this local development process.
No mainnet fork result should be recorded until both local variables are
present and the dependency checks pass independently through both providers.

Do not commit either URL or paste provider secrets into issue trackers or audit
documents.

## I-02: Internal review is not independent assurance

This review can identify and reproduce defects, prepare invariants, and create
an auditor-ready package. It cannot be represented as an independent audit
because the reviewer also participated in implementation. The prior owner
waiver was limited to the frozen three-launch canary and does not cover this
100-launch V2 design.

## Verified properties before H-01 was found

- Creator pays the fixed launch fee and gas; buyers fund the 0.05 native target.
- Curve fees remain separate from graduation collateral.
- The final buy is capped and refunds excess input.
- A holder cannot sell more tokens than the curve distributed.
- Trading stops atomically at graduation.
- The 30/10/60 token allocation and fixed supply reconcile.
- GM escrow activates only after a successful graduation transaction.
- Creator fee vesting and default forfeiture reconcile.
- Permanent-position custody has no withdrawal or arbitrary-call path.
- Factory, deployer, locker, and manager bindings are one-time and fail closed.
- The factory starts paused and stops after 100 launches.
- Every deployable runtime is below the EIP-170 limit.
- The frozen deployed-canary `src/` tree was unchanged.

## Required exit criteria

1. Approve and implement a mitigation for H-01.
2. Add adversarial tests for pool pre-creation, wrong initialization, early
   liquidity, early swapping, irreversible token unlock, and graduation.
3. Run both Robinhood RPC fork suites against the recorded mainnet dependencies.
4. Freeze a new exact commit and regenerate source hashes and bytecode sizes.
5. Obtain independent review of that exact commit or explicitly reduce scope
   and record a new, legally reviewed risk decision.
6. Complete a no-broadcast wallet rehearsal and deployment-manifest review.
7. Receive separate authorization to broadcast and later to resume the factory.
