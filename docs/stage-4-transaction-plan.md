# Stage 4 unsigned transaction plan

This is the production deployment path. It deliberately stops short of signing.

There is no auto-broadcasting deployment script and there will not be one. The six
transactions are submitted one at a time through Rabby, each inspected by the
owner, with receipt and postcondition checks between them. Two of the six are
irreversible. A script that fires all six on a single confirmation would remove
the only place a mistake can still be caught.

## What the tool produces

```powershell
node .\tools\deployment\transaction-plan.mjs --nonce <pending nonce>
```

For each of the six steps it emits the exact unsigned payload: sender, recipient,
zero value, nonce, calldata, and the SHA-256 of that calldata. Creation
transactions also carry the predicted address, the ABI-derived constructor
signature, the argument values, and their encoding.

`--nonce` is mandatory and has no default. The predicted CREATE addresses are a
function of the deployer and that exact nonce, so a plan built from a guessed or
stale nonce is worthless. Read the pending nonce from both providers immediately
before planning.

The plan carries no gas fields. Gas is estimated per step against live state at
submission time, not baked into a document written earlier.

Output goes to the Git-ignored `tools/deployment/output/transaction-plan.json`.
The tool refuses to run at all unless `config/stage4-deployment-manifest.json` is
still fail-closed, and it never loads a key, signs, or contacts a node beyond the
local `cast` calls that predict addresses and encode calldata.

## What the plan is checked against

Both checks run before the plan is written, and both are covered by tests:

- exactly six transactions, in the frozen order, at sequential nonces from the
  supplied starting nonce;
- every transaction sent by `0xcaB166ed15e63b846Ec8D1a2d6762a33392c796F` with
  zero value;
- creation transactions have no recipient and their creation code ends with the
  exact encoded constructor arguments;
- binding transactions carry a four-byte selector plus exactly one address;
- `bindRegistrar` targets the predicted `PositionLocker` and passes the predicted
  `V3LiquidityManager`;
- `bindFactory` targets the predicted `V3LiquidityManager` and passes the
  predicted `DoomLaunchFactory`;
- each later constructor actually received the predicted addresses of the
  contracts deployed before it.

That last check matters most. A plan can contain correct bytecode, a correct
order, and correct nonces while quietly wiring a contract to a stale address from
an earlier session. The result deploys successfully, binds irreversibly, and is
wrong. `validateDependencyWiring` compares the encoded constructor arguments
against the addresses predicted in this same plan.

## Cross-check against the localhost preview

Planned at nonce 0 from commit `ac50555`, the predicted addresses are:

| Nonce | Step | Predicted address |
|---:|---|---|
| 0 | Deploy DoomRewards | `0x615f6E6B0AEA7Ac94F4391424aF601F9290dd9dC` |
| 1 | Deploy PositionLocker | `0xdaE01c32131fF283f403b4C1fD71018Fa31cfAC0` |
| 2 | Deploy V3LiquidityManager | `0xbf36be8861ca4fe9920B10fc526E3fD039F88519` |
| 3 | bindRegistrar | n/a |
| 4 | Deploy DoomLaunchFactory | `0xDC0DF0Ba9e519D1E082F8B45307450F418eED9dE` |
| 5 | bindFactory | n/a |

These match the addresses the six-transaction localhost preview actually produced
at the same nonce, derived by an independent path: the preview read them from
executed receipts, the planner computes them from the deployer and nonce. Neither
set is a production commitment. If the deployer's pending nonce is not 0 at
deployment time, every predicted address changes.

## Between transactions

After each submission, before signing the next one:

1. wait for the receipt and require status success;
2. confirm the sender and nonce are exactly as planned;
3. for a creation, confirm the created address equals the predicted address and
   that runtime code is present;
4. compare runtime bytecode with the compiled artifact using the masked
   comparison in `docs/stage-4-blockscout-verification.md`;
5. read back the constructor-derived getters;
6. repeat the read through the fallback provider.

Stop on any discrepancy. Never submit the next nonce to work around a failed one,
and never repair an irreversible binding by deploying around it in the same
session.

## After all six

`script/VerifyRobinhoodCanary.s.sol` re-reads the deployed system end to end:
roles, dependencies, bindings, caps, fee constants, reward configuration, the
minimum claim window, and that the factory is still paused. Run it through both
providers.

The paused check was previously present in the preview and rehearsal scripts but
absent from the post-deployment verifier; it is now required there too, so the
mandatory Gate F postcondition cannot be reported as passing without it.
