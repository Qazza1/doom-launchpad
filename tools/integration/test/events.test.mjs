import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const integration = JSON.parse(
  await readFile(
    new URL("../../../integration/indexer/doom-launchpad-events.json", import.meta.url),
    "utf8",
  ),
);

const REQUIRED_CONTRACTS = [
  "DoomLaunchFactory",
  "DoomRewards",
  "GmEscrow",
  "PositionLocker",
  "V3LiquidityManager",
];

/// Names are harmless, but `indexed` placement is not: it controls whether a value is decoded from
/// a topic or the data body. Compare both the topic signature and indexed layout.
function canonicalFromAbi(entry) {
  const types = (entry.inputs || [])
    .map(input => `${input.type}${input.indexed ? " indexed" : ""}`)
    .join(",");
  return `${entry.name}(${types})`;
}

function canonicalFromDeclaration(declaration) {
  const match = declaration.match(/^event\s+(\w+)\s*\((.*)\)$/s);
  if (!match) throw new Error(`malformed event declaration: ${declaration}`);
  const args = match[2].trim();
  if (!args) return `${match[1]}()`;
  const types = args.split(",").map(part => {
    const fields = part.trim().split(/\s+/);
    return `${fields[0]}${fields.includes("indexed") ? " indexed" : ""}`;
  }).join(",");
  return `${match[1]}(${types})`;
}

async function abiEvents(contract) {
  const artifact = JSON.parse(
    await readFile(new URL(`../../../out/${contract}.sol/${contract}.json`, import.meta.url), "utf8"),
  );
  return artifact.abi.filter(entry => entry.type === "event").map(canonicalFromAbi);
}

test("the integration guard covers every launchpad event source", () => {
  assert.deepEqual(Object.keys(integration.contracts).sort(), REQUIRED_CONTRACTS);
});

test("indexed event fields are part of the guarded layout", () => {
  assert.equal(
    canonicalFromDeclaration("event Example(uint256 indexed launchId,address creator)"),
    "Example(uint256 indexed,address)",
  );
  assert.notEqual(
    canonicalFromDeclaration("event Example(uint256 indexed launchId,address creator)"),
    canonicalFromDeclaration("event Example(uint256 launchId,address indexed creator)"),
  );
});

test("every event the contracts emit is declared for the indexer", async () => {
  // An event the contracts emit but the integration file omits is invisible to the indexer, and
  // therefore invisible on the public site. EscrowReleased was missed exactly this way when
  // staggered release landed.
  const missing = [];
  for (const [contract, declarations] of Object.entries(integration.contracts)) {
    const declared = new Set(declarations.map(canonicalFromDeclaration));
    for (const signature of await abiEvents(contract)) {
      if (!declared.has(signature)) missing.push(`${contract}.${signature}`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    "add these to integration/indexer/doom-launchpad-events.json and bump its version",
  );
});

test("the integration file declares nothing the contracts do not emit", async () => {
  const stale = [];
  for (const [contract, declarations] of Object.entries(integration.contracts)) {
    const emitted = new Set(await abiEvents(contract));
    for (const declaration of declarations) {
      const signature = canonicalFromDeclaration(declaration);
      if (!emitted.has(signature)) stale.push(`${contract}.${signature}`);
    }
  }
  assert.deepEqual(stale, [], "these declarations no longer match any contract event");
});

test("event declarations are unique inside each contract", () => {
  for (const [contract, declarations] of Object.entries(integration.contracts)) {
    const canonical = declarations.map(canonicalFromDeclaration);
    assert.equal(new Set(canonical).size, canonical.length, `${contract} contains duplicate declarations`);
  }
});

test("the staggered release event carries what a launch page needs", () => {
  const escrow = integration.contracts.GmEscrow;
  const released = escrow.find(item => item.startsWith("event EscrowReleased"));
  assert.ok(released, "EscrowReleased must be indexed");
  // Without a running total and a remainder, a page cannot show how much is still at stake.
  for (const field of ["checkIn", "amount", "releasedTotal", "remaining"]) {
    assert.ok(released.includes(field), `EscrowReleased must expose ${field}`);
  }
  assert.ok(released.includes("uint256 indexed launchId"), "must be joinable to a launch");
});

test("the declared schema version moves when the event set changes", () => {
  assert.ok(Number.isInteger(integration.version));
  assert.ok(integration.version >= 5, "bump the version when events are added or removed");
  assert.equal(integration.chainId, 4663);
});
