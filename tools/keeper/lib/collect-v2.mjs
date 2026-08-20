import { getAddress, zeroAddress } from "viem";
import { curveV2Abi, deployerV2Abi, escrowV2Abi, factoryV2Abi, lockerV2Abi, managerV2Abi } from "./abis.mjs";

async function code(client, address) {
  const value = await client.getBytecode({ address });
  return value !== undefined && value !== "0x";
}

const read = (client, address, abi, functionName, args = []) => client.readContract({ address, abi, functionName, args });

export async function collectKeeperStateV2(client, config, observedAt) {
  const chainId = await client.getChainId();
  const head = await client.getBlock({ blockTag: "latest" });
  const factoryAddress = config.contracts.factory;
  if (!await code(client, factoryAddress)) {
    return { protocolVersion: "v2", observedAt, chainId, headNumber: head.number.toString(), headTimestamp: Number(head.timestamp), factory: { address: factoryAddress, hasCode: false }, launches: [] };
  }

  const unbounded = config.unboundedLaunches === true;
  const names = ["operator", "emergencyGuardian", "treasury", "doomRewards", "wrappedNative", "graduationManager", "curveDeployer", "launchesPaused", "launchCount", "isLaunchConfigurationValid", "LAUNCH_FEE"];
  if (!unbounded) names.push("MAX_LAUNCHES");
  const values = [];
  for (const name of names) values.push(await read(client, factoryAddress, factoryV2Abi, name));
  const [operator, emergencyGuardian, treasury, doomRewards, wrappedNative, graduationManager, curveDeployer, launchesPaused, launchCount, configurationValid, launchFee, boundedMaxLaunches] = values;
  const maxLaunches = unbounded ? null : boundedMaxLaunches;
  const permissionless = config.creatorPolicy === "permissionless_eoa";
  const initialCreatorAllowed = permissionless
    ? null
    : await read(client, factoryAddress, factoryV2Abi, "creatorAllowed", [config.expectedRoles.approvedCreator]);
  const firstLaunchId = permissionless
    ? await read(client, factoryAddress, factoryV2Abi, "FIRST_LAUNCH_ID")
    : 1n;
  const finalLaunchId = permissionless && !unbounded
    ? await read(client, factoryAddress, factoryV2Abi, "FINAL_LAUNCH_ID")
    : permissionless ? null : maxLaunches;
  const unboundedFlag = unbounded
    ? await read(client, factoryAddress, factoryV2Abi, "UNBOUNDED_LAUNCHES")
    : false;

  const componentCode = {};
  for (const [name, address] of Object.entries(config.contracts)) componentCode[name] = await code(client, address);
  const deployerFactory = componentCode.curveDeployer ? await read(client, config.contracts.curveDeployer, deployerV2Abi, "authorizedFactory") : zeroAddress;
  const manager = componentCode.graduationManager ? {
    authorizedFactory: await read(client, config.contracts.graduationManager, managerV2Abi, "authorizedFactory"),
    positionLocker: await read(client, config.contracts.graduationManager, managerV2Abi, "positionLocker"),
    uniswapV3Factory: await read(client, config.contracts.graduationManager, managerV2Abi, "uniswapV3Factory"),
    positionManager: await read(client, config.contracts.graduationManager, managerV2Abi, "positionManagerContract"),
    wrappedNative: await read(client, config.contracts.graduationManager, managerV2Abi, "wrappedNative"),
    expectedChainId: (await read(client, config.contracts.graduationManager, managerV2Abi, "expectedChainId")).toString(),
  } : {};

  const launches = [];
  const lastCreatedId = firstLaunchId + launchCount - 1n;
  for (let id = firstLaunchId; id <= lastCreatedId; id += 1n) {
    const record = await read(client, factoryAddress, factoryV2Abi, "getLaunch", [id]);
    if ([record.token, record.curve, record.escrow, record.initializedPool].some(address => address === zeroAddress || !address)) {
      throw new Error(`V2 launch ${id} contains a zero address`);
    }
    const [tokenCode, curveCode, escrowCode, poolCode] = await Promise.all([
      code(client, record.token), code(client, record.curve), code(client, record.escrow), code(client, record.initializedPool),
    ]);
    if (!tokenCode || !curveCode || !escrowCode || !poolCode) throw new Error(`V2 launch ${id} contains an address without bytecode`);
    const [graduated, nativeRaised, remaining, curvePool, positionId, accountedNative, escrowStatus, completed, required, nextCheckInAt, nextDeadline] = await Promise.all([
      read(client, record.curve, curveV2Abi, "graduated"),
      read(client, record.curve, curveV2Abi, "realNativeReserve"),
      read(client, record.curve, curveV2Abi, "remainingToGraduate"),
      read(client, record.curve, curveV2Abi, "pool"),
      read(client, record.curve, curveV2Abi, "positionId"),
      read(client, record.curve, curveV2Abi, "accountedNativeBalance"),
      read(client, record.escrow, escrowV2Abi, "status"),
      read(client, record.escrow, escrowV2Abi, "completedCheckIns"),
      read(client, record.escrow, escrowV2Abi, "requiredCheckIns"),
      read(client, record.escrow, escrowV2Abi, "nextCheckInAt"),
      read(client, record.escrow, escrowV2Abi, "nextDeadline"),
    ]);
    let currentlyLocked = null;
    if (graduated) {
      const lock = await read(client, config.contracts.positionLocker, lockerV2Abi, "lockState", [positionId]);
      currentlyLocked = Boolean(lock[7]);
    }
    launches.push({
      launchId: id.toString(), token: getAddress(record.token), creator: getAddress(record.creator),
      curve: getAddress(record.curve), escrow: getAddress(record.escrow), initializedPool: getAddress(record.initializedPool),
      createdAt: Number(record.createdAt), graduated: Boolean(graduated), nativeRaised: nativeRaised.toString(),
      remainingToGraduate: remaining.toString(), accountedNativeBalance: accountedNative.toString(),
      pool: curvePool === zeroAddress ? null : getAddress(curvePool), positionId: positionId.toString(), currentlyLocked,
      escrowStatus: Number(escrowStatus), completedCheckIns: Number(completed), requiredCheckIns: Number(required),
      nextCheckInAt: Number(nextCheckInAt), nextDeadline: Number(nextDeadline),
    });
  }

  return {
    protocolVersion: "v2", observedAt, chainId, headNumber: head.number.toString(), headTimestamp: Number(head.timestamp),
    factory: {
      address: factoryAddress, hasCode: true, launchesPaused, launchCount: launchCount.toString(), configurationValid,
      expected: {
        operator: config.expectedRoles.operator, emergencyGuardian: config.expectedRoles.emergencyGuardian,
        treasury: config.expectedRoles.treasury, doomRewards: config.contracts.doomRewards,
        wrappedNative: config.contracts.wrappedNative, graduationManager: config.contracts.graduationManager,
        curveDeployer: config.contracts.curveDeployer, launchFee: config.expectedCanaryLimits.launchFee,
        ...(unbounded
          ? { unboundedLaunches: true }
          : { maxLaunches: config.expectedCanaryLimits.maxLaunches }),
        ...(permissionless ? {
          firstLaunchId: config.expectedCanaryLimits.firstLaunchId,
          ...(!unbounded ? { finalLaunchId: config.expectedCanaryLimits.finalLaunchId } : {}),
        } : {}),
      },
      actual: {
        operator, emergencyGuardian, treasury, doomRewards, wrappedNative, graduationManager, curveDeployer,
        launchFee: launchFee.toString(),
        ...(unbounded ? { unboundedLaunches: Boolean(unboundedFlag) } : { maxLaunches: maxLaunches.toString() }),
        ...(permissionless ? {
          firstLaunchId: firstLaunchId.toString(),
          ...(!unbounded ? { finalLaunchId: finalLaunchId.toString() } : {}),
        } : {}),
      },
      initialCreatorAllowed,
    },
    components: {
      code: componentCode,
      deployerAuthorizedFactory: deployerFactory,
      manager,
    },
    launches,
  };
}
