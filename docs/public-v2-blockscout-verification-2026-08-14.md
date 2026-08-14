# Public V2 Blockscout source verification — 2026-08-14

## Outcome

All four contracts used by the permissionless public V2 deployment are visible
as verified on Robinhood Chain Blockscout with Solidity compiler
`v0.8.36+commit.8a079791`:

| Contract | Address | Blockscout status |
| --- | --- | --- |
| DoomLaunchDeployerV2 | `0x76C68Fbbe105a8928A17D1353d905d42eec2F7F0` | verified, partial |
| PositionLockerV2 | `0x4f3Bab944c96aa77AAcCF41AAeB73E6840B4729A` | verified, partial |
| V3GraduationManagerV2 | `0xb146da3E348c7dd0ea14BeB390F880a2d911Ce0B` | verified, partial |
| DoomPublicLaunchFactoryV2 | `0x8f8c948A6558C79531317b4AD7CfdBa4e9728f24` | verified, partial |

Blockscout had already matched the three reused V2 components. The public
factory's privacy-sanitized standard JSON input was submitted on 2026-08-14 and
Blockscout reported it verified at `2026-08-14T11:49:00.046815Z`.

## Privacy and reproducibility

The exact compiler metadata contained unused remappings with an absolute local
Windows build path. The submitted input replaced those paths with equivalent
relative `../lib/` remappings. It contained no RPC URL, API key, private key,
Telegram credential, or local username path.

Changing remappings changes Solidity metadata, so Blockscout correctly labels
the four contracts partially rather than fully verified. The public pages still
expose their source, ABI, compiler settings, and constructor arguments. The
deployment record, transaction plan, runtime-bytecode checks, and source digest
remain the authority for the exact deployed build.

Regenerate and audit the public bundle locally with:

```powershell
node tools/v2/verification-bundle.mjs --public-v2
node tools/v2/audit-remapping-sanitization.mjs --public-v2
```

Check status without submitting anything with:

```powershell
node tools/v2/submit-sanitized-verification.mjs --public-v2 --status-only
```

## Safety posture

Source verification made HTTP requests to Blockscout only. It did not sign or
broadcast a transaction, resume a factory, or launch a token. The public factory
remained paused with launch count zero throughout verification.

Public contract pages:

- <https://robinhoodchain.blockscout.com/address/0x76C68Fbbe105a8928A17D1353d905d42eec2F7F0?tab=contract>
- <https://robinhoodchain.blockscout.com/address/0x4f3Bab944c96aa77AAcCF41AAeB73E6840B4729A?tab=contract>
- <https://robinhoodchain.blockscout.com/address/0xb146da3E348c7dd0ea14BeB390F880a2d911Ce0B?tab=contract>
- <https://robinhoodchain.blockscout.com/address/0x8f8c948A6558C79531317b4AD7CfdBa4e9728f24?tab=contract>
