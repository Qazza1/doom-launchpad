# V2 mainnet deployment execution

## Authorized scope

The owner authorization recorded on 2026-08-13 covers only the exact seven-transaction V2 plan
whose SHA-256 is `296f3bc0541f044fa496bb86802deb65ed3e3662a9b2b7eb3ebafd88e1afa9b2`.
It starts at deployer nonce 10 on Robinhood Chain mainnet (chain ID 4663) and ends at nonce 16.
The deployer is `0xcaB166ed15e63b846Ec8D1a2d6762a33392c796F`, and only its existing balance may be used.

The authorization does not cover a funding transfer, factory activation, creator action, or token
launch. The factory must remain paused and have a launch count of zero after this sequence. The
owner acknowledged that the independent audit is deferred until after the initial beta launch; that
acknowledgement does not expand this deployment authorization.

The base deployment manifest remains fail-closed. The separate authorization record is intentionally
bound to one plan digest and one nonce range, so it cannot be reused after payload or nonce drift.

## One-step execution

Run exactly one step at a time from the repository root:

```powershell
.\tools\v2\mainnet.ps1 -Step 1
```

The wrapper accepts steps 1 through 7. It asks for two independent HTTPS RPC endpoints without
printing or storing them, checks the committed authorization, and starts a localhost-only page on
port 4182. The page asks Rabby to submit only that step. The operator must verify Robinhood mainnet,
the deployer address, zero value, the exact nonce, and the plan digest before approving the wallet
prompt.

After submission, the server independently reads the transaction and receipt from both providers.
It verifies the payload, sender, nonce, recipient or created address, runtime bytecode or irreversible
binding, and records a sanitized receipt. No subsequent step is exposed until every earlier receipt
exists and passes verification.

From factory deployment onward, each receipt check also verifies that the factory remains paused and
has zero launches. After step 7, the executor additionally requires all three bindings, a valid
factory configuration, and a valid graduation-manager network configuration.

## Mandatory stop conditions

Stop without signing if any of these occurs:

- either provider reports a chain other than 4663;
- providers disagree on bytecode, nonce, balance, transaction, or receipt;
- the pending nonce is not the exact nonce for the selected step;
- the deployer balance is below the live fee estimate plus the 25% buffer;
- compiled artifacts, source inputs, rehearsal payloads, plan hash, or predicted addresses differ;
- a receipt fails, an address differs, a binding is wrong, the factory is active, or launch count is nonzero.

Nonce or payload drift invalidates the authorization and requires a new plan plus explicit owner
reauthorization. Do not replace, speed up, or cancel a submitted transaction without investigating
and recording the result first.
