# Stage 4 Blockscout source-verification rehearsal

This rehearsal proves that the four deployed contracts can be source-verified on
Robinhood Chain's Blockscout instance before anything is deployed. It performs no
write, submits nothing, and loads no signer or RPC secret.

Verification itself happens at Gate F, after the six deployment transactions. The
rehearsal exists so that a settings, compiler, or constructor-argument mistake is
found now rather than in front of an already-deployed, already-bound contract.

## What is rehearsed

- The exact Solidity standard-JSON compiler input for each contract.
- That the input matches the frozen compiler settings byte for byte.
- The exact compiler build the explorer must be told to use.
- The ABI-derived constructor signature and the encoded constructor arguments.
- That the explorer accepts standard-input verification and offers that compiler.
- The masked runtime-bytecode comparison used after deployment.

## Explorer facts confirmed on 2026-07-25

The public explorer front end is
<https://explorer.mainnet.chain.robinhood.com>. Its pages load the Blockscout API
from `https://robinhoodchain.blockscout.com`, which is the host that serves the
verification endpoints. This host was read from the explorer's own page, not
guessed. Re-confirm it before use; do not substitute a host from memory.

A read-only `GET` of
`https://robinhoodchain.blockscout.com/api/v2/smart-contracts/verification/config`
returned:

- `standard-input` present in `verification_options`;
- 1,657 offered Solidity compilers, including `v0.8.36+commit.8a079791`;
- `flattened-code`, `multi-part`, and `sourcify` also available as fallbacks.

The offered compiler is the exact build Foundry 1.7.1 used for this repository,
so standard-input verification is the correct method and no compiler downgrade or
flattening workaround is needed.

## Tool

```powershell
node .\tools\deployment\verification-bundle.mjs --check-explorer
```

The tool:

- refuses to run unless `config/stage4-deployment-manifest.json` is still
  fail-closed;
- cross-checks roles, dependencies, and canary limits across the deployment
  manifest and the canary decisions file, and stops if they disagree;
- generates each contract's standard-JSON input with the pinned Foundry binary;
- rejects an input whose optimizer, runs, `viaIR`, `evmVersion`, or metadata
  `bytecodeHash` differs from the frozen settings;
- rejects a byte-order mark, an absolute source path, or any string resembling an
  RPC URL, API key, Telegram token, or private key;
- derives the constructor signature from the compiled ABI and encodes the
  arguments with `cast`;
- writes a Git-ignored bundle to `tools/deployment/output/verification/`;
- performs exactly one network request, a read-only `GET`, and only when
  `--check-explorer` is passed.

It has no submission path. Verification is submitted manually by the owner after
deployment.

Without `--addresses`, the three intermediate addresses come from the localhost
preview snapshot and the bundle is marked `addressesAreFinal: false`. After the
real deployment, pass a file containing the actual addresses and `"final": true`.

## Rehearsal result at commit `0423494`

Generated with the pinned Foundry 1.7.1 and solc `0.8.36+commit.8a079791`.
Addresses came from the `f2dee52` localhost preview snapshot, so the encoded
arguments are structurally correct but not final.

| Contract | Sources | Runtime bytes | Immutable ranges | Constructor arg bytes | Standard-input SHA-256 |
|---|---:|---:|---:|---:|---|
| DoomRewards | 11 | 4,127 | 9 | 160 | `11be06cbc53407262f1d72f97c8ab8090ba757684ca9c7771c3643e6f9fd2ff8` |
| PositionLocker | 16 | 7,268 | 17 | 160 | `4f9d6724346d94e6f74afefeb5831d1f8e5340df6501f9574a53c5c8d9729eb4` |
| V3LiquidityManager | 18 | 6,520 | 23 | 192 | `c903f4a1da740b8b57c927a25e7baee739f6b52a964fcfd88f594c0f9ef7a1c2` |
| DoomLaunchFactory | 22 | 20,574 | 48 | 352 | `dea0e8ce8fd34a39bd148021c2f15caf661af8227d2b5e07c5551b7128ff0129` |

Constructor signatures taken from the compiled ABI:

- `DoomRewards`: `constructor(address,address,address,address,uint64)`
- `PositionLocker`: `constructor(address,address,address,address,address)`
- `V3LiquidityManager`: `constructor(uint256,address,address,address,address,address)`
- `DoomLaunchFactory`:
  `constructor((address,address,address,address,address,address,address,address,uint32,uint256,uint256))`

The factory's `maxLaunches` is a `uint32`, not a `uint256`. Hand-writing that
signature produces a different ABI encoding that the explorer would reject, which
is precisely why the tool reads the signature from the artifact instead.

The SHA-256 values are reproducible from this commit with the same Foundry build.
They change whenever contract source, dependency source, or compiler settings
change, and must be regenerated from the final reviewed commit.

## Runtime bytecode comparison

All four contracts store constructor inputs as immutables: 9, 17, 23, and 48
immutable ranges respectively. Immutables are written into the runtime code at
construction time, so deployed code never equals the compiled artifact byte for
byte. A naive comparison always fails and invites the operator to ignore it.

`compareRuntimeBytecode` therefore zeroes every immutable range, using the
compiler's own `immutableReferences` offsets, on both sides before comparing. It
still rejects a length change or any difference outside those ranges. Tests cover
a match, an immutables-only difference, a single-byte tamper outside the ranges, a
truncated length, empty code, and an out-of-bounds reference.

## Post-deployment procedure, for Gate F only

1. Regenerate the bundle from the final reviewed commit with the real deployed
   addresses and `"final": true`.
2. Confirm the standard-input SHA-256 values match the reviewed artifact.
3. For each contract, read `eth_getCode` at its deployed address through both RPC
   providers and run the masked comparison. Stop on any mismatch.
4. Submit each contract manually, standard-JSON input, compiler
   `v0.8.36+commit.8a079791`, optimizer enabled with 200 runs, and the encoded
   constructor arguments from the bundle.
5. Confirm the explorer reports a verified match and that the displayed
   constructor arguments equal the bundle's.
6. Only then set `verification.sourceVerifiedOnBlockscout` in the deployment
   manifest.

Verification proves the published source compiles to the deployed code. It is not
a security review and does not substitute for the independent review gate.

## Fail-closed state

- No contract is deployed, so nothing is verified yet.
- `verification.sourceVerifiedOnBlockscout` remains `false`.
- `previews.blockscoutVerificationRehearsalComplete` records only this rehearsal.
- The bundle output stays Git-ignored; this document is the committed evidence.
