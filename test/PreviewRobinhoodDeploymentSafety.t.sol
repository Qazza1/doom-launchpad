// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PreviewRobinhoodDeployment} from "../script/PreviewRobinhoodDeployment.s.sol";

contract PreviewRobinhoodDeploymentSafetyTest is Test {
    address internal constant DEPLOYER = 0xcaB166ed15e63b846Ec8D1a2d6762a33392c796F;
    uint256 internal constant SENTINEL_BALANCE = 123_456_789_012_345_678_901;

    function testWrongChainFailsBeforeAnyBroadcast() external {
        vm.setEnv("DOOM_LOCAL_PREVIEW_ACK", "true");
        PreviewRobinhoodDeployment preview = new PreviewRobinhoodDeployment();
        vm.expectRevert(abi.encodeWithSelector(PreviewRobinhoodDeployment.WrongChain.selector, 4663, block.chainid));
        preview.run();
    }

    function testMissingAnvilSentinelFailsBeforeAnyBroadcast() external {
        vm.setEnv("DOOM_LOCAL_PREVIEW_ACK", "true");
        vm.chainId(4663);
        vm.deal(DEPLOYER, SENTINEL_BALANCE - 1);
        PreviewRobinhoodDeployment preview = new PreviewRobinhoodDeployment();
        vm.expectRevert(
            abi.encodeWithSelector(
                PreviewRobinhoodDeployment.MissingLocalSentinelBalance.selector, SENTINEL_BALANCE, SENTINEL_BALANCE - 1
            )
        );
        preview.run();
    }
}
