import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  applyErc721Transfers,
  canonicalJson,
  generateManifest,
  holdingsFromOwners,
  normalizeSnapshot,
  verifyManifest,
} from "../lib.mjs";

const fixtureUrl = new URL("../fixtures/ownership.snapshot.json", import.meta.url);
const campaignUrl = new URL("../fixtures/campaign.config.json", import.meta.url);
const snapshot = JSON.parse(await readFile(fixtureUrl, "utf8"));
const campaign = JSON.parse(await readFile(campaignUrl, "utf8"));

test("allocates equally per eligible NFT and excludes treasury", () => {
  const manifest = generateManifest(snapshot, campaign);
  assert.equal(manifest.campaign.canCreateCampaign, true);
  assert.equal(manifest.allocation.eligibleHolderCount, "2");
  assert.equal(manifest.allocation.eligibleNftCount, "3");
  assert.equal(manifest.allocation.perNftAmount, "333");
  assert.equal(manifest.allocation.allocatedAmount, "999");
  assert.equal(manifest.allocation.retainedRemainder, "1");
  assert.equal(manifest.merkle.root, "0xd64f965899b8c4be141f803c1d1cddfaa112051290d0f63f460af5f33ebefa67");
  assert.deepEqual(
    manifest.claims.map(({ account, amount }) => ({ account, amount })),
    [
      { account: "0x1111111111111111111111111111111111111111", amount: "666" },
      { account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", amount: "333" },
    ],
  );
  assert.equal(manifest.claims.some((claim) => claim.account === snapshot.excludedHolder.toLowerCase()), false);
  assert.equal(verifyManifest(manifest, snapshot, campaign).valid, true);
});

test("generation is byte-for-byte deterministic after canonical normalization", () => {
  const first = generateManifest(snapshot, campaign);
  const shuffled = structuredClone(snapshot);
  shuffled.holdings.reverse();
  shuffled.holdings[2].tokenIds.reverse();
  const second = generateManifest(shuffled, campaign);
  assert.equal(canonicalJson(first), canonicalJson(second));
});

test("zero NFT supply fails closed without a campaign root", () => {
  const zero = {
    ...snapshot,
    reportedTotalSupply: "0",
    holdings: [],
  };
  const manifest = generateManifest(zero, campaign);
  assert.equal(manifest.campaign.canCreateCampaign, false);
  assert.equal(manifest.merkle.root, null);
  assert.deepEqual(manifest.claims, []);
  assert.equal(manifest.allocation.allocatedAmount, "0");
  assert.equal(manifest.allocation.retainedRemainder, "1000");
  assert.equal(verifyManifest(manifest, zero, campaign).valid, true);
});

test("only excluded-holder supply also fails closed", () => {
  const excludedOnly = {
    ...snapshot,
    reportedTotalSupply: "1",
    holdings: [{ account: snapshot.excludedHolder, tokenIds: ["3"] }],
  };
  const manifest = generateManifest(excludedOnly, campaign);
  assert.equal(manifest.campaign.canCreateCampaign, false);
  assert.equal(manifest.merkle.root, null);
});

test("duplicate token IDs and supply mismatches are rejected", () => {
  const duplicate = structuredClone(snapshot);
  duplicate.holdings[2].tokenIds = ["1"];
  assert.throws(() => normalizeSnapshot(duplicate), /Duplicate token ID/);

  const mismatch = structuredClone(snapshot);
  mismatch.reportedTotalSupply = "5";
  assert.throws(() => normalizeSnapshot(mismatch), /does not match 4 reconstructed tokens/);

  const wrongConfirmations = structuredClone(snapshot);
  wrongConfirmations.confirmationCount = "63";
  assert.throws(() => normalizeSnapshot(wrongConfirmations), /confirmationCount does not match/);
});

test("mutated claim amount or proof is rejected", () => {
  const wrongAmount = generateManifest(snapshot, campaign);
  wrongAmount.claims[0].amount = "665";
  assert.throws(() => verifyManifest(wrongAmount), /Incorrect per-NFT allocation/);

  const wrongProof = generateManifest(snapshot, campaign);
  wrongProof.claims[0].proof[0] = `0x${"ff".repeat(32)}`;
  assert.throws(() => verifyManifest(wrongProof), /Invalid Merkle proof/);

  const duplicateClaimToken = generateManifest(snapshot, campaign);
  duplicateClaimToken.claims[1].tokenIds = ["1"];
  assert.throws(() => verifyManifest(duplicateClaimToken), /Duplicate token ID in claims/);
});

function addressTopic(address) {
  return `0x${address.slice(2).padStart(64, "0")}`;
}

function transfer(from, to, tokenId, blockNumber, logIndex) {
  return {
    blockNumber: `0x${blockNumber.toString(16)}`,
    transactionIndex: "0x0",
    logIndex: `0x${logIndex.toString(16)}`,
    topics: [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
      addressTopic(from),
      addressTopic(to),
      `0x${tokenId.toString(16).padStart(64, "0")}`,
    ],
  };
}

test("ERC-721 reconstruction handles mint, transfer, burn, and log ordering", () => {
  const zero = "0x0000000000000000000000000000000000000000";
  const alice = "0x1111111111111111111111111111111111111111";
  const bob = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const logs = [
    transfer(alice, bob, 1, 2, 0),
    transfer(zero, alice, 2, 1, 1),
    transfer(zero, alice, 1, 1, 0),
    transfer(alice, zero, 2, 3, 0),
  ];
  const holdings = holdingsFromOwners(applyErc721Transfers(logs));
  assert.deepEqual(holdings, [{ account: bob, tokenIds: ["1"] }]);
});

test("ERC-721 reconstruction rejects impossible transfer history", () => {
  const zero = "0x0000000000000000000000000000000000000000";
  const alice = "0x1111111111111111111111111111111111111111";
  const bob = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const logs = [transfer(zero, alice, 1, 1, 0), transfer(bob, alice, 1, 2, 0)];
  assert.throws(() => applyErc721Transfers(logs), /source does not match/);
});
