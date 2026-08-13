import { describeGap } from "./status.mjs";

/// Grouping and ordering for the discovery list.
///
/// The categories are the ones this launchpad can actually compute from the chain, not the ones
/// copied from other launchpads. There is no "Trending" because that needs trade volume nobody here
/// is measuring yet, and no "Graduating" because graduation belongs to the bonding curve, which is
/// deferred with the v4 work. Inventing either would mean sorting tokens by a number the page made
/// up.
///
/// What this product does have, and no other launchpad does, is a countdown attached to every
/// token. So the list is ordered by how close each creator is to losing their allocation.

export const CATEGORIES = {
  default_eligible: {
    key: "default_eligible",
    label: "Deadline missed",
    tone: "error",
    urgency: 0,
    blurb: "The window closed. Anyone can finalise the default.",
  },
  window_open: {
    key: "window_open",
    label: "Check-in due now",
    tone: "pending",
    urgency: 1,
    blurb: "The creator has to check in before the deadline.",
  },
  waiting: {
    key: "waiting",
    label: "Streak alive",
    tone: "muted",
    urgency: 2,
    blurb: "Between check-ins.",
  },
  survived: {
    key: "survived",
    label: "Survived",
    tone: "success",
    urgency: 3,
    blurb: "All check-ins made. The allocation was released.",
  },
  defaulted: {
    key: "defaulted",
    label: "Dead",
    tone: "error",
    urgency: 4,
    blurb: "The streak was broken and finalised.",
  },
};

/// A launch is "fresh" for its first day. It is a label on top of the category, not a category of
/// its own, because a new launch is still waiting for its first check-in like any other.
export const FRESH_SECONDS = 86_400;

export function categorizeLaunch({ commitment, createdAt, chainTime }) {
  const category = CATEGORIES[commitment.state] ?? CATEGORIES.waiting;
  const age = Number(chainTime) - Number(createdAt);
  return {
    ...category,
    fresh: age >= 0 && age < FRESH_SECONDS && category.urgency <= 2,
    ageSeconds: Math.max(0, age),
  };
}

/// Most urgent first. Within a category, the nearest deadline leads, because that is the one a
/// creator or a watcher needs to act on soonest. A launch with no deadline left sorts by age.
export function sortByUrgency(items) {
  return [...items].sort((left, right) => {
    if (left.category.urgency !== right.category.urgency) {
      return left.category.urgency - right.category.urgency;
    }
    const leftDeadline = Number(left.commitment.deadline ?? 0);
    const rightDeadline = Number(right.commitment.deadline ?? 0);
    if (leftDeadline && rightDeadline && leftDeadline !== rightDeadline) {
      return leftDeadline - rightDeadline;
    }
    return Number(right.record.createdAt) - Number(left.record.createdAt);
  });
}

export const TABS = {
  all: { key: "all", label: "All", includes: () => true },
  live: { key: "live", label: "Live", includes: item => item.category.urgency <= 2 },
  urgent: {
    key: "urgent",
    label: "Needs a check-in",
    includes: item => item.category.key === "window_open" || item.category.key === "default_eligible",
  },
  fresh: { key: "fresh", label: "New", includes: item => item.category.fresh },
  finished: {
    key: "finished",
    label: "Finished",
    includes: item => item.category.key === "survived" || item.category.key === "defaulted",
  },
};

export function filterByTab(items, tab) {
  const definition = TABS[tab] ?? TABS.all;
  return items.filter(item => definition.includes(item));
}

/// Open on the urgent tab when something is actually urgent, and on everything otherwise. Landing on
/// an empty list by default makes a healthy launchpad look like a broken one.
export function defaultTab(items) {
  return filterByTab(items, "urgent").length > 0 ? "urgent" : "all";
}

export function summarizeFeed(items) {
  const counts = {};
  for (const key of Object.keys(TABS)) counts[key] = filterByTab(items, key).length;
  return counts;
}

/// What to say when a tab has nothing in it. An empty list has at least three different meanings and
/// showing the same shrug for all of them is how a stalled backend gets mistaken for a quiet market.
export function describeEmpty({ tab, totalLaunches, loadFailed = false, indexerBehind = null }) {
  if (loadFailed) {
    return "The chain could not be read, so this list is unknown rather than empty. Nothing here is a "
      + "statement about how many launches exist.";
  }
  if (totalLaunches === 0) {
    const suffix = indexerBehind
      ? " Our indexer is behind, but this count came from the factory contract directly, so it is correct."
      : "";
    return `No launches exist yet. The factory reports a launch count of zero.${suffix}`;
  }
  const label = (TABS[tab] ?? TABS.all).label.toLowerCase();
  return `No launches are in "${label}" right now. ${totalLaunches} launch(es) exist in total — `
    + "switch to All to see them.";
}

/// One line per row, describing the thing a reader actually wants: how long is left.
export function describeCountdown({ commitment, chainTime }) {
  if (!commitment.deadline) return commitment.label;
  const remaining = Number(commitment.deadline) - Number(chainTime);
  if (remaining <= 0) return `Missed ${describeGap(-remaining)} ago`;
  return `${describeGap(remaining)} until the deadline`;
}
