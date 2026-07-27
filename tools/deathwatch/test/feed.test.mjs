import assert from "node:assert/strict";
import test from "node:test";
import {
  CRITICAL_SECONDS,
  ESCROW_STATUS,
  PHASE,
  buildFeed,
  deriveEntry,
  feedEvents,
  formatCountdown,
  phaseOf,
  toAlert,
  urgencyOf,
} from "../feed.mjs";

const NOW = 1_800_000_000;
const launch = (id, extra = {}) => ({
  launchId: id,
  token: `0x${String(id).repeat(40).slice(0, 40)}`,
  creator: "0xcaB166ed15e63b846Ec8D1a2d6762a33392c796F",
  creatorEscrow: "0x3333333333333333333333333333333333333333",
  symbol: `DOOM${id}`,
  ...extra,
});
const escrow = (extra = {}) => ({
  status: ESCROW_STATUS.active,
  completedCheckIns: 0,
  requiredCheckIns: 3,
  committedAmount: 600_000_000n,
  releasedAmount: 0n,
  nextCheckInAt: NOW + 3600,
  nextDeadline: NOW + 3600 + 43_200,
  ...extra,
});

test("countdowns read the way a person scans them", () => {
  assert.equal(formatCountdown(0), "0s");
  assert.equal(formatCountdown(45), "45s");
  assert.equal(formatCountdown(605), "10m 5s");
  assert.equal(formatCountdown(8045), "2h 14m");
  assert.equal(formatCountdown(180_000), "2d 2h");
  // Never render a negative countdown as a negative number.
  assert.equal(formatCountdown(-500), "0s");
});

test("the phase distinguishes waiting, open, and past saving", () => {
  assert.equal(phaseOf(escrow(), NOW), PHASE.waiting);
  assert.equal(phaseOf(escrow({ nextCheckInAt: NOW - 1 }), NOW), PHASE.open);
  assert.equal(phaseOf(escrow({ nextCheckInAt: NOW }), NOW), PHASE.open);
  // Exactly on the deadline is still savable; one second later is not.
  assert.equal(phaseOf(escrow({ nextCheckInAt: NOW - 100, nextDeadline: NOW }), NOW), PHASE.open);
  assert.equal(
    phaseOf(escrow({ nextCheckInAt: NOW - 100, nextDeadline: NOW - 1 }), NOW),
    PHASE.finalizable,
  );
  assert.equal(phaseOf(escrow({ status: ESCROW_STATUS.completed }), NOW), PHASE.survived);
  assert.equal(phaseOf(escrow({ status: ESCROW_STATUS.defaulted }), NOW), PHASE.dead);
});

test("at stake is what a missed deadline actually costs, not the whole commitment", () => {
  const entry = deriveEntry({
    launch: launch(1),
    escrow: escrow({ completedCheckIns: 1, releasedAmount: 200_000_000n }),
    now: NOW,
  });
  // Two thirds still riding on it; the honoured check-in is already the creator's.
  assert.equal(entry.atStake, "400000000");
  assert.equal(entry.released, "200000000");
  assert.equal(entry.committed, "600000000");
  assert.equal(entry.checkInsDone, 1);
});

test("the countdown targets the deadline once the window is open", () => {
  const waiting = deriveEntry({ launch: launch(1), escrow: escrow(), now: NOW });
  assert.equal(waiting.phase, PHASE.waiting);
  assert.equal(waiting.secondsRemaining, 3600);
  assert.equal(waiting.critical, false);

  const open = deriveEntry({
    launch: launch(1),
    escrow: escrow({ nextCheckInAt: NOW - 60, nextDeadline: NOW + 900 }),
    now: NOW,
  });
  assert.equal(open.phase, PHASE.open);
  assert.equal(open.secondsRemaining, 900);
  assert.equal(open.countdown, "15m 0s");
  assert.equal(open.critical, true);

  const resolved = deriveEntry({
    launch: launch(1),
    escrow: escrow({ status: ESCROW_STATUS.dead ?? ESCROW_STATUS.defaulted }),
    now: NOW,
  });
  assert.equal(resolved.secondsRemaining, 0);
});

test("a waiting streak is not marked critical no matter how close the next window is", () => {
  const entry = deriveEntry({
    launch: launch(1),
    escrow: escrow({ nextCheckInAt: NOW + 30 }),
    now: NOW,
  });
  // Critical means "about to be lost", not "about to open".
  assert.equal(entry.phase, PHASE.waiting);
  assert.equal(entry.critical, false);
});

test("the feed leads with whatever is closest to dying", () => {
  const feed = buildFeed(
    [
      { launch: launch(1), escrow: escrow() },
      { launch: launch(2), escrow: escrow({ status: ESCROW_STATUS.defaulted }) },
      { launch: launch(3), escrow: escrow({ nextCheckInAt: NOW - 10, nextDeadline: NOW + 600 }) },
      { launch: launch(4), escrow: escrow({ nextCheckInAt: NOW - 10, nextDeadline: NOW + 30_000 }) },
      { launch: launch(5), escrow: escrow({ nextCheckInAt: NOW - 99, nextDeadline: NOW - 1 }) },
      { launch: launch(6), escrow: escrow({ status: ESCROW_STATUS.completed }) },
    ],
    NOW,
  );

  assert.deepEqual(feed.map(entry => entry.launchId), [5, 3, 4, 1, 2, 6]);
  assert.equal(urgencyOf(feed[0]), 0);
  assert.ok(urgencyOf(feed[0]) < urgencyOf(feed[1]));
});

