# Doom Launchpad V2

This is the isolated bonding-curve engineering candidate. It does not modify
or replace the deployed three-launch canary contracts in `../src`.

## Frozen economics

- Creator pays `0.001 ETH` plus gas, not `0.05 ETH`.
- Buyers fund a two-way constant-product curve until it holds `0.05 ETH` net.
- Supply is split into 30% sold on the curve, 10% permanent full-range V3
  liquidity, and 60% delayed GM escrow.
- Buy/sell fee: 1%, routed 70/15/15 to creator/treasury/DoomRewards. Creator
  curve fees vest over the three post-graduation GM check-ins.
- The terminal curve price exactly matches the V3 initialization ratio.
- Each token uses an execution-entropy CREATE2 salt and its canonical 1% V3
  pool is initialized at the graduation price inside the launch transaction.
- Before graduation, token transfers are limited to curve/bootstrap/graduation
  paths. Successful permanent-position registration unlocks ordinary ERC-20
  transfers irreversibly.
- The final buy is capped at the exact target and refunds excess native value.
- There is no curve expiry. Every trade includes minimum-output and deadline
  protection.
- The factory starts paused, requires an EOA allowlist, and stops permanently
  after 100 launches.

## Contracts

- `DoomLaunchFactoryV2`: allowlist, launch cap, pause control, metadata record,
  and fixed launch-fee routing.
- `DoomLaunchDeployerV2`: one-time-bound creation-code carrier. Separating this
  contract keeps every runtime below the EIP-170 size limit.
- `DoomBondingCurve`: buy/sell accounting, exact graduation endpoint, fee
  custody, creator vesting, and automatic graduation.
- `GmEscrowV2`: 60% creator allocation; its clock begins only after graduation.
- `V3GraduationManagerV2`: launch-time canonical-pool initialization, canonical
  1% full-range V3 mint, near-total utilization, and no retained balances.
- `PositionLockerV2`: permanent NFT custody and immutable V3 fee routing.
- `DoomTokenV2`: ownerless fixed-supply ERC-20 with temporary launch-path
  restrictions and one-way post-graduation unlock.

The existing DoomRewards vault may be reused because its deposit entry points
are permissionless and balance checked. The V2 locker, manager, deployer, and
factory must be newly deployed because their bindings are immutable.

## Verification

From `doom-launchpad`:

```powershell
..\.tools\foundry-v1.7.1\forge.exe test --root v2 -vv
..\.tools\foundry-v1.7.1\forge.exe build --root v2 --sizes
node --test tools\v2\test\curve-model.test.mjs
```

The Solidity suite contains unit, fuzz, stateful invariant, pool-precreation,
temporary-transfer, irreversible-unlock, and canonical-V3 integration coverage.
Mainnet fork validation remains a deployment gate.

For dual-provider fork validation, copy `.env.example` to `.env`, add the two
RPC URLs locally, set `RUN_ROBINHOOD_V2_FORK_TESTS=true`, then run:

```powershell
..\.tools\foundry-v1.7.1\forge.exe test --root v2 --match-contract RobinhoodDependenciesV2Test -vv
```

Railway variables are not automatically available to a local Foundry process.
Rotate provider credentials immediately if an RPC URL containing an embedded
API key is ever printed in a terminal, log, issue, or task transcript.

## Fail-closed deployment order

No broadcast script is included in this candidate. The simulation-only
`script/DeployRobinhoodV2Rehearsal.s.sol` reproduces the exact sequence on a
local fork, deliberately never calls `vm.startBroadcast`, and therefore cannot
sign or submit a mainnet transaction even if `--broadcast` is supplied.

1. Deploy `DoomLaunchDeployerV2(operator)`.
2. Deploy `PositionLockerV2` with the canonical position manager, wrapped
   native token, existing DoomRewards, treasury, and operator as binder.
3. Deploy `V3GraduationManagerV2` with chain ID `4663`, the operator as binder,
   canonical V3 factory, canonical position manager, wrapped native token, and
   the new locker.
