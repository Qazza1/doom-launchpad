import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CONTRACT_DIGEST, SOURCE_COMMIT, buildLaunchPlan } from "../launch-plan.mjs";
import {
  buildObserved,
  compareProviders,
  fingerprint,
  preflight,
  readProvider,
  validateBalance,
} from "../preflight.mjs";
import { validateAgainstChain } from "../plan-guards.mjs";

const artifact = JSON.parse(
  await readFile(new URL("../../../out/DoomLaunchFactory.sol/DoomLaunchFactory.json", import.meta.url), "utf8"),
);
const selectors = {
  paused: `0x${artifact.methodIdentifiers["launchesPaused()"]}`,
  launchCount: `0x${artifact.methodIdentifiers["launchCount()"]}`,
  totalNativeLiquidity: `0x${artifact.methodIdentifiers["totalNativeLiquidity()"]}`,
};
const addresses = { DoomLaunchFactory: "0xDC0DF0Ba9e519D1E082F8B45307450F418eED9dE" };
const word = value => `0x${BigInt(value).toString(16).padStart(64, "0")}`;

/// A fake chain. Tests never touch a live RPC.
function fakeProvider(state = {}) {
  const { chainId = 4663, nonce = 7, balance = 414450702016000n, paused = 0, launchCount = 0, liquidity = 0, code = "0x6080" } = state;
  return async (_url, options) => {
    const { method, params } = JSON.parse(options.body);
    const result = method === "eth_chainId" ? word(chainId)
      : method === "eth_getTransactionCount" ? word(nonce)
      : method === "eth_getBalance" ? word(balance)
      : method === "eth_getCode" ? code
      : method === "eth_call" ? (
        params[0].data === selectors.paused ? word(paused)
          : params[0].data === selectors.launchCount ? word(launchCount)
          : word(liquidity)
      )
      : null;
    return { ok: true, json: async () => ({ result }) };
  };
}

const read = (state, label = "primary") =>
  readProvider({ url: "https://a.example", selectors, addresses, fetchImpl: fakeProvider(state), label });

test("a provider reading captures everything a plan is checked against", async () => {
  const reading = await read({ nonce: 7, paused: 1, launchCount: 0, liquidity: 0 });
  assert.equal(reading.chainId, 4663);
  assert.equal(reading.pendingNonce, 7);
  assert.equal(reading.paused, true);
  assert.equal(reading.launchCount, "0");
  assert.equal(reading.totalNativeLiquidity, "0");
  assert.equal(reading.balanceWei, "414450702016000");
  assert.match(reading.code.DoomLaunchFactory, /^[0-9a-f]{16}$/);
});

test("a wrong chain or missing code stops the preflight rather than being reported", async () => {
  await assert.rejects(read({ chainId: 1 }), /reports chain 1/);
  await assert.rejects(read({ code: "0x" }), /no code at DoomLaunchFactory/);
});

test("providers must agree on every field", async () => {
  const base = await read({ paused: 1 });
  assert.deepEqual(compareProviders(base, { ...base, label: "fallback" }), []);

  const cases = [
    [{ pendingNonce: 9 }, "pending nonce"],
    [{ balanceWei: "1" }, "deployer balance"],
    [{ paused: false }, "whether the factory is paused"],
    [{ launchCount: "1" }, "launch count"],
    [{ totalNativeLiquidity: "1" }, "aggregate native liquidity"],
    [{ code: { DoomLaunchFactory: "beefbeefbeefbeef" } }, "deployed bytecode for DoomLaunchFactory"],
  ];
  for (const [change, expected] of cases) {
    const errors = compareProviders(base, { ...base, ...change });
    assert.ok(errors.some(item => item.includes(expected)), `${expected} must be caught`);
  }
});

test("a full preflight surfaces disagreement instead of silently preferring one provider", async () => {
  const identity = { contractDigest: CONTRACT_DIGEST, sourceCommit: SOURCE_COMMIT };
  const agreeing = await preflight({
    primaryUrl: "https://a.example",
    fallbackUrl: "https://b.example",
    selectors,
    addresses,
    identity,
    fetchImpl: fakeProvider({ paused: 1 }),
  });
  assert.deepEqual(agreeing.disagreements, []);
  assert.equal(agreeing.observed.paused, true);
  assert.equal(agreeing.observed.contractDigest, CONTRACT_DIGEST);
  assert.equal(agreeing.observed.sourceCommit, SOURCE_COMMIT);
});

test("the observed object feeds the guards directly", async () => {
  // The point of Stage C: what the preflight produces is exactly what Stage B consumes.
  const plan = buildLaunchPlan({
    selector: `0x${artifact.methodIdentifiers["launch((string,string,uint256,uint256))"]}`,
    nonce: 7,
    expiresAt: 1_800_000_000,
    name: "DoomStreak Canary Test 1",
    symbol: "DCT1",
    wholeSupply: 1_000_000_000n,
  });
  const reading = await read({ nonce: 7, paused: 0, launchCount: 0, liquidity: 0 });
  const observed = buildObserved(reading, { contractDigest: CONTRACT_DIGEST, sourceCommit: SOURCE_COMMIT });
  assert.deepEqual(validateAgainstChain(plan, observed), []);

  // A nonce that moved between planning and submission is caught through the same path.
  const moved = buildObserved(await read({ nonce: 8, paused: 0 }), {
    contractDigest: CONTRACT_DIGEST,
    sourceCommit: SOURCE_COMMIT,
  });
  assert.ok(validateAgainstChain(plan, moved).some(item => item.includes("pending nonce")));
});

test("balance must cover the plan value plus stated gas headroom", async () => {
  const plan = { valueWei: "10000000000000000" };
  const rich = { balanceWei: "20000000000000000" };
  const poor = { balanceWei: "10000000000000001" };
  assert.deepEqual(validateBalance(rich, plan, "1000000000000000"), []);
  assert.ok(validateBalance(poor, plan, "1000000000000000")[0].includes("below the required"));
});

test("fingerprints are stable and case-insensitive", () => {
  assert.equal(fingerprint("0xABCD"), fingerprint("0xabcd"));
  assert.notEqual(fingerprint("0xabcd"), fingerprint("0xabce"));
});

test("the preflight module never signs or sends", async () => {
  const source = await readFile(new URL("../preflight.mjs", import.meta.url), "utf8");
  for (const forbidden of ["privateKey", "PRIVATE_KEY", "sendTransaction", "signTransaction", "Wallet(", "eth_sendRawTransaction"]) {
    assert.equal(source.includes(forbidden), false, `preflight must not reference ${forbidden}`);
  }
});
