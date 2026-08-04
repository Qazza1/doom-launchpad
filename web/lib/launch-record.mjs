/// Decoding for `DoomLaunchFactory.getLaunch`.
///
/// Shared by the canary observer and the public launch page so both read the same tuple the same
/// way. A second decoder would be a second set of off-by-one bugs, and this one is already proven
/// against the real launch 1 record.
///
/// **Keep this file free of Node imports.** The browser loads it directly.

/// Order matters: this mirrors DoomLaunchFactory.LaunchRecord exactly. Every field is static, so the
/// tuple is returned as consecutive words.
export const LAUNCH_FIELDS = [
  ["token", "address"],
  ["creator", "address"],
  ["pool", "address"],
  ["creatorEscrow", "address"],
  ["positionId", "uint"],
  ["totalSupply", "uint"],
  ["creatorLiquidAmount", "uint"],
  ["liquidityTokenAmountAllocated", "uint"],
  ["liquidityTokenAmountUsed", "uint"],
  ["liquidityTokenRemainder", "uint"],
  ["escrowTokenAmount", "uint"],
  ["nativeLiquidityAmountRequested", "uint"],
  ["nativeLiquidityAmountUsed", "uint"],
  ["creationFee", "uint"],
  ["treasuryFee", "uint"],
  ["nftRewardFee", "uint"],
  ["createdAt", "uint"],
  ["liquidityPermanent", "bool"],
  ["sqrtPriceX96", "uint"],
  ["configurationHash", "bytes32"],
];

export function splitWords(hex) {
  const body = String(hex || "").replace(/^0x/, "");
  if (body.length % 64 !== 0) throw new Error("return data is not a whole number of words");
  return Array.from({ length: body.length / 64 }, (_, index) =>
    body.slice(index * 64, index * 64 + 64));
}

export function decodeLaunchRecord(hex) {
  const words = splitWords(hex);
  if (words.length < LAUNCH_FIELDS.length) throw new Error("launch record is truncated");
  const record = {};
  for (const [index, [name, kind]] of LAUNCH_FIELDS.entries()) {
    const word = words[index];
    if (kind === "address") record[name] = `0x${word.slice(24)}`;
    else if (kind === "bool") record[name] = BigInt(`0x${word}`) === 1n;
    else if (kind === "bytes32") record[name] = `0x${word}`;
    else record[name] = BigInt(`0x${word}`);
  }
  return record;
}
