import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  applyErc721Transfers,
  holdingsFromOwners,
  invariant,
  normalizeAddress,
  normalizeSnapshot,
  normalizeUint,
  parseArgs,
  prettyJson,
  readJson,
} from "./lib.mjs";

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const TOTAL_SUPPLY_SELECTOR = "0x18160ddd";
const BALANCE_OF_SELECTOR = "0x70a08231";

let requestId = 0;

function toQuantity(value) {
  return `0x${BigInt(value).toString(16)}`;
}

function fromQuantity(value, label) {
  invariant(typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value), `${label} is not an RPC quantity`);
  return BigInt(value);
}

async function rpc(url, method, params) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }),
  });
  invariant(response.ok, `${method} HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.message ?? JSON.stringify(body.error)}`);
  return body.result;
}

async function getLogs(url, address, fromBlock, toBlock, chunkSize) {
  const logs = [];
  async function fetchRange(start, end) {
    try {
      const result = await rpc(url, "eth_getLogs", [
        {
          address,
          fromBlock: toQuantity(start),
          toBlock: toQuantity(end),
          topics: [TRANSFER_TOPIC],
        },
      ]);
      invariant(Array.isArray(result), "eth_getLogs did not return an array");
      logs.push(...result);
    } catch (error) {
      if (start === end) throw error;
      const midpoint = (start + end) / 2n;
      await fetchRange(start, midpoint);
      await fetchRange(midpoint + 1n, end);
    }
  }

  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    const end = start + chunkSize - 1n > toBlock ? toBlock : start + chunkSize - 1n;
    await fetchRange(start, end);
    console.error(`Fetched ERC-721 logs through block ${end}`);
  }
  return logs;
}

function encodeBalanceOf(account) {
  return `${BALANCE_OF_SELECTOR}${account.slice(2).padStart(64, "0")}`;
}

const args = parseArgs(process.argv.slice(2), ["config", "output"]);
const invocationDirectory = process.env.INIT_CWD ?? process.cwd();
const config = await readJson(resolve(invocationDirectory, args.config));
invariant(config?.schema === "doom.nft-snapshot-config.v1", "Unsupported snapshot config schema");

const chainId = normalizeUint(config.chainId, "chainId", { allowZero: false });
const nftCollection = normalizeAddress(config.nftCollection, "nftCollection");
const excludedHolder = normalizeAddress(config.excludedHolder, "excludedHolder");
const fromBlock = BigInt(normalizeUint(config.fromBlock, "fromBlock"));
const snapshotBlock = BigInt(normalizeUint(config.snapshotBlock, "snapshotBlock"));
const chunkSize = BigInt(normalizeUint(config.logChunkSize ?? "2000", "logChunkSize", { allowZero: false }));
invariant(fromBlock <= snapshotBlock, "fromBlock must not exceed snapshotBlock");
invariant(
  typeof config.rpcUrlEnvironmentVariable === "string" && /^[A-Z][A-Z0-9_]*$/.test(config.rpcUrlEnvironmentVariable),
  "rpcUrlEnvironmentVariable must be an uppercase environment-variable name",
);
const rpcUrl = process.env[config.rpcUrlEnvironmentVariable];
invariant(rpcUrl, `Missing RPC URL in ${config.rpcUrlEnvironmentVariable}`);

const actualChainId = fromQuantity(await rpc(rpcUrl, "eth_chainId", []), "eth_chainId").toString();
invariant(actualChainId === chainId, `RPC chain ID ${actualChainId} does not match configured ${chainId}`);
const observedHeadBlock = fromQuantity(await rpc(rpcUrl, "eth_blockNumber", []), "eth_blockNumber");
invariant(snapshotBlock <= observedHeadBlock, "snapshotBlock exceeds the observed chain head");
const confirmationCount = observedHeadBlock - snapshotBlock;

const block = await rpc(rpcUrl, "eth_getBlockByNumber", [toQuantity(snapshotBlock), false]);
invariant(block?.hash, `Snapshot block ${snapshotBlock} was not found`);
const logs = await getLogs(rpcUrl, nftCollection, fromBlock, snapshotBlock, chunkSize);
const owners = applyErc721Transfers(logs);
const holdings = holdingsFromOwners(owners);

const supplyResult = await rpc(rpcUrl, "eth_call", [
  { to: nftCollection, data: TOTAL_SUPPLY_SELECTOR },
  toQuantity(snapshotBlock),
]);
const reportedTotalSupply = fromQuantity(supplyResult, "totalSupply").toString();
invariant(
  BigInt(reportedTotalSupply) === BigInt(owners.size),
  `NFT totalSupply ${reportedTotalSupply} does not match ${owners.size} reconstructed owners`,
);

if (config.verifyBalances !== false) {
  for (const holding of holdings) {
    const balanceResult = await rpc(rpcUrl, "eth_call", [
      { to: nftCollection, data: encodeBalanceOf(holding.account) },
      toQuantity(snapshotBlock),
    ]);
    const balance = fromQuantity(balanceResult, `balanceOf(${holding.account})`);
    invariant(balance === BigInt(holding.tokenIds.length), `balanceOf mismatch for ${holding.account}`);
  }
}

const snapshot = normalizeSnapshot({
  schema: "doom.nft-ownership-snapshot.v1",
  chainId,
  snapshotBlock: snapshotBlock.toString(),
  observedHeadBlock: observedHeadBlock.toString(),
  confirmationCount: confirmationCount.toString(),
  snapshotBlockHash: block.hash,
  nftCollection,
  excludedHolder,
  reportedTotalSupply,
  holdings,
});

const output = resolve(invocationDirectory, args.output);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, prettyJson(snapshot), { encoding: "utf8", flag: "wx" });
console.log(`Wrote verified ownership snapshot: ${output}`);
console.log(`NFT supply: ${snapshot.reportedTotalSupply}`);
console.log(`Snapshot block: ${snapshot.snapshotBlock} (${snapshot.snapshotBlockHash})`);
console.log(`Confirmations at collection: ${snapshot.confirmationCount}`);
