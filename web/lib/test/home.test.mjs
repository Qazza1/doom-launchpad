import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readJson } from "../../../tools/lib/json-file.mjs";
import { DISCOVERY_SELECTORS, SELECTOR_SOURCES } from "../../discovery/selectors.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(directory, "../../..");
const home = await readFile(resolve(directory, "../../home.js"), "utf8");
const page = await readFile(resolve(directory, "../../index.html"), "utf8");

/// I inlined a guessed selector for totalNativeLiquidity while writing this page. It was wrong, and
/// a wrong selector does not error — it would have printed a confident, wrong "locked forever"
/// figure on the front page. Nothing here may carry a hex selector that no artifact vouches for.
test("the homepage contains no hand-written selectors", async () => {
  const inline = [...home.matchAll(/"0x[0-9a-f]{8}"/g)].map(match => match[0]);
  assert.deepEqual(inline, [], "selectors must come from the shared, artifact-checked module");

  const artifact = await readJson(
    resolve(projectRoot, "out/DoomLaunchFactory.sol/DoomLaunchFactory.json"),
  );
  for (const signature of ["launchesPaused()", "maxLaunches()", "totalNativeLiquidity()"]) {
    assert.equal(SELECTOR_SOURCES[signature], "DoomLaunchFactory");
    assert.equal(DISCOVERY_SELECTORS[signature], `0x${artifact.methodIdentifiers[signature]}`);
  }
});

test("every headline number is read from the chain, not written into the page", () => {
  // The markup carries labels and empty containers; the values arrive from the chain at run time.
  assert.match(page, /id="stats"><\/div>/);
  assert.match(page, /id="feed"><\/ul>/);
  assert.match(home, /stat\(stats, String\(count\)/);
  assert.match(home, /DISCOVERY_SELECTORS\["totalNativeLiquidity\(\)"\]/);
});

test("launching leads, and the NFT game keeps a place in the navigation", () => {
  const nav = page.slice(page.indexOf("<nav>"), page.indexOf("</nav>"));
  assert.match(nav, /href="\.\/launch-flow\/"[^>]*data-primary/, "launch is the primary link");
  assert.match(nav, /NFT GAME/, "the NFT game stays in the main navigation");
  assert.match(nav, /ANALYTICS/);
  assert.ok(nav.indexOf("LAUNCH") < nav.indexOf("ANALYTICS"), "launch comes before analytics");
  // These pages are served from the launchpad repository today and would move under the site
  // repository later. A relative path back to the analytics site is right in exactly one of those
  // two places, so it is absolute.
  assert.ok(!/href="\.\.\/\.\.\//.test(page), "no link may climb above the served root");
});

/// A homepage that shows a confident zero when it cannot reach the chain is worse than one that
/// shows nothing: zero launches is a claim, and an unreachable node is not evidence for it.
test("an unreachable chain is reported as unknown, never as zero", () => {
  const failure = home.slice(home.indexOf("load().catch"));
  assert.match(failure, /unknown rather than zero/);
  assert.match(failure, /\$\("#stats"\)\.replaceChildren\(\)/);
});

test("the homepage states the factory is a capped test and cannot serve the public", () => {
  assert.match(home, /test launches used/);
  assert.match(home, /public factory is not built yet/);
});

test("the homepage cannot send a transaction", () => {
  for (const forbidden of ["eth_sendTransaction", "eth_sendRawTransaction", "eth_sign", "window.ethereum", "privateKey"]) {
    assert.ok(!home.includes(forbidden), `home.js must not reference ${forbidden}`);
  }
  const methods = [...home.matchAll(/rpc\("([a-zA-Z_]+)"/g)].map(match => match[1]);
  assert.deepEqual([...new Set(methods)].sort(), ["eth_call", "eth_getBlockByNumber"]);
});

test("token names from untrusted contracts never reach the DOM as markup", () => {
  assert.ok(!/innerHTML/.test(home), "nothing on this page is assigned as markup");
  assert.match(home, /link\.textContent/);
  assert.match(home, /u0000-\\u001f\\u007f/);
});
