// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {PositionLocker} from "../src/PositionLocker.sol";

/// @notice Stage 1 testnet-only template: deploy the locker against a verified position manager.
/// @dev This script is intentionally not run by this deliverable.
contract DeployLockerTestnetTemplate is Script {
    error TestnetAcknowledgementRequired();
    error WrongChain(uint256 expected, uint256 actual);
    error DependencyHasNoCode(address dependency);

    function run() external returns (PositionLocker locker) {
        if (!vm.envBool("TESTNET_ONLY_ACK")) revert TestnetAcknowledgementRequired();
        uint256 expectedChainId = vm.envUint("TESTNET_CHAIN_ID");
        if (expectedChainId == 0 || block.chainid != expectedChainId) {
            revert WrongChain(expectedChainId, block.chainid);
        }

        address npm = vm.envAddress("TESTNET_NONFUNGIBLE_POSITION_MANAGER");
        if (npm.code.length == 0) revert DependencyHasNoCode(npm);

        vm.startBroadcast();
        locker = new PositionLocker(npm);
        vm.stopBroadcast();
    }
}
