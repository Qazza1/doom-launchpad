import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

export const GENERATOR_VERSION = "0.1.0";
export const MERKLE_LIBRARY = "@openzeppelin/merkle-tree@1.0.8+uuid@11.1.1";
export const LEAF_ENCODING = ["uint256", "address", "uint256", "address", "uint256"];

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL = /^(0|[1-9][0-9]*)$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

export function parseArgs(argv, required) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    invariant(flag?.startsWith("--"), `Unexpected argument: ${flag ?? "<missing>"}`);
    invariant(index + 1 < argv.length, `Missing value for ${flag}`);
    args[flag.slice(2)] = argv[index + 1];
  }
  for (const name of required) {
    invariant(args[name], `Missing required --${name}`);
  }
  return args;
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  invariant(
    value === null || ["string", "number", "boolean"].includes(typeof value),
    `Unsupported canonical JSON value: ${typeof value}`,
  );
  return JSON.stringify(value);
}

export function prettyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function sha256Canonical(value) {
  return `0x${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function normalizeAddress(value, label) {
  invariant(typeof value === "string" && ADDRESS.test(value), `${label} must be a 20-byte hex address`);
  return value.toLowerCase();
}

export function normalizeHash(value, label) {
  invariant(typeof value === "string" && HASH.test(value), `${label} must be a 32-byte hex value`);
  return value.toLowerCase();
}

export function normalizeUint(value, label, { allowZero = true } = {}) {
  invariant(typeof value === "string" && DECIMAL.test(value), `${label} must be a canonical decimal string`);
  const parsed = BigInt(value);
  invariant(allowZero || parsed > 0n, `${label} must be greater than zero`);
  return parsed.toString();
}

export function compareUintStrings(left, right) {
  const a = BigInt(left);
  const b = BigInt(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

export function normalizeSnapshot(input) {
  invariant(input?.schema === "doom.nft-ownership-snapshot.v1", "Unsupported ownership snapshot schema");
  const chainId = normalizeUint(input.chainId, "chainId", { allowZero: false });
  const snapshotBlock = normalizeUint(input.snapshotBlock, "snapshotBlock");
  const observedHeadBlock = normalizeUint(input.observedHeadBlock, "observedHeadBlock");
  const confirmationCount = normalizeUint(input.confirmationCount, "confirmationCount");
  invariant(BigInt(observedHeadBlock) >= BigInt(snapshotBlock), "observedHeadBlock must not precede snapshotBlock");
  invariant(
    BigInt(observedHeadBlock) - BigInt(snapshotBlock) === BigInt(confirmationCount),
    "confirmationCount does not match observed head and snapshot block",
  );
  const snapshotBlockHash = normalizeHash(input.snapshotBlockHash, "snapshotBlockHash");
  const nftCollection = normalizeAddress(input.nftCollection, "nftCollection");
  const excludedHolder = normalizeAddress(input.excludedHolder, "excludedHolder");
  const reportedTotalSupply = normalizeUint(input.reportedTotalSupply, "reportedTotalSupply");
  invariant(Array.isArray(input.holdings), "holdings must be an array");

  const seenAccounts = new Set();
  const seenTokenIds = new Set();
  const holdings = input.holdings.map((entry, holderIndex) => {
    const account = normalizeAddress(entry.account, `holdings[${holderIndex}].account`);
    invariant(account !== ZERO_ADDRESS, "Zero address cannot appear in holdings");
    invariant(!seenAccounts.has(account), `Duplicate holder account: ${account}`);
    seenAccounts.add(account);
    invariant(Array.isArray(entry.tokenIds) && entry.tokenIds.length > 0, `${account} must have at least one token`);
    const tokenIds = entry.tokenIds
      .map((tokenId, tokenIndex) => normalizeUint(tokenId, `${account}.tokenIds[${tokenIndex}]`))
      .sort(compareUintStrings);
    for (const tokenId of tokenIds) {
      invariant(!seenTokenIds.has(tokenId), `Duplicate token ID: ${tokenId}`);
      seenTokenIds.add(tokenId);
    }
    return { account, tokenIds };
  });
  holdings.sort((left, right) => left.account.localeCompare(right.account));

  invariant(
    BigInt(reportedTotalSupply) === BigInt(seenTokenIds.size),
    `reportedTotalSupply ${reportedTotalSupply} does not match ${seenTokenIds.size} reconstructed tokens`,
  );

  return {
    schema: "doom.nft-ownership-snapshot.v1",
    chainId,
    snapshotBlock,
    observedHeadBlock,
    confirmationCount,
    snapshotBlockHash,
    nftCollection,
    excludedHolder,
    reportedTotalSupply,
    holdings,
  };
}

export function normalizeCampaignConfig(input) {
  invariant(input?.schema === "doom.reward-campaign-config.v1", "Unsupported campaign config schema");
  return {
    schema: "doom.reward-campaign-config.v1",
    chainId: normalizeUint(input.chainId, "chainId", { allowZero: false }),
    doomRewards: normalizeAddress(input.doomRewards, "doomRewards"),
    campaignId: normalizeUint(input.campaignId, "campaignId", { allowZero: false }),
    rewardToken: normalizeAddress(input.rewardToken, "rewardToken"),
    totalReward: normalizeUint(input.totalReward, "totalReward", { allowZero: false }),
    claimDeadline: normalizeUint(input.claimDeadline, "claimDeadline", { allowZero: false }),
  };
}

function leafValues(chainId, vault, campaignId, account, amount) {
  return [chainId, vault, campaignId, account, amount];
}

export function generateManifest(snapshotInput, campaignInput) {
  const snapshot = normalizeSnapshot(snapshotInput);
  const campaign = normalizeCampaignConfig(campaignInput);
  invariant(snapshot.chainId === campaign.chainId, "Snapshot and campaign chain IDs do not match");

  const eligible = snapshot.holdings.filter((entry) => entry.account !== snapshot.excludedHolder);
  const eligibleNftCount = eligible.reduce((sum, entry) => sum + BigInt(entry.tokenIds.length), 0n);
  const totalReward = BigInt(campaign.totalReward);
  const canCreateCampaign = eligibleNftCount > 0n;
  const perNftAmount = canCreateCampaign ? totalReward / eligibleNftCount : 0n;
  invariant(!canCreateCampaign || perNftAmount > 0n, "totalReward is too small to allocate at least one unit per NFT");

  const rawClaims = eligible.map((entry) => ({
    account: entry.account,
    nftCount: entry.tokenIds.length.toString(),
    tokenIds: entry.tokenIds,
    amount: (perNftAmount * BigInt(entry.tokenIds.length)).toString(),
  }));
  const allocatedAmount = rawClaims.reduce((sum, entry) => sum + BigInt(entry.amount), 0n);
  const retainedRemainder = totalReward - allocatedAmount;

  let root = null;
  let claims = [];
  if (canCreateCampaign) {
    const values = rawClaims.map((entry) =>
      leafValues(campaign.chainId, campaign.doomRewards, campaign.campaignId, entry.account, entry.amount),
    );
    const tree = StandardMerkleTree.of(values, LEAF_ENCODING);
    root = tree.root.toLowerCase();
    claims = rawClaims.map((entry, index) => ({
      ...entry,
      proof: tree.getProof(index).map((item) => item.toLowerCase()),
    }));
  }

  return {
    schema: "doom.reward-campaign-manifest.v1",
    generator: {
      name: "@doomstreak/rewards-operations",
      version: GENERATOR_VERSION,
      merkleLibrary: MERKLE_LIBRARY,
    },
    sourceDigests: {
      ownershipSnapshotSha256: sha256Canonical(snapshot),
      campaignConfigSha256: sha256Canonical(campaign),
    },
    snapshot: {
      chainId: snapshot.chainId,
      blockNumber: snapshot.snapshotBlock,
      blockHash: snapshot.snapshotBlockHash,
      observedHeadBlock: snapshot.observedHeadBlock,
      confirmationCount: snapshot.confirmationCount,
      nftCollection: snapshot.nftCollection,
      reportedTotalSupply: snapshot.reportedTotalSupply,
      excludedHolder: snapshot.excludedHolder,
    },
    campaign: {
      canCreateCampaign,
      vault: campaign.doomRewards,
      campaignId: campaign.campaignId,
      rewardToken: campaign.rewardToken,
      totalReward: campaign.totalReward,
      claimDeadline: campaign.claimDeadline,
    },
    allocation: {
      rule: "equal-per-eligible-nft-floor-v1",
      eligibleHolderCount: eligible.length.toString(),
      eligibleNftCount: eligibleNftCount.toString(),
      perNftAmount: perNftAmount.toString(),
      allocatedAmount: allocatedAmount.toString(),
      retainedRemainder: retainedRemainder.toString(),
    },
    merkle: {
      leafEncoding: LEAF_ENCODING,
      sortLeaves: true,
      root,
    },
    claims,
  };
}

export function verifyManifest(manifest, snapshotInput, campaignInput) {
  invariant(manifest?.schema === "doom.reward-campaign-manifest.v1", "Unsupported manifest schema");
  invariant(
    manifest.generator?.merkleLibrary === MERKLE_LIBRARY,
    `Manifest must use pinned ${MERKLE_LIBRARY}`,
  );
  invariant(
    canonicalJson(manifest.merkle?.leafEncoding) === canonicalJson(LEAF_ENCODING),
    "Unexpected Merkle leaf encoding",
  );
  invariant(manifest.merkle?.sortLeaves === true, "Merkle leaves must be sorted");
  invariant(Array.isArray(manifest.claims), "Manifest claims must be an array");

  const canCreateCampaign = manifest.campaign?.canCreateCampaign;
  invariant(typeof canCreateCampaign === "boolean", "canCreateCampaign must be boolean");
  const chainId = normalizeUint(manifest.snapshot?.chainId, "snapshot.chainId", { allowZero: false });
  const vault = normalizeAddress(manifest.campaign?.vault, "campaign.vault");
  const campaignId = normalizeUint(manifest.campaign?.campaignId, "campaign.campaignId", { allowZero: false });
  const excludedHolder = normalizeAddress(manifest.snapshot?.excludedHolder, "snapshot.excludedHolder");
  const totalReward = BigInt(normalizeUint(manifest.campaign?.totalReward, "campaign.totalReward", { allowZero: false }));
  normalizeAddress(manifest.campaign?.rewardToken, "campaign.rewardToken");
  normalizeUint(manifest.campaign?.claimDeadline, "campaign.claimDeadline", { allowZero: false });
  normalizeUint(manifest.snapshot?.blockNumber, "snapshot.blockNumber");
  const observedHeadBlock = BigInt(normalizeUint(manifest.snapshot?.observedHeadBlock, "snapshot.observedHeadBlock"));
  const confirmationCount = BigInt(normalizeUint(manifest.snapshot?.confirmationCount, "snapshot.confirmationCount"));
  invariant(
    observedHeadBlock - BigInt(manifest.snapshot.blockNumber) === confirmationCount,
    "Manifest confirmation count mismatch",
  );
  normalizeHash(manifest.snapshot?.blockHash, "snapshot.blockHash");
  normalizeAddress(manifest.snapshot?.nftCollection, "snapshot.nftCollection");
  const reportedTotalSupply = BigInt(normalizeUint(manifest.snapshot?.reportedTotalSupply, "reportedTotalSupply"));
  invariant(manifest.allocation?.rule === "equal-per-eligible-nft-floor-v1", "Unexpected allocation rule");
  const eligibleHolderCount = BigInt(normalizeUint(manifest.allocation?.eligibleHolderCount, "eligibleHolderCount"));
  const eligibleNftCount = BigInt(normalizeUint(manifest.allocation?.eligibleNftCount, "eligibleNftCount"));
  const perNftAmount = BigInt(normalizeUint(manifest.allocation?.perNftAmount, "perNftAmount"));
  const allocatedAmount = BigInt(normalizeUint(manifest.allocation?.allocatedAmount, "allocatedAmount"));
  const retainedRemainder = BigInt(normalizeUint(manifest.allocation?.retainedRemainder, "retainedRemainder"));

  invariant(canCreateCampaign === (eligibleNftCount > 0n), "Campaign creation flag disagrees with eligible supply");
  invariant(totalReward === allocatedAmount + retainedRemainder, "Allocation plus remainder must equal total reward");
  invariant(reportedTotalSupply >= eligibleNftCount, "Eligible NFT count exceeds reported supply");

  if (!canCreateCampaign) {
    invariant(manifest.merkle.root === null, "Zero-supply manifest must not contain a Merkle root");
    invariant(manifest.claims.length === 0, "Zero-supply manifest must not contain claims");
    invariant(perNftAmount === 0n && allocatedAmount === 0n, "Zero-supply allocations must be zero");
    invariant(eligibleHolderCount === 0n, "Zero-supply manifest must not contain eligible holders");
    invariant(retainedRemainder === totalReward, "Zero-supply reward must remain entirely available");
  } else {
    const root = normalizeHash(manifest.merkle.root, "merkle.root");
    invariant(manifest.claims.length > 0, "Campaign manifest must contain claims");
    const seen = new Set();
    const seenTokenIds = new Set();
    let previous = "";
    let summedNfts = 0n;
    let summedAmount = 0n;
    const values = [];

    for (const [index, claim] of manifest.claims.entries()) {
      const account = normalizeAddress(claim.account, `claims[${index}].account`);
      invariant(account !== excludedHolder, `Excluded holder appears in claim: ${account}`);
      invariant(!seen.has(account), `Duplicate claim account: ${account}`);
      invariant(previous === "" || previous.localeCompare(account) < 0, "Claims must be sorted by account");
      previous = account;
      seen.add(account);
      const nftCount = BigInt(normalizeUint(claim.nftCount, `${account}.nftCount`, { allowZero: false }));
      const amount = BigInt(normalizeUint(claim.amount, `${account}.amount`, { allowZero: false }));
      invariant(amount === nftCount * perNftAmount, `Incorrect per-NFT allocation for ${account}`);
      invariant(Array.isArray(claim.tokenIds), `Missing token IDs for ${account}`);
      invariant(BigInt(claim.tokenIds.length) === nftCount, `NFT count disagrees with token IDs for ${account}`);
      let previousTokenId;
      for (const [tokenIndex, rawTokenId] of claim.tokenIds.entries()) {
        const tokenId = normalizeUint(rawTokenId, `${account}.tokenIds[${tokenIndex}]`);
        invariant(
          previousTokenId === undefined || BigInt(previousTokenId) < BigInt(tokenId),
          `Token IDs must be strictly sorted for ${account}`,
        );
        invariant(!seenTokenIds.has(tokenId), `Duplicate token ID in claims: ${tokenId}`);
        previousTokenId = tokenId;
        seenTokenIds.add(tokenId);
      }
      invariant(Array.isArray(claim.proof), `Missing proof for ${account}`);
      const proof = claim.proof.map((item, proofIndex) => normalizeHash(item, `${account}.proof[${proofIndex}]`));
      const value = leafValues(chainId, vault, campaignId, account, amount.toString());
      invariant(StandardMerkleTree.verify(root, LEAF_ENCODING, value, proof), `Invalid Merkle proof for ${account}`);
      values.push(value);
      summedNfts += nftCount;
      summedAmount += amount;
    }

    invariant(summedNfts === eligibleNftCount, "Claim NFT counts do not match eligible NFT count");
    invariant(summedAmount === allocatedAmount, "Claim amounts do not match allocated amount");
    invariant(BigInt(manifest.claims.length) === eligibleHolderCount, "Claim count does not match eligible holder count");
    invariant(perNftAmount === totalReward / eligibleNftCount, "Per-NFT amount is not the required floor division");
    invariant(StandardMerkleTree.of(values, LEAF_ENCODING).root.toLowerCase() === root, "Rebuilt Merkle root mismatch");
  }

  if (snapshotInput !== undefined || campaignInput !== undefined) {
    invariant(snapshotInput !== undefined && campaignInput !== undefined, "Both snapshot and campaign inputs are required");
    const expected = generateManifest(snapshotInput, campaignInput);
    invariant(canonicalJson(expected) === canonicalJson(manifest), "Manifest differs from deterministic source rebuild");
  }

  return {
    valid: true,
    canCreateCampaign,
    root: manifest.merkle.root,
    allocatedAmount: manifest.allocation.allocatedAmount,
    retainedRemainder: manifest.allocation.retainedRemainder,
  };
}

export function applyErc721Transfers(logs) {
  const owners = new Map();
  const ordered = [...logs].sort((left, right) => {
    const block = BigInt(left.blockNumber) - BigInt(right.blockNumber);
    if (block !== 0n) return block < 0n ? -1 : 1;
    const transaction = BigInt(left.transactionIndex) - BigInt(right.transactionIndex);
    if (transaction !== 0n) return transaction < 0n ? -1 : 1;
    return Number(BigInt(left.logIndex) - BigInt(right.logIndex));
  });
  for (const [index, log] of ordered.entries()) {
    invariant(Array.isArray(log.topics) && log.topics.length === 4, `Log ${index} is not an ERC-721 Transfer`);
    const from = normalizeAddress(`0x${log.topics[1].slice(-40)}`, `logs[${index}].from`);
    const to = normalizeAddress(`0x${log.topics[2].slice(-40)}`, `logs[${index}].to`);
    const tokenId = BigInt(log.topics[3]).toString();
    const previous = owners.get(tokenId);
    if (from !== ZERO_ADDRESS) {
      invariant(previous === from, `Token ${tokenId} transfer source does not match reconstructed owner`);
    } else {
      invariant(previous === undefined, `Token ${tokenId} was minted more than once`);
    }
    if (to === ZERO_ADDRESS) owners.delete(tokenId);
    else owners.set(tokenId, to);
  }
  return owners;
}

export function holdingsFromOwners(owners) {
  const grouped = new Map();
  for (const [tokenId, account] of owners) {
    const tokenIds = grouped.get(account) ?? [];
    tokenIds.push(tokenId);
    grouped.set(account, tokenIds);
  }
  return [...grouped]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([account, tokenIds]) => ({ account, tokenIds: tokenIds.sort(compareUintStrings) }));
}
