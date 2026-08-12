# Factory V2 bonding-curve proposal

Status: economic simulation candidate, **not approved for deployment**. This
work does not change the live three-launch factory or its frozen `src/` digest.

## Recommended allocation

For total supply `Q`:

- `60% Q` remains in the GM escrow.
- `40% Q` is the complete curve/graduation inventory.
- Buyers can acquire exactly `30% Q` before graduation.
- The remaining `10% Q` pairs with exactly `0.05 ETH` in the permanent V3
  position.

This is a 75/25 split inside the approved 40% curve/graduation allocation. It is
recommended over a more aggressive curve because it keeps a meaningful token
side in the permanent pool and limits the built-in curve appreciation to 9x.

## Virtual reserves and price continuity

Let `S = 0.30 Q` be tokens sold, `L = 0.10 Q` be V3 tokens and `T = 0.05 ETH`
be the net native graduation target. A constant-product curve can meet the V3
pool without a deliberate price jump when:

```text
xFinal = L*S/(S-L) = 0.15 Q
xStart = xFinal+S  = 0.45 Q
yStart = L*T/(S-L)= 0.025 ETH
k      = xStart*yStart
```

At graduation the virtual reserves are `0.15 Q / 0.075 ETH`, so the terminal
curve price is exactly the same as the V3 initialization ratio of
`0.10 Q / 0.05 ETH`.

For a one-billion-token launch:

| Quantity | Result |
|---|---:|
| Initial virtual token reserve | 450,000,000 tokens |
| Initial virtual native reserve | 0.025 ETH |
| Tokens sold at graduation | 300,000,000 tokens |
| Tokens remaining for V3 | 100,000,000 tokens |
| Net native in V3 | 0.05 ETH |
| Initial implied FDV | 0.055555... ETH |
| Graduation implied FDV | 0.5 ETH |
| Curve price multiple | 9x |

The native-side depth is still only the owner-approved `0.05 ETH`; permanent
liquidity and a smooth migration do not make that pool deep or safe.

## Trade accounting

The 1% fee is kept outside the real native reserve used for graduation.

For a buy:

1. Split gross input into fee and net input.
2. Add only net input to the real and virtual native reserves.
3. Calculate token output against the invariant, rounding the new token reserve
   upward so the curve never gives away more than the formula permits.
4. On the final buy, accept only the exact amount needed to reach `0.05 ETH` net
   and refund excess input.

For a sell:

1. Add returned tokens to both real and virtual token reserves.
2. Calculate gross native output, rounding the new native reserve upward.
3. Deduct the 1% fee from output.
4. Reduce graduation collateral by gross output and account for the retained fee
   separately.

This makes custody reconcile as:

```text
contract native = graduation collateral + accrued trading fees
curve tokens + tokens distributed = 40% of total supply
```

The executable model is `tools/v2/curve-model.mjs`; its tests cover the endpoint,
round-trip loss, overfund refunds, allocation conservation and fee conservation.
Run `node tools/v2/simulate.mjs` to compare candidate allocations and print a
sample path.

## Still blocking Solidity implementation

The following are product/security choices, not safe values to infer in code:

1. Approve or change the proposed 30% sold / 10% V3 split.
2. Decide where the flat `0.001 ETH` anti-spam fee goes.
3. Decide whether pre-graduation creator fee shares pay immediately, vest until
   graduation, or become claimable through the GM commitment.
4. Define what happens to the 60% escrow if a curve never graduates, including
   whether there is a timeout.
5. Set per-transaction limits and an explicit MEV/slippage policy.
6. Validate exact `sqrtPriceX96`, token ordering and rounding on a Robinhood V3
   fork before freezing a contract candidate.

Factory V2 needs a new liquidity manager and permanent locker. The deployed
locker and manager have irreversible one-time bindings and cannot be reused.
The existing `DoomRewards` vault can accept permissionless, balance-checked
deposits from a new factory, but that dependency must still be reviewed before
reuse is frozen.
