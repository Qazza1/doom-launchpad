/// Everything the launch flow displays about what a launch does, derived from the frozen
/// configuration rather than written into the interface.
///
/// The user interface must never state a number the contracts disagree with. The static-site UI
/// plan described a 10% creator allocation for months after the economics changed to 0%; a screen
/// built from that document would have promised creators tokens they never receive. Deriving the
/// numbers means the interface cannot drift on its own.

export const BPS = 10_000n;

export function loadEconomics(decisions) {
  const economics = decisions.tokenEconomics;
  const fee = decisions.creationFee;
  const gm = decisions.gmCommitment;
  const liquidity = decisions.liquidity;
  return {
    creatorLiquidBps: Number(economics.creatorLiquidBps),
    liquidityBps: Number(economics.liquidityBps),
    gmEscrowBps: Number(economics.gmEscrowBps),
    creationFeeBps: Number(fee.feeBps),
    treasuryShareBps: Number(fee.treasuryShareBps),
    nftRewardsShareBps: Number(fee.nftRewardsShareBps),
    requiredCheckIns: Number(gm.requiredCheckIns),
    cadenceSeconds: Number(gm.cadenceSeconds),
    gracePeriodSeconds: Number(gm.gracePeriodSeconds),
    poolFeeBps: Number(liquidity.poolFee) / 100,
    eligibleWethFeeSplitBps: liquidity.eligibleWethFeeSplitBps,
    ineligibleWethFeeSplitBps: liquidity.ineligibleWethFeeSplitBps,
    liquidityIsPermanent: liquidity.releaseSupported === false,
  };
}

export function validateTokenInputs({ name, symbol, wholeSupply }, limits) {
  const errors = {};
  const trimmedName = String(name ?? "").trim();
  const trimmedSymbol = String(symbol ?? "").trim();

  // TextEncoder, not Buffer: this module runs in the browser as well as in tests.
  const bytes = value => new TextEncoder().encode(value).length;

  if (!trimmedName) errors.name = "Give the token a name.";
  else if (bytes(trimmedName) > 64) errors.name = "Name must be 64 bytes or fewer.";

  if (!trimmedSymbol) errors.symbol = "Give the token a ticker.";
  else if (bytes(trimmedSymbol) > 12) errors.symbol = "Ticker must be 12 bytes or fewer.";
  else if (!/^[A-Za-z0-9]+$/.test(trimmedSymbol)) errors.symbol = "Ticker must be letters and numbers only.";

  let supply = null;
  const raw = String(wholeSupply ?? "").replace(/[,_\s]/g, "");
  if (!/^\d+$/.test(raw)) {
    errors.wholeSupply = "Supply must be a whole number of tokens.";
  } else {
    supply = BigInt(raw);
    if (supply < BigInt(limits.minWholeSupply)) {
      errors.wholeSupply = `Supply must be at least ${Number(limits.minWholeSupply).toLocaleString("en-US")}.`;
    } else if (supply > BigInt(limits.maxWholeSupply)) {
      errors.wholeSupply = `Supply must be at most ${Number(limits.maxWholeSupply).toLocaleString("en-US")}.`;
    }
  }
  return { errors, valid: Object.keys(errors).length === 0, supply };
}

/// The exact split the creator is about to commit to, in whole tokens. Division dust goes to the
/// escrow, matching the factory, so the three parts always add back to the total supply.
export function splitSupply(wholeSupply, economics) {
  const total = BigInt(wholeSupply);
  const creator = (total * BigInt(economics.creatorLiquidBps)) / BPS;
  const liquidity = (total * BigInt(economics.liquidityBps)) / BPS;
  const escrow = total - creator - liquidity;
  const perCheckIn = escrow / BigInt(economics.requiredCheckIns);
  return {
    creator,
    liquidity,
    escrow,
    perCheckIn,
    // The last check-in takes whatever the division left behind, so nothing is stranded.
    finalCheckIn: escrow - perCheckIn * BigInt(economics.requiredCheckIns - 1),
    reconciles: creator + liquidity + escrow === total,
  };
}

export function splitFee(nativeLiquidityWei, economics) {
  const liquidity = BigInt(nativeLiquidityWei);
  const fee = (liquidity * BigInt(economics.creationFeeBps)) / BPS;
  const treasury = (fee * BigInt(economics.treasuryShareBps)) / BPS;
  return { fee, treasury, rewards: fee - treasury, total: liquidity + fee };
}

/// The three deadlines a creator is signing up to, from a launch at `startSeconds`.
export function checkInSchedule(startSeconds, economics) {
  const start = Number(startSeconds);
  return Array.from({ length: economics.requiredCheckIns }, (_, index) => {
    const opensAt = start + economics.cadenceSeconds * (index + 1);
    return {
      number: index + 1,
      opensAt,
      closesAt: opensAt + economics.gracePeriodSeconds,
    };
  });
}

/// Every state a submitted launch can be in. The interface must never call a submitted transaction
/// a completed launch: between the two there is a mempool, a possible revert, and an indexer that
/// may not have caught up.
export const LAUNCH_STATES = {
  idle: { label: "Not submitted", tone: "muted", done: false },
  signing: { label: "Waiting for your wallet", tone: "pending", done: false },
  pending: { label: "Submitted, waiting for a block", tone: "pending", done: false },
  reverted: { label: "Failed on chain — no token was created", tone: "error", done: true },
  mined: { label: "Confirmed on chain", tone: "success", done: true },
  indexing: { label: "Confirmed on chain, still indexing", tone: "partial", done: true },
  listed: { label: "Live and listed", tone: "success", done: true },
};

/// Decides what to tell the creator, given the transaction and how far the indexer has got.
/// A mined launch that the indexer has not seen is reported as such rather than hidden or
/// presented as complete: the token exists, the listing does not yet.
export function describeLaunch({ receiptStatus, confirmations = 0, indexed = false, indexerHealthy = true }) {
  if (receiptStatus === null || receiptStatus === undefined) {
    return { state: "pending", ...LAUNCH_STATES.pending, detail: "The transaction is in the mempool." };
  }
  if (Number(receiptStatus) !== 1) {
    return {
      state: "reverted",
      ...LAUNCH_STATES.reverted,
      detail: "The transaction reverted. You paid gas, but no token, pool, or escrow was created.",
    };
  }
  if (indexed) {
    return { state: "listed", ...LAUNCH_STATES.listed, detail: `Confirmed and indexed after ${confirmations} blocks.` };
  }
  if (!indexerHealthy) {
    return {
      state: "indexing",
      ...LAUNCH_STATES.indexing,
      detail:
        "Your token exists on chain and is safe. Our indexer is behind, so the public listing and "
        + "charts will appear late. Everything on this page was read directly from the chain.",
    };
  }
  return {
    state: "indexing",
    ...LAUNCH_STATES.indexing,
    detail: "Your token exists on chain. The public listing appears once the indexer catches up.",
  };
}
