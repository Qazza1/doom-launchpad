# Stage 4 Rabby account and non-broadcast rehearsal

The owner selected the existing dedicated Rabby account
`0xcaB166ed15e63b846Ec8D1a2d6762a33392c796F` for the capped canary while
travelling without the SafePal hardware wallet.

This is an explicit security downgrade from hardware signing. The account must
remain dedicated to DoomStreak, hold no unrelated assets, and receive only the
freshly calculated deployment-gas amount. Never import the SafePal recovery
phrase or private key into Rabby.

These steps prove control of the approved deployer and repeat the complete
configuration rehearsal against Robinhood mainnet state. They do not authorize
a deployment.

## 1. Prepare Rabby

1. Install or update Rabby only from `https://rabby.io/`.
2. Unlock the dedicated account.
3. Confirm Rabby shows exactly:
   `0xcaB166ed15e63b846Ec8D1a2d6762a33392c796F`.
4. Disable other browser-wallet extensions for this local check to avoid
   provider confusion.
5. Do not enter a seed phrase, private key, password, or RPC URL into the local
   verification page.

## 2. Prove control without signing a transaction

From PowerShell:

```powershell
cd C:\Users\golis\Desktop\doomstreak-site\doom-launchpad
node .\tools\deployment\rabby-verify-server.mjs
```

Open the printed `http://127.0.0.1:4178` address in the browser containing the
Rabby extension, then select **Connect Rabby & Verify**.

The localhost-only helper:

- selects Rabby through its EIP-6963 identity;
- rejects any account other than the approved deployer;
- confirms or requests Robinhood Chain mainnet, chain ID 4663;
- asks Rabby to sign one unique, human-readable control-check message;
- verifies the recovered signer locally with the pinned Foundry `cast` binary;
- keeps the signature only in process memory.

The message ends with:

```text
Purpose: prove control of the dedicated canary account only
This is not a transaction and authorizes no deployment.
```

Reject anything that displays gas, value, token approval, contract creation, or
a transaction. The verification page contains no transaction-sending method.
Close the Node process with `Ctrl+C` after success.

## 3. Run the configuration rehearsal

Rabby is not used for this step. The script deploys the four contracts and
performs both one-time bindings only inside Foundry's local fork simulation.

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
No signer or private key was loaded.
No transaction was signed, stored, or broadcast.
```

## Stop conditions

Stop immediately if:

- Rabby displays a different address;
- Rabby requests anything other than a text-message signature;
- the recovered signer does not match the approved deployer;
- Foundry reports the wrong chain, missing dependency code, or an invariant
  failure;
- any command or page asks for a seed phrase or private key.

Completing both helpers still does not clear the independent-review gate.
