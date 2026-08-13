/// How a launch's state is described to the public.
///
/// Three distinctions this file exists to keep straight, because collapsing any of them tells
/// somebody a comfortable lie about money:
///
///   1. **Default eligible is not defaulted.** After a missed deadline the escrow can be finalised
///      by anyone, but until someone does, the creator has still not lost it and the tokens have
///      not moved. Showing "defaulted" early would be wrong; hiding the exposure would be worse.
///   2. **Permanent liquidity needs two proofs.** The launch record saying `liquidityPermanent`
///      is the factory's claim about the past. Reading `ownerOf` now is the chain's answer today.
///      Only both together justify the word "permanent" on a public page.
///   3. **Fresh is not the same as true.** Every read is pinned to one block, and the page says
///      which block and how old it is, so a stale page cannot pass itself off as live.

export const ESCROW_STATUS = { active: 0, completed: 1, defaulted: 2 };

/// `nextCheckInAt` and `nextDeadline` return 0 once the commitment is resolved, so a finished
/// commitment must never be rendered as having a deadline in 1970.
export function describeCommitment({ status, completedCheckIns, requiredCheckIns, nextCheckInAt, nextDeadline, chainTime }) {
  const done = Number(completedCheckIns);
  const required = Number(requiredCheckIns);
  const progress = { done, required, label: `${done}/${required}` };

  if (Number(status) === ESCROW_STATUS.completed) {
    return {
      state: "survived",
      label: "Survived",
      tone: "success",
      progress,
      detail: `All ${required} check-ins made. Full allocation released to the creator.`,
      deadline: null,
    };
  }
  if (Number(status) === ESCROW_STATUS.defaulted) {
    return {
      state: "defaulted",
      label: "Defaulted",
      tone: "error",
      progress,
      detail:
        `Ended after ${done} of ${required} check-ins. Everything unreleased went to the rewards `
        + "vault permanently. Check-ins already made were not taken back.",
      deadline: null,
    };
  }

  const now = Number(chainTime);
  const opens = Number(nextCheckInAt);
  const closes = Number(nextDeadline);

  if (now > closes) {
    return {
      state: "default_eligible",
      label: "Deadline missed — not yet finalised",
      tone: "error",
      progress,
      detail:
        `Window closed ${describeGap(now - closes)} ago. Anyone can now finalise the default. `
        + "Until someone does, nothing has moved.",
      deadline: closes,
    };
  }
  if (now >= opens) {
    return {
      state: "window_open",
      label: "Check-in window open",
      tone: "pending",
      progress,
      detail: `${describeGap(closes - now)} left to check in.`,
      deadline: closes,
    };
  }
  return {
    state: "waiting",
    label: "Waiting for the next window",
    tone: "muted",
    progress,
    detail: `Next window opens in ${describeGap(opens - now)}, closes ${describeGap(closes - opens)} later.`,
    deadline: closes,
  };
}

export function describeGap(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  if (hours >= 1) return `${hours}h ${minutes}m`;
  if (minutes >= 1) return `${minutes}m`;
  return `${total}s`;
}

/// "Permanent" is only claimed when the record says so *and* the position manager still reports the
/// locker as the owner. Either alone is not enough to put the word on a public page.
export function describePermanence({ recordSaysPermanent, positionId, positionOwner, expectedLocker, verifiedAtBlock }) {
  const ownedByLocker = String(positionOwner ?? "").toLowerCase() === String(expectedLocker ?? "").toLowerCase();
  const hasPosition = BigInt(positionId ?? 0) > 0n;

  if (recordSaysPermanent && ownedByLocker && hasPosition) {
    return {
      proven: true,
      tone: "success",
      label: "Permanently locked",
      detail:
        `Held by the locker, verified at block ${verifiedAtBlock}. No release function exists.`,
    };
  }
  if (recordSaysPermanent && !ownedByLocker) {
    return {
      proven: false,
      tone: "error",
      label: "Claim not verified",
      detail:
        `The record says permanent, but the position manager reports the owner as ${positionOwner}. `
        + "Do not treat this liquidity as locked.",
    };
  }
  return {
    proven: false,
    tone: "error",
    label: "Not permanent",
    detail: "Not recorded as permanently locked liquidity.",
  };
}

/// Where the numbers came from and how old they are. A page that cannot say this should not be
/// trusted with a risk decision.
export function describeFreshness({ blockNumber, blockTime, wallClock, indexerBehind = null }) {
  const age = Math.max(0, Math.floor(Number(wallClock) - Number(blockTime)));
  const stale = age > 300;
  const parts = [
    `Read directly from the chain at block ${blockNumber}, ${describeGap(age)} old.`,
  ];
  if (indexerBehind === null) {
    parts.push("The indexer was not consulted for these figures.");
  } else if (indexerBehind > 0) {
    parts.push(
      `Our indexer is ${indexerBehind.toLocaleString("en-US")} blocks behind, so listings and charts `
      + "elsewhere on the site may be missing this launch. The figures above do not depend on it.",
    );
  } else {
    parts.push("The indexer agrees and is at the confirmed head.");
  }
  return {
    tone: stale ? "partial" : "success",
    confidence: stale ? "low" : "high",
    ageSeconds: age,
    detail: parts.join(" "),
  };
}

/// The allocation, reconciled rather than restated. If these do not add up the page says so instead
/// of printing three numbers that happen to look plausible.
export function reconcileAllocation(record) {
  const total = record.creatorLiquidAmount + record.liquidityTokenAmountAllocated + record.escrowTokenAmount;
  const liquidity = record.liquidityTokenAmountUsed + record.liquidityTokenRemainder;
  return {
    supplyReconciles: total === record.totalSupply,
    liquidityReconciles: liquidity === record.liquidityTokenAmountAllocated,
    feeReconciles: record.treasuryFee + record.nftRewardFee === record.creationFee,
  };
}
