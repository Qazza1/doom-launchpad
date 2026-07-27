// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {DoomLaunchFactory} from "../src/DoomLaunchFactory.sol";
import {DoomRewards} from "../src/DoomRewards.sol";
import {PositionLocker} from "../src/PositionLocker.sol";
import {V3LiquidityManager} from "../src/V3LiquidityManager.sol";

/// @notice Non-broadcast Stage 3 rehearsal for the approved Robinhood Chain canary configuration.
/// @dev This contract deliberately never calls vm.startBroadcast. Even if a caller supplies
///      `--broadcast`, these deployments remain local script simulation state.
contract DeployRobinhoodCanaryRehearsal is Script {
    uint256 internal constant CHAIN_ID = 4663;

    address internal constant DEPLOYER_AND_OPERATOR = 0xcaB166ed15e63b846Ec8D1a2d6762a33392c796F;
    address internal constant TREASURY = 0x9038C3AB7caE02a8aae730E705fdF7a15945eb7E;
    address internal constant CAMPAIGN_MANAGER = 0x4F81E3939232815e3C98B124A17BaC75304C82D8;
    address internal constant EMERGENCY_GUARDIAN = 0x3EeF0a7Ee9420a1035a4541582B384bc4405A439;
    address internal constant NFT_COLLECTION = 0xB1b37dca046d0e70D9F5de673202D69c7DEF9be6;

    address internal constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address internal constant V3_FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address internal constant NONFUNGIBLE_POSITION_MANAGER = 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3;

    error RehearsalAcknowledgementRequired();
    error WrongChain(uint256 expected, uint256 actual);
    error RehearsalInvariantFailed(bytes32 invariantName);

    function run()
        external
        returns (
            PositionLocker locker,
            V3LiquidityManager liquidityManager,
            DoomRewards rewards,
            DoomLaunchFactory factory
        )
    {
        if (!vm.envOr("ROBINHOOD_REHEARSAL_ACK", false)) {
            revert RehearsalAcknowledgementRequired();
        }
        if (block.chainid != CHAIN_ID) revert WrongChain(CHAIN_ID, block.chainid);

        rewards = new DoomRewards(CAMPAIGN_MANAGER, NFT_COLLECTION, TREASURY, WETH, 7 days);
        locker =
            new PositionLocker(NONFUNGIBLE_POSITION_MANAGER, WETH, address(rewards), TREASURY, DEPLOYER_AND_OPERATOR);
        liquidityManager = new V3LiquidityManager(
            CHAIN_ID, DEPLOYER_AND_OPERATOR, V3_FACTORY, NONFUNGIBLE_POSITION_MANAGER, WETH, address(locker)
        );
        vm.prank(DEPLOYER_AND_OPERATOR);
        locker.bindRegistrar(address(liquidityManager));

        DoomLaunchFactory.FactoryConfig memory config = DoomLaunchFactory.FactoryConfig({
            operator: DEPLOYER_AND_OPERATOR,
            emergencyGuardian: EMERGENCY_GUARDIAN,
            approvedCreator: DEPLOYER_AND_OPERATOR,
            treasury: TREASURY,
            doomRewards: address(rewards),
            wrappedNative: WETH,
            liquidityManager: address(liquidityManager),
            positionLocker: address(locker),
            maxLaunches: 3,
            maxNativeLiquidityPerLaunch: 0.01 ether,
            maxNativeLiquidityGlobal: 0.03 ether
        });
        factory = new DoomLaunchFactory(config);
        vm.prank(DEPLOYER_AND_OPERATOR);
        liquidityManager.bindFactory(address(factory));

        _assert(factory.launchesPaused(), "FACTORY_MUST_START_PAUSED");
        _assert(liquidityManager.isNetworkConfigurationValid(), "V3_CONFIGURATION_INVALID");
        _assert(factory.operator() == DEPLOYER_AND_OPERATOR, "OPERATOR_MISMATCH");
        _assert(factory.approvedCreator() == DEPLOYER_AND_OPERATOR, "CREATOR_MISMATCH");
        _assert(factory.treasury() == TREASURY, "TREASURY_MISMATCH");
        _assert(factory.emergencyGuardian() == EMERGENCY_GUARDIAN, "GUARDIAN_MISMATCH");
        _assert(rewards.campaignManager() == CAMPAIGN_MANAGER, "CAMPAIGN_MANAGER_MISMATCH");
        _assert(rewards.nftCollection() == NFT_COLLECTION, "NFT_MISMATCH");
        _assert(rewards.excludedHolder() == TREASURY, "EXCLUDED_HOLDER_MISMATCH");
        _assert(rewards.feeRewardToken() == WETH, "REWARD_TOKEN_MISMATCH");
        _assert(locker.positionManager() == NONFUNGIBLE_POSITION_MANAGER, "NPM_MISMATCH");
        _assert(address(locker.wrappedNative()) == WETH, "LOCKER_WETH_MISMATCH");
        _assert(locker.doomRewards() == address(rewards), "LOCKER_REWARDS_MISMATCH");
        _assert(locker.treasury() == TREASURY, "LOCKER_TREASURY_MISMATCH");
        _assert(locker.authorizedRegistrar() == address(liquidityManager), "REGISTRAR_MISMATCH");
        _assert(liquidityManager.factoryBinder() == DEPLOYER_AND_OPERATOR, "BINDER_MISMATCH");
        _assert(liquidityManager.authorizedFactory() == address(factory), "FACTORY_BINDING_MISMATCH");
        _assert(factory.maxLaunches() == 3, "MAX_LAUNCHES_MISMATCH");
        _assert(factory.maxNativeLiquidityPerLaunch() == 0.01 ether, "PER_LAUNCH_CAP_MISMATCH");
        _assert(factory.maxNativeLiquidityGlobal() == 0.03 ether, "GLOBAL_CAP_MISMATCH");
        _assert(factory.CREATION_FEE_BPS() == 100, "CREATION_FEE_MISMATCH");
        _assert(factory.POOL_FEE() == 10_000, "POOL_FEE_MISMATCH");
        _assert(factory.REQUIRED_GM_CHECK_INS() == 3, "GM_COUNT_MISMATCH");
        _assert(factory.GM_GRACE_PERIOD_SECONDS() == 12 hours, "GM_GRACE_MISMATCH");
        _assert(factory.CREATOR_LIQUID_BPS() == 0, "CREATOR_ALLOCATION_MISMATCH");
        _assert(factory.LIQUIDITY_BPS() == 4_000, "LIQUIDITY_ALLOCATION_MISMATCH");
        _assert(factory.GM_ESCROW_BPS() == 6_000, "ESCROW_ALLOCATION_MISMATCH");
        _assert(locker.CREATOR_WETH_FEE_BPS() == 7_000, "CREATOR_LP_FEE_MISMATCH");
        _assert(locker.TREASURY_WETH_FEE_BPS() == 1_500, "TREASURY_LP_FEE_MISMATCH");
        _assert(locker.REWARDS_WETH_FEE_BPS() == 1_500, "REWARDS_LP_FEE_MISMATCH");
    }

    function _assert(bool condition, bytes32 invariantName) internal pure {
        if (!condition) revert RehearsalInvariantFailed(invariantName);
    }
}
