import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const CHAIN_ID = 4663;
const DEPLOYER = "0xcaB166ed15e63b846Ec8D1a2d6762a33392c796F";
const DEPENDENCIES = {
  nftCollection: "0xB1b37dca046d0e70D9F5de673202D69c7DEF9be6",
  wrappedNative: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  uniswapV3Factory: "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA",
  nonfungiblePositionManager: "0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3",
};

const hexNumber = value => Number(BigInt(value));
const fingerprint = code =>
  createHash("sha256").update(code.toLowerCase()).digest("hex").slice(0, 16);

export function validateEndpointPair(primary, fallback) {
  const errors = [];
  let primaryUrl;
  let fallbackUrl;
  try { primaryUrl = new URL(primary); } catch { errors.push("primary RPC URL is invalid"); }
  try { fallbackUrl = new URL(fallback); } catch { errors.push("fallback RPC URL is invalid"); }
  if (primaryUrl && primaryUrl.protocol !== "https:") errors.push("primary RPC must use HTTPS");
  if (fallbackUrl && fallbackUrl.protocol !== "https:") errors.push("fallback RPC must use HTTPS");
  if (primaryUrl && fallbackUrl && primaryUrl.href === fallbackUrl.href) {
    errors.push("primary and fallback RPC URLs must differ");
  }
  if (primaryUrl && fallbackUrl && primaryUrl.hostname === fallbackUrl.hostname) {
    errors.push("primary and fallback RPCs must use independent provider hosts");
  }
  return errors;
}

async function rpc(url, method, params = []) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`${method} returned HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.message || "RPC error"}`);
  return body.result;
}

export async function inspectProvider(label, url) {
  const started = performance.now();
  const chainId = hexNumber(await rpc(url, "eth_chainId"));
  if (chainId !== CHAIN_ID) throw new Error(`${label} returned chain ID ${chainId}, expected ${CHAIN_ID}`);

  const blockNumber = hexNumber(await rpc(url, "eth_blockNumber"));
  const blockHex = `0x${blockNumber.toString(16)}`;
  const archiveBlock = Math.max(0, blockNumber - 1_000_000);
  const archiveHex = `0x${archiveBlock.toString(16)}`;

  const [block, nonceHex, balanceWei, archiveBlockData, archiveWethCode, ...codes] =
    await Promise.all([
      rpc(url, "eth_getBlockByNumber", [blockHex, false]),
      rpc(url, "eth_getTransactionCount", [DEPLOYER, "pending"]),
      rpc(url, "eth_getBalance", [DEPLOYER, "latest"]),
      rpc(url, "eth_getBlockByNumber", [archiveHex, false]),
      rpc(url, "eth_getCode", [DEPENDENCIES.wrappedNative, archiveHex]),
      ...Object.values(DEPENDENCIES).map(address => rpc(url, "eth_getCode", [address, "latest"])),
    ]);

  if (!block?.hash) throw new Error(`${label} did not return the latest block`);
  if (!archiveBlockData?.hash) throw new Error(`${label} did not return archive block ${archiveBlock}`);
  if (!archiveWethCode || archiveWethCode === "0x") {
    throw new Error(`${label} did not return historical WETH bytecode at block ${archiveBlock}`);
  }

  const code = {};
  for (const [index, name] of Object.keys(DEPENDENCIES).entries()) {
    const value = codes[index];
    if (!value || value === "0x") throw new Error(`${label} returned no code for ${name}`);
    code[name] = {
      bytes: (value.length - 2) / 2,
      sha256Prefix: fingerprint(value),
    };
  }

  return {
    label,
    chainId,
    blockNumber,
    blockHash: block.hash,
    blockTimestamp: hexNumber(block.timestamp),
    archiveBlock,
    pendingNonce: hexNumber(nonceHex),
    deployerBalanceWei: BigInt(balanceWei).toString(),
    latencyMs: Math.round(performance.now() - started),
    code,
  };
}

export function compareReports(primary, fallback) {
  const errors = [];
  if (primary.chainId !== fallback.chainId) errors.push("provider chain IDs disagree");
  if (Math.abs(primary.blockNumber - fallback.blockNumber) > 500) {
    errors.push("provider heads differ by more than 500 blocks");
  }
  if (primary.pendingNonce !== fallback.pendingNonce) errors.push("provider pending nonces disagree");
  for (const name of Object.keys(DEPENDENCIES)) {
    if (primary.code[name]?.sha256Prefix !== fallback.code[name]?.sha256Prefix) {
      errors.push(`provider bytecode disagrees for ${name}`);
    }
  }
  return errors;
}

async function main() {
  const primary = process.env.ROBINHOOD_RPC_URL || "";
  const fallback = process.env.ROBINHOOD_FALLBACK_RPC_URL || "";
  const endpointErrors = validateEndpointPair(primary, fallback);
  if (endpointErrors.length) throw new Error(endpointErrors.join("; "));

  const [primaryReport, fallbackReport] = await Promise.all([
    inspectProvider("primary", primary),
    inspectProvider("fallback", fallback),
  ]);
  const comparisonErrors = compareReports(primaryReport, fallbackReport);
  if (comparisonErrors.length) throw new Error(comparisonErrors.join("; "));

  console.log(JSON.stringify({
    status: "ready_for_non_broadcast_rehearsal",
    secretsPrinted: false,
    primary: primaryReport,
    fallback: fallbackReport,
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`RPC preflight failed: ${error.message}`);
    process.exitCode = 1;
  });
}
