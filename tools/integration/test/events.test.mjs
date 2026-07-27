import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const integration = JSON.parse(
  await readFile(
    new URL("../../../integration/indexer/doom-launchpad-events.json", import.meta.url),
    "utf8",
  ),
);

/// Canonical signature: name plus argument types only. That is what determines topic0, and it is
/// what an indexer actually matches on, so comparing it ignores harmless naming differences.
function canonicalFromAbi(entry) {
  const types = (entry.inputs || []).map(input => input.type).join(",");
  return `${entry.name}(${types})`;
}

function canonicalFromDeclaration(declaration) {
  const match = declaration.match(/^event\s+(\w+)\s*\((.*)\)$/s);
  if (!match) throw new Error(`malformed event declaration: ${declaration}`);
  const args = match[2].trim();
  if (!args) return `${match[1]}()`;
  const types = args.split(",").map(part => part.trim().split(/\s+/)[0]).join(",");
  return `${match[1]}(${types})`;
}

async function abiEvents(contract) {
  const artifact = JSON.parse(
    await readFile(new URL(`../../../out/${contract}.sol/${contract}.json`, import.meta.url), "utf8"),
  );
  return artifact.abi.filter(entry => entry.type === "event").map(canonicalFromAbi);
}

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