4. Call `PositionLockerV2.bindRegistrar(manager)`.
5. Deploy `DoomLaunchFactoryV2` with the unchanged roles and the new manager and
   deployer. It starts paused.
6. Call `DoomLaunchDeployerV2.bindFactory(factory)`.
7. Call `V3GraduationManagerV2.bindFactory(factory)`.
8. Verify `factory.isLaunchConfigurationValid() == true`, all bytecode,
   constructor arguments, role addresses, bindings, and constants.
9. Keep the factory paused until independent review, fork testing, manifest
   approval, and explicit authorization to resume.

Validate the fail-closed manifest and run the simulation against either RPC:

```powershell
node tools\v2\verify-manifest.mjs config\v2-mainnet-deployment-manifest.json
$env:ROBINHOOD_V2_REHEARSAL_ACK = "true"
..\.tools\foundry-v1.7.1\forge.exe script script\DeployRobinhoodV2Rehearsal.s.sol:DeployRobinhoodV2Rehearsal --root v2 --rpc-url $env:ROBINHOOD_RPC_URL -vv
```

The command must not include a private key, sender, or broadcast flag. Repeat
it with `ROBINHOOD_FALLBACK_RPC_URL` before preparing a wallet transaction plan.

After both providers agree on the deployer's pending nonce, an unsigned exact
payload plan can be generated with:

```powershell
node tools\v2\network-preflight.mjs
node tools\v2\transaction-plan.mjs --nonce <confirmed-pending-nonce>
```

The planner predicts all four CREATE addresses, threads them through the later
constructors and three irreversible bindings, and rejects any nonzero value,
wrong sender, wrong chain, skipped nonce, or stale dependency. Its JSON output
is ignored by Git and contains no signer or RPC credential.

The lightweight preflight uses eight read-only RPC requests per provider. It
checks the chain, current head, pending deployer nonce, deployer balance, and
bytecode fingerprints for all four external dependencies without running a
full fork test.

To execute the unsigned plan only on an auto-impersonated localhost fork and
measure gas, run `node tools\v2\localhost-preview.mjs`. The tool funds the
deployer with a unique local sentinel balance, sends the seven payloads only to
`127.0.0.1`, validates every receipt and postcondition, and writes a sanitized
ignored report. It loads no signer or private key and performs no upstream
write. The resulting funding figure is a snapshot and must be refreshed before
any real deployment approval.

For the final wallet-rendering rehearsal, set `DOOM_PREVIEW_PLAN=v2` and run
`node tools\deployment\rabby-preview-server.mjs`. The server forks mainnet onto
the deliberately nonexistent chain ID `4663666`, applies a unique sentinel
balance, raises the preview nonce above wallet caches, and verifies the mined
wallet transaction byte-for-byte against the seven-step V2 plan. It refuses
Robinhood mainnet (`4663`) and the real Robinhood testnet (`46630`). Preview
signatures are EIP-155-bound to the isolated chain and cannot be replayed on
mainnet.

The fail-closed deployment worksheet is
`../config/v2-mainnet-deployment-manifest.json`. It intentionally contains no
private key, RPC URL, transaction signature, or broadcast switch.

## Sequencer threat model

The launch salt includes execution-time `block.prevrandao`, block data, the
creator, launch ID, and launch content. The canonical pool is initialized in
the same transaction as the CREATE2 token deployment. This prevents an ordinary
observer from squatting the old predictable CREATE address and leaves no
post-launch initialization window.

As with transaction-order-sensitive applications on Nitro chains, a malicious
or compromised sequencer may know execution inputs before users. The launchpad
therefore assumes Robinhood Chain's sequencer follows its documented ordering
policy. This residual chain-operator trust must be included in independent
review; no contract can make public-mempool ordering private by itself.

Robinhood mainnet dependencies currently recorded by the project are:

- Wrapped native: `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`
- Canonical V3 factory: `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA`
- NonfungiblePositionManager: `0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3`
- Existing DoomRewards: `0x615f6E6B0AEA7Ac94F4391424aF601F9290dd9dC`

These addresses must be revalidated on both RPC providers immediately before a
deployment rehearsal.