test("only real transitions are broadcast", () => {
  const before = buildFeed([{ launch: launch(1), escrow: escrow() }], NOW);
  assert.deepEqual(feedEvents(before, before), [], "an unchanged poll must say nothing");

  const opened = buildFeed(
    [{ launch: launch(1), escrow: escrow({ nextCheckInAt: NOW - 1, nextDeadline: NOW + 40_000 }) }],
    NOW,
  );
  assert.deepEqual(feedEvents(before, opened).map(item => item.kind), ["window_open"]);

  const checkedIn = buildFeed(
    [{
      launch: launch(1),
      escrow: escrow({ completedCheckIns: 1, releasedAmount: 200_000_000n }),
    }],
    NOW,
  );
  assert.deepEqual(feedEvents(before, checkedIn).map(item => item.kind), ["checked_in"]);

  const missed = buildFeed(
    [{ launch: launch(1), escrow: escrow({ nextCheckInAt: NOW - 99, nextDeadline: NOW - 1 }) }],
    NOW,
  );
  assert.deepEqual(feedEvents(opened, missed).map(item => item.kind), ["deadline_missed"]);

  const dead = buildFeed([{ launch: launch(1), escrow: escrow({ status: ESCROW_STATUS.defaulted }) }], NOW);
  const deathEvents = feedEvents(missed, dead);
  assert.deepEqual(deathEvents.map(item => item.kind), ["defaulted"]);
  assert.equal(deathEvents[0].severity, "critical");

  const survived = buildFeed(
    [{
      launch: launch(1),
      escrow: escrow({ status: ESCROW_STATUS.completed, completedCheckIns: 3, releasedAmount: 600_000_000n }),
    }],
    NOW,
  );
  // A final check-in both completes the streak and releases a share; both are worth saying.
  assert.deepEqual(feedEvents(before, survived).map(item => item.kind), ["checked_in", "survived"]);
});

test("the final-hour warning fires once, not on every poll", () => {
  const roomy = buildFeed(
    [{ launch: launch(1), escrow: escrow({ nextCheckInAt: NOW - 1, nextDeadline: NOW + CRITICAL_SECONDS + 60 }) }],
    NOW,
  );
  const tight = buildFeed(
    [{ launch: launch(1), escrow: escrow({ nextCheckInAt: NOW - 1, nextDeadline: NOW + 600 }) }],
    NOW,
  );
  const tighter = buildFeed(
    [{ launch: launch(1), escrow: escrow({ nextCheckInAt: NOW - 1, nextDeadline: NOW + 300 }) }],
    NOW,
  );

  assert.deepEqual(feedEvents(roomy, tight).map(item => item.kind), ["final_hour"]);
  assert.deepEqual(feedEvents(tight, tighter), [], "already critical must not warn again");
});

test("a launch appearing for the first time announces itself, unless it is already resolved", () => {
  const fresh = buildFeed([{ launch: launch(7), escrow: escrow() }], NOW);
  assert.deepEqual(feedEvents([], fresh).map(item => item.kind), ["launched"]);

  const alreadyDead = buildFeed(
    [{ launch: launch(8), escrow: escrow({ status: ESCROW_STATUS.defaulted }) }],
    NOW,
  );
  // Backfilling history must not spam the channel with obituaries for old launches.
  assert.deepEqual(feedEvents([], alreadyDead), []);
});

test("events render into the alert shape the Telegram sender already accepts", () => {
  const entry = buildFeed(
    [{ launch: launch(1), escrow: escrow({ nextCheckInAt: NOW - 1, nextDeadline: NOW + 600 }) }],
    NOW,
  )[0];

  const alert = toAlert({ kind: "final_hour", entry, severity: "warning" });
  assert.equal(alert.severity, "warning");
  assert.ok(alert.title.includes("DOOM1"));
  assert.ok(alert.summary.includes("Final hour"));
  assert.ok(alert.details.some(detail => detail.startsWith("At stake")));
  assert.ok(alert.id.startsWith("deathwatch:final_hour:1:"));

  // Distinct ids per check-in stop the keeper's de-duplication from swallowing later days.
  const day2 = toAlert({ kind: "checked_in", entry: { ...entry, checkInsDone: 2 }, severity: "info" });
  assert.notEqual(alert.id, day2.id);

  assert.throws(() => toAlert({ kind: "nonsense", entry, severity: "info" }), /unknown death watch/);
});

test("onchain token text is decoded defensively", async () => {
  const { decodeString } = await import("../watch.mjs");
  const encode = text => {
    const bytes = Buffer.from(text, "utf8");
    return "0x" + "20".padStart(64, "0")
      + bytes.length.toString(16).padStart(64, "0")
      + bytes.toString("hex").padEnd(64, "0");
  };

  assert.equal(decodeString(encode("DOOM")), "DOOM");
  assert.equal(decodeString("0x"), null);
  assert.equal(decodeString(null), null);

  // A creator controls this string. Control characters must not survive into a feed line or a
  // Telegram message.
  assert.equal(decodeString(encode("DO OM\n[31m")), "DOOM[31m");
  // An absurd declared length is rejected rather than trusted.
  assert.equal(
    decodeString("0x" + "20".padStart(64, "0") + (9999).toString(16).padStart(64, "0")),
    null,
  );
});

test("a launch with no symbol still reads sensibly", () => {
  const entry = buildFeed(
    [{ launch: { ...launch(9), symbol: null, name: null }, escrow: escrow() }],
    NOW,
  )[0];
  const alert = toAlert({ kind: "launched", entry, severity: "info" });
  assert.ok(alert.title.includes("launch #9"));
});
