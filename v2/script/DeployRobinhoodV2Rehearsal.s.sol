// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {DoomLaunchDeployerV2} from "../src/DoomLaunchDeployerV2.sol";
import {DoomLaunchFactoryV2} from "../src/DoomLaunchFactoryV2.sol";
import {PositionLockerV2} from "../src/PositionLockerV2.sol";
import {V3GraduationManagerV2} from "../src/V3GraduationManagerV2.sol";

/// @notice Simulation-only rehearsal of the seven-step Robinhood mainnet V2 deployment.
/// @dev This script deliberately never calls vm.startBroadcast. Supplying --broadcast cannot
///      turn its local fork state into signed mainnet transactions.
contract DeployRobinhoodV2Rehearsal is Script {
    uint256 internal constant CHAIN_ID = 4663;

    address internal constant DEPLOYER_AND_OPERATOR = 0xcaB166ed15e63b846Ec8D1a2d6762a33392c796F;
    address internal constant TREASURY = 0x9038C3AB7caE02a8aae730E705fdF7a15945eb7E;
    address internal constant EMERGENCY_GUARDIAN = 0x3EeF0a7Ee9420a1035a4541582B384bc4405A439;

    address internal constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address internal constant V3_FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address internal constant NONFUNGIBLE_POSITION_MANAGER = 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3;
    address internal constant DOOM_REWARDS = 0x615f6E6B0AEA7Ac94F4391424aF601F9290dd9dC;

    error RehearsalAcknowledgementRequired();
    error WrongChain(uint256 expected, uint256 actual);
    error RehearsalInvariantFailed(bytes32 invariantName);

    function run()
        external
        returns (
            DoomLaunchDeployerV2 curveDeployer,
            PositionLockerV2 locker,
            V3GraduationManagerV2 graduationManager,
            DoomLaunchFactoryV2 factory
        )
    {
        if (!vm.envOr("ROBINHOOD_V2_REHEARSAL_ACK", false)) {
            revert RehearsalAcknowledgementRequired();
        }
        if (block.chainid != CHAIN_ID) revert WrongChain(CHAIN_ID, block.chainid);

        curveDeployer = new DoomLaunchDeployerV2(DEPLOYER_AND_OPERATOR);
        locker = new PositionLockerV2(NONFUNGIBLE_POSITION_MANAGER, WETH, DOOM_REWARDS, TREASURY, DEPLOYER_AND_OPERATOR);
        graduationManager = new V3GraduationManagerV2(
            CHAIN_ID, DEPLOYER_AND_OPERATOR, V3_FACTORY, NONFUNGIBLE_POSITION_MANAGER, WETH, address(locker)
        );

        vm.prank(DEPLOYER_AND_OPERATOR);
        locker.bindRegistrar(address(graduationManager));

        DoomLaunchFactoryV2.FactoryConfig memory config = DoomLaunchFactoryV2.FactoryConfig({
            operator: DEPLOYER_AND_OPERATOR,
            emergencyGuardian: EMERGENCY_GUARDIAN,
            initialApprovedCreator: DEPLOYER_AND_OPERATOR,
            treasury: TREASURY,
            doomRewards: DOOM_REWARDS,
            wrappedNative: WETH,
            graduationManager: address(graduationManager),
            curveDeployer: address(curveDeployer)
        });
        factory = new DoomLaunchFactoryV2(config);

        vm.prank(DEPLOYER_AND_OPERATOR);
        curveDeployer.bindFactory(address(factory));
        vm.prank(DEPLOYER_AND_OPERATOR);
        graduationManager.bindFactory(address(factory));

        _assert(factory.launchesPaused(), "FACTORY_MUST_START_PAUSED");
        _assert(factory.isLaunchConfigurationValid(), "LAUNCH_CONFIGURATION_INVALID");
        _assert(factory.operator() == DEPLOYER_AND_OPERATOR, "OPERATOR_MISMATCH");
        _assert(factory.emergencyGuardian() == EMERGENCY_GUARDIAN, "GUARDIAN_MISMATCH");
        _assert(factory.creatorAllowed(DEPLOYER_AND_OPERATOR), "CREATOR_NOT_ALLOWED");
        _assert(factory.treasury() == TREASURY, "TREASURY_MISMATCH");
        _assert(factory.doomRewards() == DOOM_REWARDS, "REWARDS_MISMATCH");
        _assert(address(factory.wrappedNative()) == WETH, "FACTORY_WETH_MISMATCH");
        _assert(factory.graduationManager() == address(graduationManager), "MANAGER_MISMATCH");
        _assert(factory.curveDeployer() == address(curveDeployer), "DEPLOYER_MISMATCH");
        _assert(factory.MAX_LAUNCHES() == 100, "LAUNCH_CAP_MISMATCH");
        _assert(factory.LAUNCH_FEE() == 0.001 ether, "LAUNCH_FEE_MISMATCH");
        _assert(locker.authorizedRegistrar() == address(graduationManager), "REGISTRAR_MISMATCH");
        _assert(graduationManager.authorizedFactory() == address(factory), "MANAGER_BINDING_MISMATCH");
        _assert(curveDeployer.authorizedFactory() == address(factory), "DEPLOYER_BINDING_MISMATCH");
        _assert(graduationManager.isNetworkConfigurationValid(), "V3_CONFIGURATION_INVALID");
        _assert(graduationManager.POOL_FEE() == 10_000, "POOL_FEE_MISMATCH");
        _assert(graduationManager.TICK_SPACING() == 200, "TICK_SPACING_MISMATCH");
    }

    function _assert(bool condition, bytes32 invariantName) internal pure {
        if (!condition) revert RehearsalInvariantFailed(invariantName);
    }
}
