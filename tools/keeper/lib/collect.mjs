import { getAddress, zeroAddress } from "viem";
import { erc20Abi, escrowAbi, factoryAbi, feesCollectedEvent, lockerAbi, rewardsAbi } from "./abis.mjs";

async function hasCode(client, address) {
  const code = await client.getBytecode({ address });
  return code !== undefined && code !== "0x";
}

async function read(client, address, abi, functionName, args = []) {
  return client.readContract({ address, abi, functionName, args });
}

export function shouldScanFeeLogs(lockerHasCode, launchCount) {
  return lockerHasCode && BigInt(launchCount) > 0n;
}

export async function collectKeeperState(client, config, observedAt = Math.floor(Date.now() / 1000)) {
  const chainId = await client.getChainId();
  const head = await client.getBlock({ blockTag: "latest" });
  const factoryAddress = config.contracts.factory;
  const factoryHasCode = await hasCode(client, factoryAddress);
  if (!factoryHasCode) {
    return {
      observedAt,
      chainId,
      headNumber: head.number.toString(),
      headTimestamp: Number(head.timestamp),
      factory: { address: factoryAddress, hasCode: false },
      positionLocker: { address: config.contracts.positionLocker, hasCode: false },
      doomRewards: { address: config.contracts.doomRewards, hasCode: false },
      launches: [],
    };
  }

  // Keep reads sequential. Entry-tier RPCs commonly reject a burst of more
  // than ten simultaneous eth_call requests even though every call is valid.
  const factoryReads = [];
  for (const functionName of [
    "operator",
    "emergencyGuardian",
    "approvedCreator",
    "treasury",
    "doomRewards",
    "wrappedNative",
    "liquidityManager",
    "positionLocker",
    "maxLaunches",
    "maxNativeLiquidityPerLaunch",
    "maxNativeLiquidityGlobal",
    "launchesPaused",
    "launchCount",
  ]) {
    factoryReads.push(await read(client, factoryAddress, factoryAbi, functionName));
  }
  const [
    operator,
    emergencyGuardian,
    approvedCreator,
    treasury,
    doomRewards,
    wrappedNative,
    liquidityManager,
    positionLocker,
    maxLaunches,
    maxNativeLiquidityPerLaunch,
    maxNativeLiquidityGlobal,
    launchesPaused,
    launchCount,
  ] = factoryReads;

  const expected = {
    operator: config.expectedRoles.operator,
    emergencyGuardian: config.expectedRoles.emergencyGuardian,
    approvedCreator: config.expectedRoles.approvedCreator,
    treasury: config.expectedRoles.treasury,
    doomRewards: config.contracts.doomRewards,
    wrappedNative: config.contracts.wrappedNative,
    liquidityManager: config.contracts.liquidityManager,
    positionLocker: config.contracts.positionLocker,
    maxLaunches: config.expectedCanaryLimits.maxLaunches,
    maxNativeLiquidityPerLaunch: config.expectedCanaryLimits.maxNativeLiquidityPerLaunch,
    maxNativeLiquidityGlobal: config.expectedCanaryLimits.maxNativeLiquidityGlobal,
  };
  const actual = {
    operator,
    emergencyGuardian,
    approvedCreator,
    treasury,
    doomRewards,
    wrappedNative,
    liquidityManager,
    positionLocker,
    maxLaunches: maxLaunches.toString(),
    maxNativeLiquidityPerLaunch: maxNativeLiquidityPerLaunch.toString(),
    maxNativeLiquidityGlobal: maxNativeLiquidityGlobal.toString(),
  };

  const lockerHasCode = await hasCode(client, config.contracts.positionLocker);
  const rewardsHasCode = await hasCode(client, config.contracts.doomRewards);

  const lockerActual = lockerHasCode
    ? {
        doomRewards: await read(client, config.contracts.positionLocker, lockerAbi, "doomRewards"),
        treasury: await read(client, config.contracts.positionLocker, lockerAbi, "treasury"),
        authorizedRegistrar: await read(client, config.contracts.positionLocker, lockerAbi, "authorizedRegistrar"),
        positionManager: await read(client, config.contracts.positionLocker, lockerAbi, "positionManager"),
      }
    : {};
  const rewardsActual = rewardsHasCode
    ? {
        campaignManager: await read(client, config.contracts.doomRewards, rewardsAbi, "campaignManager"),
        nftCollection: await read(client, config.contracts.doomRewards, rewardsAbi, "nftCollection"),
        excludedHolder: await read(client, config.contracts.doomRewards, rewardsAbi, "excludedHolder"),
        feeRewardToken: await read(client, config.contracts.doomRewards, rewardsAbi, "feeRewardToken"),
      }
    : {};

  // Before the first launch there cannot be a position or a fee-collection
  // event. Avoid a large historical eth_getLogs request that some providers
  // reject even when the result would be empty.
  const feeLogs = shouldScanFeeLogs(lockerHasCode, launchCount)
    ? await client.getLogs({
        address: config.contracts.positionLocker,
        event: feesCollectedEvent,
        fromBlock:
          head.number - BigInt(config.thresholds.feeLogLookbackBlocks) > BigInt(config.factoryDeploymentBlock)
            ? head.number - BigInt(config.thresholds.feeLogLookbackBlocks)
            : BigInt(config.factoryDeploymentBlock),
        toBlock: "latest",
      })
    : [];
  const latestFeeBlockByPosition = new Map();
  for (const log of feeLogs) {
    const positionId = log.args.positionId?.toString();
    if (positionId && log.blockNumber !== null) {
      const current = latestFeeBlockByPosition.get(positionId);
      if (current === undefined || log.blockNumber > current) latestFeeBlockByPosition.set(positionId, log.blockNumber);
    }
  }
  const feeBlockTimestamps = new Map();
  for (const blockNumber of new Set(latestFeeBlockByPosition.values())) {
    const block = await client.getBlock({ blockNumber });
    feeBlockTimestamps.set(blockNumber.toString(), Number(block.timestamp));
  }

  const launches = [];
  for (let launchId = 1n; launchId <= launchCount; launchId += 1n) {
    const record = await read(client, factoryAddress, factoryAbi, "getLaunch", [launchId]);
    if (record.token === zeroAddress) throw new Error(`Factory returned an empty record for launch ${launchId}`);
    const [escrowHasCode, poolHasCode, tokenHasCode] = await Promise.all([
      hasCode(client, record.creatorEscrow),
      hasCode(client, record.pool),
      hasCode(client, record.token),
    ]);
    if (!escrowHasCode || !poolHasCode || !tokenHasCode) {
      throw new Error(`Launch ${launchId} contains an address without bytecode`);
    }
    const [escrowStatus, completedCheckIns, requiredCheckIns, nextCheckInAt, nextDeadline, lockState] =
      await Promise.all([
        read(client, record.creatorEscrow, escrowAbi, "status"),
        read(client, record.creatorEscrow, escrowAbi, "completedCheckIns"),
        read(client, record.creatorEscrow, escrowAbi, "requiredCheckIns"),
        read(client, record.creatorEscrow, escrowAbi, "nextCheckInAt"),
        read(client, record.creatorEscrow, escrowAbi, "nextDeadline"),
        read(client, config.contracts.positionLocker, lockerAbi, "lockState", [record.positionId]),
      ]);
    const feeBlock = latestFeeBlockByPosition.get(record.positionId.toString());
    launches.push({
      launchId: launchId.toString(),
      token: getAddress(record.token),
      creator: getAddress(record.creator),
      pool: getAddress(record.pool),
      creatorEscrow: getAddress(record.creatorEscrow),
      positionId: record.positionId.toString(),
      createdAt: Number(record.createdAt),
      liquidityPermanent: record.liquidityPermanent,
      currentlyLocked: lockState[7],
      escrowStatus: Number(escrowStatus),
      completedCheckIns: Number(completedCheckIns),
      requiredCheckIns: Number(requiredCheckIns),
      nextCheckInAt: Number(nextCheckInAt),
      nextDeadline: Number(nextDeadline),
      lastFeeCollectionAt: feeBlock ? feeBlockTimestamps.get(feeBlock.toString()) : null,
    });
  }

  const rewardBalances = [];
  if (rewardsHasCode) {
    const rewardTokens = new Set([getAddress(config.contracts.wrappedNative), ...launches.map((launch) => launch.token)]);
    for (const token of [...rewardTokens].sort((left, right) => left.localeCompare(right))) {
      const actualBalance = await read(client, token, erc20Abi, "balanceOf", [config.contracts.doomRewards]);
      const availableRewards = await read(
        client,
        config.contracts.doomRewards,
        rewardsAbi,
        "availableRewards",
        [token],
      );
      const reservedRewards = await read(
        client,
        config.contracts.doomRewards,
        rewardsAbi,
        "reservedRewards",
        [token],
      );
      rewardBalances.push({
        token,
        actualBalance: actualBalance.toString(),
        availableRewards: availableRewards.toString(),
        reservedRewards: reservedRewards.toString(),
      });
    }
  }

  return {
    observedAt,
    chainId,
    headNumber: head.number.toString(),
    headTimestamp: Number(head.timestamp),
    factory: {
      address: factoryAddress,
      hasCode: true,
      launchesPaused,
      launchCount: launchCount.toString(),
      expected,
      actual,
    },
    positionLocker: {
      address: config.contracts.positionLocker,
      hasCode: lockerHasCode,
      expected: {
        doomRewards: config.contracts.doomRewards,
        treasury: config.expectedRoles.treasury,
        authorizedRegistrar: config.contracts.liquidityManager,
        positionManager: config.contracts.nonfungiblePositionManager,
      },
      actual: lockerActual,
    },
    doomRewards: {
      address: config.contracts.doomRewards,
      hasCode: rewardsHasCode,
      expected: {
        campaignManager: config.expectedRoles.campaignManager,
        nftCollection: config.contracts.nftCollection,
        excludedHolder: config.expectedRoles.treasury,
        feeRewardToken: config.contracts.wrappedNative,
      },
      actual: rewardsActual,
      balances: rewardBalances,
    },
    launches,
  };
}
