import assert from "node:assert/strict";
import test from "node:test";
import {
  CATEGORIES,
  TABS,
  categorizeLaunch,
  defaultTab,
  describeCountdown,
  describeEmpty,
  filterByTab,
  sortByUrgency,
  summarizeFeed,
} from "../feed.mjs";
import { ESCROW_STATUS, describeCommitment } from "../status.mjs";

const NOW = 1785700000;
const commitmentFor = (overrides, chainTime = NOW) => describeCommitment({
  status: ESCROW_STATUS.active,
  completedCheckIns: 0,
  requiredCheckIns: 3,
  nextCheckInAt: NOW + 3600,
  nextDeadline: NOW + 3600 + 43200,
  chainTime,
  ...overrides,
});

const itemFor = (overrides = {}, createdAt = NOW - 1000, chainTime = NOW) => {
  const commitment = commitmentFor(overrides, chainTime);
  return {
    record: { createdAt: BigInt(createdAt) },
    commitment,
    category: categorizeLaunch({ commitment, createdAt, chainTime }),
  };
};

test("each commitment state maps to a category a reader can act on", () => {
  assert.equal(itemFor().category.key, "waiting");
  assert.equal(itemFor({ nextCheckInAt: NOW - 60 }).category.key, "window_open");
  assert.equal(itemFor({ nextCheckInAt: NOW - 90000, nextDeadline: NOW - 60 }).category.key, "default_eligible");
  assert.equal(
    itemFor({ status: ESCROW_STATUS.completed, completedCheckIns: 3, nextCheckInAt: 0, nextDeadline: 0 }).category.key,
    "survived",
  );
  assert.equal(
    itemFor({ status: ESCROW_STATUS.defaulted, nextCheckInAt: 0, nextDeadline: 0 }).category.key,
    "defaulted",
  );
});

test("a launch is new for its first day, and a finished one never is", () => {
  assert.equal(itemFor({}, NOW - 3600).category.fresh, true);
  assert.equal(itemFor({}, NOW - 90_000).category.fresh, false);
  const finished = itemFor(
    { status: ESCROW_STATUS.completed, completedCheckIns: 3, nextCheckInAt: 0, nextDeadline: 0 },
    NOW - 3600,
  );
  assert.equal(finished.category.fresh, false);
});

/// The ordering is the product. A creator about to lose their allocation, and a watcher who can
/// finalise a missed one, both need to be at the top.
test("the most urgent launches sort first", () => {
  const waiting = itemFor();
  const open = itemFor({ nextCheckInAt: NOW - 60 });
  const missed = itemFor({ nextCheckInAt: NOW - 90000, nextDeadline: NOW - 60 });
  const survived = itemFor({ status: ESCROW_STATUS.completed, completedCheckIns: 3, nextCheckInAt: 0, nextDeadline: 0 });

  const sorted = sortByUrgency([survived, waiting, open, missed]);
  assert.deepEqual(sorted.map(item => item.category.key), [
    "default_eligible",
    "window_open",
    "waiting",
    "survived",
  ]);
});

test("inside a category the nearest deadline leads", () => {
  const sooner = itemFor({ nextCheckInAt: NOW - 60, nextDeadline: NOW + 1800 });
  const later = itemFor({ nextCheckInAt: NOW - 60, nextDeadline: NOW + 7200 });
  const sorted = sortByUrgency([later, sooner]);
  assert.equal(sorted[0].commitment.deadline, NOW + 1800);
});

test("tabs select what they claim to", () => {
  const items = [
    itemFor(),
    itemFor({ nextCheckInAt: NOW - 60 }),
    itemFor({ nextCheckInAt: NOW - 90000, nextDeadline: NOW - 60 }),
    itemFor({ status: ESCROW_STATUS.defaulted, nextCheckInAt: 0, nextDeadline: 0 }),
  ];
  assert.equal(filterByTab(items, "all").length, 4);
  assert.equal(filterByTab(items, "live").length, 3);
  assert.equal(filterByTab(items, "urgent").length, 2);
  assert.equal(filterByTab(items, "finished").length, 1);
  // An unknown tab shows everything rather than silently showing nothing.
  assert.equal(filterByTab(items, "nonsense").length, 4);
  // Three of the four were created moments ago, but a finished launch is never counted as new.
  assert.deepEqual(summarizeFeed(items), { all: 4, live: 3, urgent: 2, fresh: 3, finished: 1 });
});

/// An empty list has several meanings and they are not interchangeable.
test("an empty list explains which kind of empty it is", () => {
  assert.match(
    describeEmpty({ tab: "all", totalLaunches: 0, loadFailed: true }),
    /unknown rather than empty/,
  );
  assert.match(
    describeEmpty({ tab: "all", totalLaunches: 0 }),
    /No launches exist yet.*launch count of zero/s,
  );
  assert.match(
    describeEmpty({ tab: "all", totalLaunches: 0, indexerBehind: 500 }),
    /came from the factory contract directly/,
  );
  assert.match(
    describeEmpty({ tab: "urgent", totalLaunches: 3 }),
    /No launches are in "needs a check-in" right now\. 3 launch\(es\) exist/,
  );
});

/// Opening on an empty tab makes a healthy launchpad look broken, which is what happened the first
/// time this page was loaded with nothing urgent on it.
test("the opening tab is urgent only when something is urgent", () => {
  const calm = [itemFor()];
  assert.equal(defaultTab(calm), "all");

  const urgent = [itemFor(), itemFor({ nextCheckInAt: NOW - 60 })];
  assert.equal(defaultTab(urgent), "urgent");

  assert.equal(defaultTab([]), "all");
});

test("the countdown says how long is left, or how long ago it was missed", () => {
  const open = commitmentFor({ nextCheckInAt: NOW - 60, nextDeadline: NOW + 7200 });
  assert.equal(describeCountdown({ commitment: open, chainTime: NOW }), "2h 0m until the deadline");

  const missed = commitmentFor({ nextCheckInAt: NOW - 90000, nextDeadline: NOW - 3600 });
  assert.equal(describeCountdown({ commitment: missed, chainTime: NOW }), "Missed 1h 0m ago");

  const done = commitmentFor({ status: ESCROW_STATUS.completed, completedCheckIns: 3, nextCheckInAt: 0, nextDeadline: 0 });
  assert.equal(describeCountdown({ commitment: done, chainTime: NOW }), "Survived");
});

test("no category or tab invents data the chain cannot supply", () => {
  const names = [...Object.keys(CATEGORIES), ...Object.keys(TABS)].join(" ").toLowerCase();
  // Volume and market cap are not measured anywhere in this project yet, and graduation belongs to
  // a bonding curve that does not exist.
  for (const invented of ["trending", "graduating", "volume", "marketcap", "hot"]) {
    assert.ok(!names.includes(invented), `"${invented}" implies data this project does not have`);
  }
});
