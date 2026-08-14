import { parseAbi, parseAbiItem } from "viem";

export const factoryAbi = [
  ...parseAbi([
    "function operator() view returns (address)",
    "function emergencyGuardian() view returns (address)",
    "function approvedCreator() view returns (address)",
    "function treasury() view returns (address)",
    "function doomRewards() view returns (address)",
    "function wrappedNative() view returns (address)",
    "function liquidityManager() view returns (address)",
    "function positionLocker() view returns (address)",
    "function maxLaunches() view returns (uint32)",
    "function maxNativeLiquidityPerLaunch() view returns (uint256)",
    "function maxNativeLiquidityGlobal() view returns (uint256)",
    "function launchesPaused() view returns (bool)",
    "function launchCount() view returns (uint256)",
  ]),
  {
    type: "function",
    name: "getLaunch",
    stateMutability: "view",
    inputs: [{ name: "launchId", type: "uint256" }],
    outputs: [
      {
        name: "record",
        type: "tuple",
        components: [
          { name: "token", type: "address" },
          { name: "creator", type: "address" },
          { name: "pool", type: "address" },
          { name: "creatorEscrow", type: "address" },
          { name: "positionId", type: "uint256" },
          { name: "totalSupply", type: "uint256" },
          { name: "creatorLiquidAmount", type: "uint256" },
          { name: "liquidityTokenAmountAllocated", type: "uint256" },
          { name: "liquidityTokenAmountUsed", type: "uint256" },
          { name: "liquidityTokenRemainder", type: "uint256" },
          { name: "escrowTokenAmount", type: "uint256" },
          { name: "nativeLiquidityAmountRequested", type: "uint256" },
          { name: "nativeLiquidityAmountUsed", type: "uint256" },
          { name: "creationFee", type: "uint256" },
          { name: "treasuryFee", type: "uint256" },
          { name: "nftRewardFee", type: "uint256" },
          { name: "createdAt", type: "uint64" },
          { name: "liquidityPermanent", type: "bool" },
          { name: "sqrtPriceX96", type: "uint160" },
          { name: "configurationHash", type: "bytes32" },
        ],
      },
    ],
  },
];

export const escrowAbi = parseAbi([
  "function status() view returns (uint8)",
  "function completedCheckIns() view returns (uint32)",
  "function requiredCheckIns() view returns (uint32)",
  "function nextCheckInAt() view returns (uint64)",
  "function nextDeadline() view returns (uint64)",
]);

export const lockerAbi = [
  ...parseAbi([
    "function doomRewards() view returns (address)",
    "function treasury() view returns (address)",
    "function authorizedRegistrar() view returns (address)",
    "function positionManager() view returns (address)",
  ]),
  {
    type: "function",
    name: "lockState",
    stateMutability: "view",
    inputs: [{ name: "positionId", type: "uint256" }],
    outputs: [
      { name: "pool", type: "address" },
      { name: "launchToken", type: "address" },
      { name: "creator", type: "address" },
      { name: "gmEscrow", type: "address" },
      { name: "launchId", type: "uint256" },
      { name: "registeredAt", type: "uint64" },
      { name: "permanent", type: "bool" },
      { name: "currentlyLocked", type: "bool" },
    ],
  },
];

export const rewardsAbi = parseAbi([
  "function campaignManager() view returns (address)",
  "function nftCollection() view returns (address)",
  "function excludedHolder() view returns (address)",
  "function feeRewardToken() view returns (address)",
  "function availableRewards(address token) view returns (uint256)",
  "function reservedRewards(address token) view returns (uint256)",
]);

export const erc20Abi = parseAbi(["function balanceOf(address account) view returns (uint256)"]);

export const feesCollectedEvent = parseAbiItem(
  "event PositionFeesCollected(uint256 indexed positionId,uint256 indexed launchId,address indexed caller,bool creatorEligible,uint256 launchTokenFeesToRewards,uint256 wethCollected,uint256 wethToCreator,uint256 wethToTreasury,uint256 wethToRewards)",
);

export const factoryV2Abi = [
  ...parseAbi([
    "function operator() view returns (address)",
    "function emergencyGuardian() view returns (address)",
    "function treasury() view returns (address)",
    "function doomRewards() view returns (address)",
    "function wrappedNative() view returns (address)",
    "function graduationManager() view returns (address)",
    "function curveDeployer() view returns (address)",
    "function launchesPaused() view returns (bool)",
    "function launchCount() view returns (uint256)",
    "function creatorAllowed(address) view returns (bool)",
    "function isLaunchConfigurationValid() view returns (bool)",
    "function LAUNCH_FEE() view returns (uint256)",
    "function MAX_LAUNCHES() view returns (uint256)",
    "function FIRST_LAUNCH_ID() view returns (uint256)",
    "function FINAL_LAUNCH_ID() view returns (uint256)",
  ]),
  {
    type: "function", name: "getLaunch", stateMutability: "view",
    inputs: [{ name: "launchId", type: "uint256" }],
    outputs: [{ name: "record", type: "tuple", components: [
      { name: "token", type: "address" }, { name: "creator", type: "address" },
      { name: "curve", type: "address" }, { name: "escrow", type: "address" },
      { name: "initializedPool", type: "address" }, { name: "totalSupply", type: "uint256" },
      { name: "curveAndLpAmount", type: "uint256" }, { name: "escrowAmount", type: "uint256" },
      { name: "createdAt", type: "uint64" }, { name: "metadataURI", type: "string" },
    ] }],
  },
];

export const curveV2Abi = parseAbi([
  "function graduated() view returns (bool)",
  "function realNativeReserve() view returns (uint256)",
  "function remainingToGraduate() view returns (uint256)",
  "function pool() view returns (address)",
  "function positionId() view returns (uint256)",
  "function accountedNativeBalance() view returns (uint256)",
]);

export const escrowV2Abi = parseAbi([
  "function status() view returns (uint8)",
  "function completedCheckIns() view returns (uint32)",
  "function requiredCheckIns() view returns (uint32)",
  "function nextCheckInAt() view returns (uint64)",
  "function nextDeadline() view returns (uint64)",
]);

export const lockerV2Abi = lockerAbi;
export const deployerV2Abi = parseAbi(["function authorizedFactory() view returns (address)"]);
export const managerV2Abi = parseAbi([
  "function authorizedFactory() view returns (address)",
  "function positionLocker() view returns (address)",
  "function uniswapV3Factory() view returns (address)",
  "function positionManagerContract() view returns (address)",
  "function wrappedNative() view returns (address)",
  "function expectedChainId() view returns (uint256)",
]);
