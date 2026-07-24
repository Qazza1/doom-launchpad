// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DeployRobinhoodCanaryRehearsal} from "../../script/DeployRobinhoodCanaryRehearsal.s.sol";
import {DoomLaunchFactory} from "../../src/DoomLaunchFactory.sol";
import {DoomRewards} from "../../src/DoomRewards.sol";
import {PositionLocker} from "../../src/PositionLocker.sol";
import {V3LiquidityManager} from "../../src/V3LiquidityManager.sol";

contract DeployRobinhoodCanaryRehearsalTest is Test {
    function testApprovedConfigurationRehearsesOnRobinhoodFork() external {
        if (!vm.envOr("RUN_ROBINHOOD_FORK_TESTS", false)) {
            vm.skip(true, "set RUN_ROBINHOOD_FORK_TESTS=true to run the deployment rehearsal");
        }
        vm.createSelectFork("robinhood_mainnet");
        vm.setEnv("ROBINHOOD_REHEARSAL_ACK", "true");

        DeployRobinhoodCanaryRehearsal rehearsal = new DeployRobinhoodCanaryRehearsal();
        (PositionLocker locker, V3LiquidityManager liquidityManager, DoomRewards rewards, DoomLaunchFactory factory) =
            rehearsal.run();

        assertTrue(factory.launchesPaused());
        assertTrue(liquidityManager.isNetworkConfigurationValid());
        assertEq(liquidityManager.authorizedFactory(), address(factory));
        assertEq(factory.positionLocker(), address(locker));
        assertEq(factory.doomRewards(), address(rewards));
    }
}
