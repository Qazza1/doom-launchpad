# Doom Launchpad V2 internal pre-deployment security review

Review date: 2026-08-12; owner audit-timing decision recorded 2026-08-13

Reviewed engineering baseline: `523ed18074a8515860d8417b24196cb7a4fe16b9`

Remediation candidate: `df47b27804e7add005261730fa81cb83c9b068e8`

Review type: author-assisted internal adversarial review, **not independent audit**

Deployment status: **blocked pending candidate freeze, CI/static analysis,
no-broadcast rehearsal, final manifest review, and separate broadcast approval**

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
| High | 0 | 1 |
| Medium | 1 | 0 |
| Low | 0 | 0 |
| Informational | 2 | 0 |

## H-01: Permissionless V3 pool initialization can permanently block graduation

Status: resolved in the remediation candidate; independent review still required

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

The original integration test `testPreinitializedWrongPriceBlocksGraduation`
reproduced the failure before remediation.

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

### Implemented resolution

- Tokens deploy with CREATE2 using a salt that combines execution-time chain
  entropy, block context, creator, launch ID and launch content.
- The factory registers the new curve and requires the graduation manager to
  create and initialize the canonical 1% pool before the launch transaction can
  complete.
- The manager records that exact pool and price, and graduation will only mint
  into the recorded canonical pool.
- `DoomTokenV2` permits only bootstrap, curve and graduation-manager transfer
  paths before graduation. Wallet transfers and attempts to seed the early pool
  revert.
- The curve calls the token's one-way unlock only after the canonical position
  has been minted and the permanent lock registered. Any later failure reverts
  the entire transaction, including the unlock.

The owner explicitly approved temporary transfer restrictions before graduation
and permanent unrestricted transfers after successful graduation.

### Residual chain-ordering assumption

The CREATE2 salt is not represented as protection against a malicious sequencer.
Nitro gives the sequencer transaction-ordering power; this design assumes the
Robinhood Chain sequencer follows its advertised ordering policy. Ordinary
pre-creation of the previously predictable CREATE address is covered by an
adversarial test. Independent review must assess this chain-operator assumption.

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

## I-01: Dual-RPC fork validation passed; fallback credential has residual exposure

Both provider-backed dependency and ephemeral V2 wiring tests passed on
2026-08-12. During a later diagnostic probe, the two credential-bearing RPC URLs
were echoed into local task output. The Alchemy credential was rotated. The
QuickNode free plan did not permit rotation; the owner accepted that residual
risk, and the credential was removed from Railway so it is no longer used by a
continuously running production service. It remains local fork-test fallback
only and should be rotated when the provider permits it.

Both fork suites passed again on 2026-08-13 after the primary rotation. Each
provider independently verified the recorded Robinhood dependencies and an
ephemeral complete V2 launch, graduation, permanent position lock, and transfer
unlock. This evidence does not make the exposed fallback credential private.

No RPC URL or credential is committed to this repository.

## I-02: Internal review is not independent assurance

This review can identify and reproduce defects, prepare invariants, and create
an auditor-ready package. It cannot be represented as an independent audit
because the reviewer also participated in implementation. On 2026-08-13 the
owner elected to launch the initial capped V2 beta before an independent audit
and accepted the resulting unaudited-contract risk. The audit remains required
after the initial launch and before any replacement factory or continuation
beyond the immutable 100-launch cap. That decision changes audit timing only;
it does not authorize deployment, unpausing, or a launch.

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

1. ~~Approve and implement a mitigation for H-01.~~ Candidate implemented.
2. ~~Add adversarial tests for pool pre-creation, wrong initialization, early
   liquidity, irreversible token unlock, and graduation.~~ Candidate covered.
3. ~~Rotate the primary credential and rerun both Robinhood fork suites against
   the recorded mainnet dependencies.~~ Passed 2026-08-13. The unrotatable
   fallback is removed from Railway and retains a documented local-only risk.
4. ~~Freeze a new exact commit and regenerate source hashes and bytecode sizes.~~
   Candidate `df47b27804e7add005261730fa81cb83c9b068e8`, digest
   `ce824376a4639f5c8882d7723668576ebf5b1f9e21b596aba605463614164d24`.
5. ~~Obtain independent review before launch or explicitly record the owner's
   decision to defer it.~~ Deferral decision recorded 2026-08-13; independent
   review remains required after the initial launch.
6. Complete a no-broadcast wallet rehearsal and deployment-manifest review.
7. Receive separate authorization to broadcast and later to resume the factory.
