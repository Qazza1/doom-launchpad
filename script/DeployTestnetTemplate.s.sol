// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {DoomRewards} from "../src/DoomRewards.sol";
import {PositionLocker} from "../src/PositionLocker.sol";
import {DoomLaunchFactory} from "../src/DoomLaunchFactory.sol";
import {ILiquidityManager} from "../src/interfaces/ILiquidityManager.sol";

/// @notice Stage 3 testnet-only template, after locker and reviewed V3 manager deployment.
/// @dev This script is intentionally not run by this deliverable.
contract DeployTestnetTemplate is Script {
    error TestnetAcknowledgementRequired();
    error WrongChain(uint256 expected, uint256 actual);
    error RoleSeparationRequired();
    error DependencyHasNoCode(address dependency);
    error PositionManagerMismatch(address expected, address actual);
    error PositionLockerMismatch(address expected, address actual);

    function run() external returns (DoomRewards rewards, PositionLocker locker, DoomLaunchFactory factory) {
        if (!vm.envBool("TESTNET_ONLY_ACK")) revert TestnetAcknowledgementRequired();
        uint256 expectedChainId = vm.envUint("TESTNET_CHAIN_ID");
        if (expectedChainId == 0 || block.chainid != expectedChainId) {
            revert WrongChain(expectedChainId, block.chainid);
        }

        address operator = vm.envAddress("TESTNET_OPERATOR");
        address emergencyGuardian = vm.envAddress("TESTNET_EMERGENCY_GUARDIAN");
        address approvedCreator = vm.envAddress("TESTNET_APPROVED_CREATOR");
        address treasury = vm.envAddress("TESTNET_TREASURY");
        address campaignManager = vm.envAddress("TESTNET_CAMPAIGN_MANAGER");
        address nftCollection = vm.envAddress("TESTNET_NFT_COLLECTION");
        address excludedHolder = vm.envAddress("TESTNET_EXCLUDED_NFT_HOLDER");
        address wrappedNative = vm.envAddress("TESTNET_WRAPPED_NATIVE");
        address npm = vm.envAddress("TESTNET_NONFUNGIBLE_POSITION_MANAGER");
        address lockerAddress = vm.envAddress("TESTNET_POSITION_LOCKER");
        address reviewedLiquidityManager = vm.envAddress("TESTNET_REVIEWED_V3_LIQUIDITY_MANAGER");
        if (treasury == campaignManager) {
            revert RoleSeparationRequired();
        }
        if (nftCollection.code.length == 0) revert DependencyHasNoCode(nftCollection);
        if (wrappedNative.code.length == 0) revert DependencyHasNoCode(wrappedNative);
        if (npm.code.length == 0) revert DependencyHasNoCode(npm);
        if (lockerAddress.code.length == 0) revert DependencyHasNoCode(lockerAddress);
        if (reviewedLiquidityManager.code.length == 0) {
            revert DependencyHasNoCode(reviewedLiquidityManager);
        }

        locker = PositionLocker(lockerAddress);
        address actualNpm = locker.positionManager();
        if (actualNpm != npm) revert PositionManagerMismatch(npm, actualNpm);
        address managerLocker = ILiquidityManager(reviewedLiquidityManager).positionLocker();
        if (managerLocker != lockerAddress) {
            revert PositionLockerMismatch(lockerAddress, managerLocker);
        }

        uint64 minimumClaimWindow = uint64(vm.envUint("TESTNET_MINIMUM_CLAIM_WINDOW_SECONDS"));
        uint32 maxLaunches = uint32(vm.envUint("TESTNET_MAX_LAUNCHES"));
        uint256 maxLiquidityPerLaunch = vm.envUint("TESTNET_MAX_LIQUIDITY_PER_LAUNCH_WEI");
        uint256 maxLiquidityGlobal = vm.envUint("TESTNET_MAX_LIQUIDITY_GLOBAL_WEI");

        vm.startBroadcast();
        rewards = new DoomRewards(campaignManager, nftCollection, excludedHolder, wrappedNative, minimumClaimWindow);
        DoomLaunchFactory.FactoryConfig memory config = DoomLaunchFactory.FactoryConfig({
            operator: operator,
            emergencyGuardian: emergencyGuardian,
            approvedCreator: approvedCreator,
            treasury: treasury,
            doomRewards: address(rewards),
            wrappedNative: wrappedNative,
            liquidityManager: reviewedLiquidityManager,
            positionLocker: lockerAddress,
            maxLaunches: maxLaunches,
            maxNativeLiquidityPerLaunch: maxLiquidityPerLaunch,
            maxNativeLiquidityGlobal: maxLiquidityGlobal
        });
        factory = new DoomLaunchFactory(config);
        vm.stopBroadcast();
    }
}
