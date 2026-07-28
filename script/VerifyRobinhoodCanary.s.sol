// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {DoomLaunchFactory} from "../src/DoomLaunchFactory.sol";
import {DoomRewards} from "../src/DoomRewards.sol";
import {PositionLocker} from "../src/PositionLocker.sol";
import {V3LiquidityManager} from "../src/V3LiquidityManager.sol";

/// @notice Read-only post-deployment verifier. This script never broadcasts.
contract VerifyRobinhoodCanary is Script {
    uint256 internal constant CHAIN_ID = 4663;
    address internal constant OPERATOR = 0xcaB166ed15e63b846Ec8D1a2d6762a33392c796F;
    address internal constant TREASURY = 0x9038C3AB7caE02a8aae730E705fdF7a15945eb7E;
    address internal constant CAMPAIGN_MANAGER = 0x4F81E3939232815e3C98B124A17BaC75304C82D8;
    address internal constant GUARDIAN = 0x3EeF0a7Ee9420a1035a4541582B384bc4405A439;
    address internal constant NFT = 0xB1b37dca046d0e70D9F5de673202D69c7DEF9be6;
    address internal constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address internal constant V3_FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address internal constant NPM = 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3;

    error VerificationFailed(bytes32 check);

    function run() external view {
        _require(block.chainid == CHAIN_ID, "CHAIN_ID");

        DoomLaunchFactory factory = DoomLaunchFactory(payable(vm.envAddress("DOOM_FACTORY")));
        V3LiquidityManager manager = V3LiquidityManager(payable(vm.envAddress("DOOM_LIQUIDITY_MANAGER")));
        PositionLocker locker = PositionLocker(vm.envAddress("DOOM_POSITION_LOCKER"));
        DoomRewards rewards = DoomRewards(vm.envAddress("DOOM_REWARDS"));

        _require(address(factory).code.length != 0, "FACTORY_CODE");
        _require(address(manager).code.length != 0, "MANAGER_CODE");
        _require(address(locker).code.length != 0, "LOCKER_CODE");
        _require(address(rewards).code.length != 0, "REWARDS_CODE");

        _require(factory.operator() == OPERATOR, "OPERATOR");
        _require(factory.approvedCreator() == OPERATOR, "CREATOR");
        _require(factory.treasury() == TREASURY, "TREASURY");
        _require(factory.emergencyGuardian() == GUARDIAN, "GUARDIAN");
        _require(address(factory.wrappedNative()) == WETH, "FACTORY_WETH");
        _require(address(factory.liquidityManager()) == address(manager), "FACTORY_MANAGER");
        _require(factory.positionLocker() == address(locker), "FACTORY_LOCKER");
        _require(factory.doomRewards() == address(rewards), "FACTORY_REWARDS");
        _require(factory.launchesPaused(), "FACTORY_MUST_REMAIN_PAUSED");
        _require(factory.maxLaunches() == 3, "MAX_LAUNCHES");
        _require(factory.maxNativeLiquidityPerLaunch() == 0.01 ether, "PER_LAUNCH");
        _require(factory.maxNativeLiquidityGlobal() == 0.03 ether, "GLOBAL_LIQUIDITY");
        _require(factory.CREATOR_LIQUID_BPS() == 0, "CREATOR_ALLOCATION");
        _require(factory.LIQUIDITY_BPS() == 4_000, "LIQUIDITY_ALLOCATION");
        _require(factory.GM_ESCROW_BPS() == 6_000, "ESCROW_ALLOCATION");
        _require(factory.CREATION_FEE_BPS() == 100, "CREATION_FEE");
        _require(factory.NFT_REWARD_FEE_SHARE_BPS() == 5_000, "CREATION_REWARD_SHARE");
        _require(factory.REQUIRED_GM_CHECK_INS() == 3, "GM_COUNT");
        _require(factory.GM_CADENCE_SECONDS() == 1 days, "GM_CADENCE");
        _require(factory.GM_GRACE_PERIOD_SECONDS() == 12 hours, "GM_GRACE");
        _require(factory.POOL_FEE() == 10_000, "POOL_FEE");

        _require(manager.expectedChainId() == CHAIN_ID, "MANAGER_CHAIN");
        _require(manager.uniswapV3Factory() == V3_FACTORY, "V3_FACTORY");
        _require(address(manager.nonfungiblePositionManager()) == NPM, "NPM");
        _require(address(manager.wrappedNative()) == WETH, "MANAGER_WETH");
        _require(manager.positionLocker() == address(locker), "MANAGER_LOCKER");
        _require(manager.authorizedFactory() == address(factory), "BOUND_FACTORY");
        _require(manager.isNetworkConfigurationValid(), "NETWORK_CONFIGURATION");

        _require(locker.positionManager() == NPM, "LOCKER_NPM");
        _require(address(locker.wrappedNative()) == WETH, "LOCKER_WETH");
        _require(locker.doomRewards() == address(rewards), "LOCKER_REWARDS");
        _require(locker.treasury() == TREASURY, "LOCKER_TREASURY");
        _require(locker.authorizedRegistrar() == address(manager), "REGISTRAR");
        _require(locker.CREATOR_WETH_FEE_BPS() == 7_000, "CREATOR_SHARE");
        _require(locker.TREASURY_WETH_FEE_BPS() == 1_500, "TREASURY_SHARE");
        _require(locker.REWARDS_WETH_FEE_BPS() == 1_500, "REWARDS_SHARE");

        _require(rewards.campaignManager() == CAMPAIGN_MANAGER, "CAMPAIGN_MANAGER");
        _require(rewards.nftCollection() == NFT, "NFT");
        _require(rewards.excludedHolder() == TREASURY, "EXCLUDED_HOLDER");
        _require(rewards.feeRewardToken() == WETH, "REWARD_TOKEN");
        _require(rewards.minimumClaimWindow() == 7 days, "MINIMUM_CLAIM_WINDOW");
    }

    function _require(bool condition, bytes32 check) internal pure {
        if (!condition) revert VerificationFailed(check);
    }
}
