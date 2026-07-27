/// Death Watch turns the GM commitment into something people can watch. Every live streak has a
/// deadline, a number of tokens riding on it, and a public outcome. This module derives that state
/// and decides which transitions are worth broadcasting. It reads nothing and sends nothing.

export const PHASE = {
  waiting: "waiting",
  open: "window_open",
  finalizable: "finalizable",
  survived: "survived",
  dead: "dead",
};

/// Escrow status enum as declared in GmEscrow.
export const ESCROW_STATUS = { active: 0, completed: 1, defaulted: 2 };

/// A window with less than this left is the part worth watching.
export const CRITICAL_SECONDS = 3600;

const asNumber = value => Number(value ?? 0);
const asBigInt = value => BigInt(value ?? 0);

/// Human countdown. Deliberately coarse: a feed reading "2h 14m" is easier to scan than "2:14:07",
/// and seconds only matter once almost nothing is left.
export function formatCountdown(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds)));
  if (total === 0) return "0s";
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

/// Which part of the schedule a commitment is in right now.
export function phaseOf(escrow, now) {
  const status = asNumber(escrow.status);
  if (status === ESCROW_STATUS.completed) return PHASE.survived;
  if (status === ESCROW_STATUS.defaulted) return PHASE.dead;

  const due = asNumber(escrow.nextCheckInAt);
  const deadline = asNumber(escrow.nextDeadline);
  const at = asNumber(now);
  // Past the deadline while still active means anyone can finalise the default. The commitment is
  // not dead yet, but it is no longer savable, and that distinction is the whole drama.
  if (at > deadline) return PHASE.finalizable;
  if (at >= due) return PHASE.open;
  return PHASE.waiting;
}

/// Sort key: what a viewer should look at first. Lower sorts earlier.
export function urgencyOf(entry) {
  if (entry.phase === PHASE.finalizable) return 0;
  if (entry.phase === PHASE.open) return entry.secondsRemaining <= CRITICAL_SECONDS ? 1 : 2;
  if (entry.phase === PHASE.waiting) return 3;
  if (entry.phase === PHASE.dead) return 4;
  return 5;
}

/// Builds one feed entry from a launch record and its escrow state.
export function deriveEntry({ launch, escrow, now }) {
  const phase = phaseOf(escrow, now);
  const at = asNumber(now);
  const due = asNumber(escrow.nextCheckInAt);
  const deadline = asNumber(escrow.nextDeadline);
  const committed = asBigInt(escrow.committedAmount);
  const released = asBigInt(escrow.releasedAmount);

  const secondsRemaining = phase === PHASE.open
    ? Math.max(0, deadline - at)
    : phase === PHASE.waiting
      ? Math.max(0, due - at)
      : 0;

  return {
    launchId: asNumber(launch.launchId),
    token: launch.token,
    name: launch.name ?? null,
    symbol: launch.symbol ?? null,
    creator: launch.creator,
    escrow: launch.creatorEscrow,
    phase,
    // What dies if this deadline is missed. Honoured check-ins are already the creator's.
    atStake: (committed - released).toString(),
    released: released.toString(),
    committed: committed.toString(),
    checkInsDone: asNumber(escrow.completedCheckIns),
    checkInsRequired: asNumber(escrow.requiredCheckIns),
    nextCheckInAt: due,
    nextDeadline: deadline,
    secondsRemaining,
    countdown: formatCountdown(secondsRemaining),
    critical: phase === PHASE.open && secondsRemaining <= CRITICAL_SECONDS,
  };
}

export function buildFeed(launches, now) {
  return launches
    .map(item => deriveEntry({ ...item, now }))
    .sort((left, right) => {
      const byUrgency = urgencyOf(left) - urgencyOf(right);
      if (byUrgency !== 0) return byUrgency;
      // Within a tier, whatever resolves soonest leads.
      if (left.secondsRemaining !== right.secondsRemaining) {
        return left.secondsRemaining - right.secondsRemaining;
      }
      return left.launchId - right.launchId;
    });
}

const label = entry => entry.symbol || entry.name || `launch #${entry.launchId}`;

/// Transitions worth telling people about. A feed that announces every poll is noise nobody reads,
/// so this only fires on state changes, and the final-hour warning fires once per window.
export function feedEvents(previous, current) {
  const before = new Map((previous || []).map(entry => [entry.launchId, entry]));
  const events = [];

  for (const entry of current) {
    const last = before.get(entry.launchId);

    if (!last) {
      if (entry.phase !== PHASE.dead && entry.phase !== PHASE.survived) {
        events.push({ kind: "launched", entry, severity: "info" });
      }
      continue;
    }

    if (entry.checkInsDone > last.checkInsDone) {
      events.push({ kind: "checked_in", entry, severity: "info" });
    }
    if (entry.phase !== last.phase) {
      if (entry.phase === PHASE.open) events.push({ kind: "window_open", entry, severity: "warning" });
      if (entry.phase === PHASE.finalizable) {
        events.push({ kind: "deadline_missed", entry, severity: "critical" });
      }
      if (entry.phase === PHASE.survived) events.push({ kind: "survived", entry, severity: "info" });
      if (entry.phase === PHASE.dead) events.push({ kind: "defaulted", entry, severity: "critical" });
    } else if (entry.critical && !last.critical && entry.phase === PHASE.open) {
      events.push({ kind: "final_hour", entry, severity: "warning" });
    }
  }
  return events;
}

/// Renders an event as the alert shape the keeper's Telegram sender already accepts.
export function toAlert(event) {
  const entry = event.entry;
  const who = label(entry);
  const day = `${entry.checkInsDone}/${entry.checkInsRequired}`;

  const messages = {
    launched: {
      title: `${who} entered the arena`,
      summary: `A new commitment is live. ${day} check-ins done.`,
    },
    window_open: {
      title: `${who} must check in`,
      summary: `The GM window is open and closes in ${entry.countdown}.`,
    },
    final_hour: {
      title: `${who} has ${entry.countdown} left`,
      summary: `Final hour of the window. Miss it and the escrow goes to NFT holders.`,
    },
    checked_in: {
      title: `${who} survived day ${entry.checkInsDone}`,
      summary: `${day} check-ins done. A share of the escrow just released.`,
    },
    deadline_missed: {
      title: `${who} missed the deadline`,
      summary: `The window closed. Anyone can now finalise the default.`,
    },
    survived: {
      title: `${who} survived the streak`,
      summary: `All ${entry.checkInsRequired} check-ins honoured. The escrow is fully released.`,
    },
    defaulted: {
      title: `${who} is dead`,
      summary: `The commitment defaulted. The unreleased escrow went to DoomStreak NFT holders.`,
    },
  };

  const message = messages[event.kind];
  if (!message) throw new Error(`unknown death watch event: ${event.kind}`);

  return {
    id: `deathwatch:${event.kind}:${entry.launchId}:${entry.checkInsDone}`,
    severity: event.severity,
    title: message.title,
    summary: message.summary,
    details: [
      `Token ${entry.token}`,
      `Creator ${entry.creator}`,
      `At stake ${entry.atStake}`,
    ],
  };
}
