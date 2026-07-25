# Stage 4 six-transaction localhost preview

This procedure executes the exact deployment sequence against a temporary
Robinhood mainnet fork bound to `127.0.0.1`. It never loads Rabby, a private key,
a seed phrase, or an unlocked upstream account.

## Safety boundary

The wrapper:

- accepts the Alchemy URL through a hidden prompt and never prints it;
- starts Anvil on `127.0.0.1:18545`;
- verifies the local client is Anvil and chain ID is 4663;
- copies the upstream deployer's pending nonce before changing local state;
- gives the deployer a distinctive sentinel balance only through
  `anvil_setBalance`;
- requires that exact sentinel in the Solidity preview before
  `vm.startBroadcast`;
- uses Anvil local account impersonation and `eth_sendTransaction` only against
  `http://127.0.0.1:18545`;
- stops Anvil afterward;
- writes only a sanitized, ignored report with no RPC URL or signature.

Foundry prints `ONCHAIN EXECUTION COMPLETE` because the six transactions execute
on the temporary localhost chain. They are not sent, signed, or serialized for
Robinhood mainnet.

## Run

From PowerShell:

```powershell
cd C:\Users\golis\Desktop\doomstreak-site\doom-launchpad
powershell -ExecutionPolicy Bypass -File .\tools\deployment\localhost-preview.ps1
```

Paste the Alchemy Robinhood mainnet URL into the hidden prompt.

The preview validates this exact sequence:

1. deploy `DoomRewards`;
2. deploy `PositionLocker`;
3. deploy `V3LiquidityManager`;
4. call `PositionLocker.bindRegistrar`;
5. deploy `DoomLaunchFactory`;
6. call `V3LiquidityManager.bindFactory`.

It also requires:

- six sequential nonces from the observed pending nonce;
- successful local receipts from the exact deployer;
- each CREATE result to equal the independently predicted address;
- the factory to remain paused;
- the locker and manager bindings to point at each other correctly.

## Funding snapshot

The report uses:

- each transaction's conservative planned gas limit;
- `max(eth_gasPrice, 2 × baseFee + maxPriorityFee)` as the EIP-1559 fee ceiling;
- an additional 25% funding buffer.

The result is a timestamped snapshot, not an instruction to fund. Nonce, fees,
balance, predicted addresses, and the shortfall must be refreshed from both
providers immediately before the final manifest and any transfer to the
deployer.

The latest local report is:

`tools/deployment/output/latest-report.json`

That directory is ignored by Git.
