// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {GmEscrow} from "../../src/GmEscrow.sol";

contract GmAccountingHandler is Test {
    GmEscrow public immutable escrow;
    address public immutable creator;

    constructor(GmEscrow escrow_, address creator_) {
        escrow = escrow_;
        creator = creator_;
    }

    function recordNextGm() external {
        if (escrow.status() != GmEscrow.Status.Active) return;
        vm.warp(escrow.nextCheckInAt());
        vm.prank(creator);
        escrow.recordGm();
    }

    function finalizeDefault() external {
        if (escrow.status() != GmEscrow.Status.Active) return;
        vm.warp(uint256(escrow.nextDeadline()) + 1);
        escrow.finalizeDefault();
    }
}
