# Stage 3: canonical V3 adapter and mainnet-fork rehearsal

Status: complete on 2026-07-23. No contracts were broadcast and no real funds were used.

## Outcome

Stage 3 replaces the placeholder liquidity boundary with a non-upgradeable
`V3LiquidityManager` for the canonical Uniswap V3 deployment on Robinhood Chain
mainnet. The complete factory, vault, locker, adapter, and one-launch canary flow
were exercised against a read-only fork of the live chain.

The production-broadcast path remains deliberately absent. The manifest keeps
`enabled`, `broadcast`, and `mainnetDeploymentApproved` set to `false`.

## Verified canonical dependencies

| Dependency | Robinhood Chain address |
| --- | --- |
| Chain ID | `4663` |
| WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` |
| Uniswap V3 Factory | `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA` |
| NonfungiblePositionManager | `0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3` |
| SwapRouter02 | `0xcaf681a66d020601342297493863e78c959e5cb2` |
| QuoterV2 | `0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |

Sources:

- Robinhood Chain token contracts: <https://docs.robinhood.com/chain/contracts/>
- Official Uniswap V3 Robinhood deployments:
  <https://developers.uniswap.org/docs/protocols/v3/deployments/v3-robinhood-chain-deployments>

The fork checks also read the deployed contracts and confirmed:

- `chainid == 4663`
- `NonfungiblePositionManager.factory()` matches the official V3 Factory
- `NonfungiblePositionManager.WETH9()` matches Robinhood WETH
- fee tier `3000` has tick spacing `60`
- WETH, V3 Factory, and NonfungiblePositionManager contain runtime code

## Adapter safety properties

- Only the irreversibly bound `DoomLaunchFactory` may create liquidity.
- Binding succeeds only if the factory points back to the same adapter.
- Network, WETH, factory, NPM, fee-tier, and locker wiring fail closed.
- Creators cannot choose the initial price, fee tier, or tick range.
- The factory derives initial price from the fixed 40% token allocation and
  creator-selected native liquidity amount.
- Liquidity uses the 0.30% fee tier and the maximum valid full-range ticks.
- Both assets must achieve at least 99.9999% utilization.
- The V3 position NFT moves directly to the ownerless `PositionLocker` and is
  registered with its creator beneficiary and 365-day unlock time.
- A bounded token remainder goes to DoomRewards; a bounded native remainder is
  refunded to the creator.
- Creation fees are calculated from native liquidity actually used.
- The adapter rejects any residual launch-token, WETH, or native balance.

## Validation evidence

- 62 local tests passed; 0 failed; 2 fork tests skipped by default.
- 2 Robinhood mainnet-fork tests passed; 0 failed when explicitly enabled.
- Two fuzz tests ran 512 cases each.
- Two stateful invariants ran 128 sequences and 8,192 calls each.
- `DoomLaunchFactory`: 19,544 runtime bytes, 5,032-byte EVM-limit margin.
- `V3LiquidityManager`: 6,128 runtime bytes.
- Solidity 0.8.36, Cancun EVM, optimizer 200 runs, IR pipeline.

The end-to-end fork test created a real-format V3 pool in local fork state,
minted its position NFT, verified locker ownership and active lock state,
verified asset utilization, and reconciled the creation fee and DoomRewards WETH.

## Reproduce locally

From the `doom-launchpad` directory in PowerShell:

```powershell
.\tools\verify-local.ps1
```

Run the two optional read-only mainnet-fork checks:

```powershell
.\tools\verify-local.ps1 -RunRobinhoodForkTests
```

Run only the deployment rehearsal:

```powershell
$env:ROBINHOOD_REHEARSAL_ACK = "true"
forge script script/DeployRobinhoodCanaryRehearsal.s.sol:DeployRobinhoodCanaryRehearsal `
  --rpc-url robinhood_mainnet -vvv
```

Do not add `--broadcast`. The rehearsal contains no `vm.startBroadcast`, so it
cannot serve as the eventual production deployment script.

Any contract addresses printed by this command exist only inside the temporary
simulation. They are not deployed Robinhood Chain addresses and must never be
copied into the website or indexer.

## Stage 4 blockers

1. Independent smart-contract review with all findings resolved or explicitly accepted.
2. Final compiler/dependency lock and source hashes.
3. Final signed deployment manifest and a second-person address comparison.
4. Dedicated production RPC and fallback RPC; the public endpoint is rate-limited.
5. Hardware-wallet or secure-keystore deployment process and exact gas funding.
6. Production deployment script with chain-ID, nonce, address, bytecode, and
   constructor-argument assertions.
7. Blockscout source-verification rehearsal.
8. Indexer/API/UI integration and a disabled-by-default write interface.
9. Explicit user approval immediately before broadcast.

See `stage-4-inputs.md` for what is and is not needed from the project owner.
