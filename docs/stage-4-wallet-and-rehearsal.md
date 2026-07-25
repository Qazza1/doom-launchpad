# Stage 4 hardware wallet and non-broadcast rehearsal

These steps prove control of the approved deployer and repeat the complete
configuration rehearsal against Robinhood mainnet state. They do not authorize
a deployment.

Never enter a seed phrase or private key into PowerShell, Foundry, a website,
chat, Telegram, or source control.

## 1. Prepare the hardware wallet

The approved deployment address is:

`0xcaB166ed15e63b846Ec8D1a2d6762a33392c796F`

Before running the helper:

1. Connect and unlock the device.
2. Open its Ethereum application.
3. Close Ledger Live, MetaMask, Trezor Suite, and other software using the
   device connection.
4. Confirm that the device's normal receive-address screen shows the exact
   approved address above. Stop on any mismatch.

## 2. Prove control without signing a transaction

From PowerShell:

```powershell
cd C:\Users\golis\Desktop\doomstreak-site\doom-launchpad
powershell -ExecutionPolicy Bypass -File .\tools\deployment\hardware-wallet-verify.ps1
```

Enter `ledger` or `trezor` when prompted. The helper:

- reads the public address from the device;
- rejects any address other than the approved deployer;
- asks the device to sign a unique, human-readable control-check message;
- verifies the signature locally;
- discards the signature without saving it.

The message explicitly says it is not a transaction and authorizes no
deployment. Reject the device prompt if the displayed content differs.

If the expected account uses a non-default derivation path, stop and rerun with:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\deployment\hardware-wallet-verify.ps1 `
  -Device ledger `
  -DerivationPath "YOUR_CONFIRMED_PATH"
```

Do not guess a derivation path.

## 3. Run the configuration rehearsal

The hardware wallet is not used for this step. The script deploys the four
contracts and performs both one-time bindings only inside Foundry's local fork
simulation.

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\deployment\fork-rehearsal.ps1
```

Paste the Alchemy HTTPS URL into the hidden prompt. The helper places it in
process memory for the rehearsal and clears the environment variable afterward.
It does not use `--broadcast`, load a signer, create a raw transaction, or write
the RPC URL to disk.

Successful final lines are:

```text
Non-broadcast Robinhood mainnet fork rehearsal passed.
No hardware wallet or private key was loaded.
No transaction was signed, stored, or broadcast.
```

## Stop conditions

Stop immediately if:

- the hardware wallet displays a different address;
- the signing prompt looks like a transaction rather than a message;
- the recovered signer does not match the approved deployer;
- Foundry reports the wrong chain, missing dependency code, or an invariant
  failure;
- any command asks for a seed phrase or private key.

Completing both helpers still does not clear the independent-review gate.
