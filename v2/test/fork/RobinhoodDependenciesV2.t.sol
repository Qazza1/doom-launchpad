// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IUniswapV3Factory} from "@uniswap/v3-core/interfaces/IUniswapV3Factory.sol";
import {DoomLaunchDeployerV2} from "../../src/DoomLaunchDeployerV2.sol";
import {DoomLaunchFactoryV2} from "../../src/DoomLaunchFactoryV2.sol";
import {PositionLockerV2} from "../../src/PositionLockerV2.sol";
import {V3GraduationManagerV2} from "../../src/V3GraduationManagerV2.sol";
import {ICanonicalV3PositionManagerV2} from "../../src/interfaces/ICanonicalV3PositionManagerV2.sol";
import {IDoomRewardsV2} from "../../src/interfaces/IDoomRewardsV2.sol";

/// @notice Read-only dual-provider validation plus ephemeral, non-broadcast V2 wiring rehearsal.
contract RobinhoodDependenciesV2Test is Test {
    uint256 internal constant CHAIN_ID = 4663;
    address internal constant DEPLOYER_AND_OPERATOR = 0xcaB166ed15e63b846Ec8D1a2d6762a33392c796F;
    address internal constant TREASURY = 0x9038C3AB7caE02a8aae730E705fdF7a15945eb7E;
    address internal constant EMERGENCY_GUARDIAN = 0x3EeF0a7Ee9420a1035a4541582B384bc4405A439;
    address internal constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address internal constant V3_FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address internal constant NPM = 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3;
    address internal constant DOOM_REWARDS = 0x615f6E6B0AEA7Ac94F4391424aF601F9290dd9dC;

    function testPrimaryRpcDependenciesAndV2Wiring() external {
        _run("ROBINHOOD_RPC_URL");
    }

    function testFallbackRpcDependenciesAndV2Wiring() external {
        _run("ROBINHOOD_FALLBACK_RPC_URL");
    }

    function _run(string memory variableName) internal {
        if (!vm.envOr("RUN_ROBINHOOD_V2_FORK_TESTS", false)) {
            vm.skip(true, "set RUN_ROBINHOOD_V2_FORK_TESTS=true after configuring both V2 RPC variables");
        }
        string memory rpcUrl = vm.envString(variableName);
        vm.createSelectFork(rpcUrl);
        assertEq(block.chainid, CHAIN_ID);
        assertGt(WETH.code.length, 0);
        assertGt(V3_FACTORY.code.length, 0);
        assertGt(NPM.code.length, 0);
        assertGt(DOOM_REWARDS.code.length, 0);

        ICanonicalV3PositionManagerV2 positionManager = ICanonicalV3PositionManagerV2(NPM);
        assertEq(positionManager.factory(), V3_FACTORY);
        assertEq(positionManager.WETH9(), WETH);
        assertEq(IUniswapV3Factory(V3_FACTORY).feeAmountTickSpacing(10_000), 200);
        assertEq(IDoomRewardsV2(DOOM_REWARDS).feeRewardToken(), WETH);

        vm.startPrank(DEPLOYER_AND_OPERATOR, DEPLOYER_AND_OPERATOR);
        DoomLaunchDeployerV2 deployer = new DoomLaunchDeployerV2(DEPLOYER_AND_OPERATOR);
        PositionLockerV2 locker = new PositionLockerV2(NPM, WETH, DOOM_REWARDS, TREASURY, DEPLOYER_AND_OPERATOR);
        V3GraduationManagerV2 manager =
            new V3GraduationManagerV2(CHAIN_ID, DEPLOYER_AND_OPERATOR, V3_FACTORY, NPM, WETH, address(locker));
        locker.bindRegistrar(address(manager));
        DoomLaunchFactoryV2 factory = new DoomLaunchFactoryV2(
            DoomLaunchFactoryV2.FactoryConfig({
                operator: DEPLOYER_AND_OPERATOR,
                emergencyGuardian: EMERGENCY_GUARDIAN,
                initialApprovedCreator: DEPLOYER_AND_OPERATOR,
                treasury: TREASURY,
                doomRewards: DOOM_REWARDS,
                wrappedNative: WETH,
                graduationManager: address(manager),
                curveDeployer: address(deployer)
            })
        );
        deployer.bindFactory(address(factory));
        manager.bindFactory(address(factory));
        vm.stopPrank();

        assertTrue(factory.launchesPaused());
        assertTrue(factory.isLaunchConfigurationValid());
        assertTrue(manager.isNetworkConfigurationValid());
        assertEq(deployer.authorizedFactory(), address(factory));
        assertEq(manager.authorizedFactory(), address(factory));
        assertEq(locker.authorizedRegistrar(), address(manager));
        assertEq(factory.operator(), DEPLOYER_AND_OPERATOR);
        assertEq(factory.treasury(), TREASURY);
        assertEq(factory.emergencyGuardian(), EMERGENCY_GUARDIAN);
        assertTrue(factory.creatorAllowed(DEPLOYER_AND_OPERATOR));
        assertEq(factory.MAX_LAUNCHES(), 100);
        assertEq(factory.LAUNCH_FEE(), 0.001 ether);
    }
}
