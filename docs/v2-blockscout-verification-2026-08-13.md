# V2 Blockscout source verification — 2026-08-13

## Outcome

All four V2 production contracts were submitted to Robinhood Chain Blockscout
using Solidity standard JSON input and compiler
`v0.8.36+commit.8a079791`. Blockscout reports every contract verified and
partially verified, not fully verified:

| Contract | Address | Blockscout status |
| --- | --- | --- |
| DoomLaunchDeployerV2 | `0x7Da8f0317341DB59650939036145c057Cc71bFB0` | verified, partial |
| PositionLockerV2 | `0x9Cf65eD04eBA45F68241591ba8a7D6BAa8E86cFB` | verified, partial |
| V3GraduationManagerV2 | `0x72b094f084915F6d868177b68925cA9D5e6f2A01` | verified, partial |
| DoomLaunchFactoryV2 | `0x142760D2C865537c063492933FB71ddefA2372C6` | verified, partial |

The public pages expose the source, ABI, compiler configuration and constructor
arguments. They must not be described as fully verified.

## Privacy decision

The exact deployment metadata contained three unused remappings with an
absolute Windows build path and local username. Before submission those
remappings were converted to equivalent relative `../lib/` targets. No RPC URL,
API key, private key, Telegram credential or local user path was published.

Solidity includes remappings in its metadata hash, so the privacy-safe input
cannot reproduce the exact metadata hash. A local `solc 0.8.36` comparison
confirmed the resulting difference. Blockscout accepted the executable match
and correctly classified all four results as partial verification.

## Safety posture

Source verification made HTTP requests to Blockscout only. It did not sign or
broadcast a transaction, resume the factory or authorize a token launch. At the
time of verification the production factory remained paused and its launch
count remained zero.

The ignored local result is written to
`tools/v2/output/verification/submission-result.json`. Recheck public status
without submitting by running:

```powershell
node tools/v2/submit-sanitized-verification.mjs --status-only
```

Public contract pages:

- <https://robinhoodchain.blockscout.com/address/0x7Da8f0317341DB59650939036145c057Cc71bFB0?tab=contract>
- <https://robinhoodchain.blockscout.com/address/0x9Cf65eD04eBA45F68241591ba8a7D6BAa8E86cFB?tab=contract>
- <https://robinhoodchain.blockscout.com/address/0x72b094f084915F6d868177b68925cA9D5e6f2A01?tab=contract>
- <https://robinhoodchain.blockscout.com/address/0x142760D2C865537c063492933FB71ddefA2372C6?tab=contract>
