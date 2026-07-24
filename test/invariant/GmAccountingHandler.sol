// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {GmEscrow} from "../../src/GmEscrow.sol";

contract GmAccountingHandler is Test {
    GmEscrow public immutable escrow;
    address public immutable creator;
    address public immutable stranger;

    uint256 public successfulActions;
    uint256 public rejectedActions;

    constructor(GmEscrow escrow_, address creator_) {
        escrow = escrow_;
        creator = creator_;
        stranger = makeAddr("invariantStranger");
    }

    function recordAtBoundary(uint8 boundary, bool useCreator) external {
        uint64 due = escrow.nextCheckInAt();
        uint64 deadline = escrow.nextDeadline();
        uint256 target;
        if (escrow.status() != GmEscrow.Status.Active) {
            target = block.timestamp;
        } else if (boundary % 4 == 0) {
            target = due == 0 ? block.timestamp : uint256(due) - 1;
        } else if (boundary % 4 == 1) {
            target = due;
        } else if (boundary % 4 == 2) {
            target = deadline;
        } else {
            target = uint256(deadline) + 1;
        }
        if (target < block.timestamp) target = block.timestamp;
        vm.warp(target);
        vm.prank(useCreator ? creator : stranger);
        try escrow.recordGm() {
            successfulActions++;
        } catch {
            rejectedActions++;
        }
    }

    function finalizeAtBoundary(uint8 boundary) external {
        uint64 deadline = escrow.nextDeadline();
        uint256 target;
        if (escrow.status() != GmEscrow.Status.Active) {
            target = block.timestamp;
        } else if (boundary % 3 == 0) {
            target = deadline == 0 ? block.timestamp : uint256(deadline) - 1;
        } else if (boundary % 3 == 1) {
            target = deadline;
        } else {
            target = uint256(deadline) + 1;
        }
        if (target < block.timestamp) target = block.timestamp;
        vm.warp(target);
        try escrow.finalizeDefault() {
            successfulActions++;
        } catch {
            rejectedActions++;
        }
    }
}
