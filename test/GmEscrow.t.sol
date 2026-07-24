// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DoomToken} from "../src/DoomToken.sol";
import {DoomRewards} from "../src/DoomRewards.sol";
import {GmEscrow} from "../src/GmEscrow.sol";
import {ReentrantRewards, NonPullingRewards} from "./mocks/ReentrantRewards.sol";
import {MockWrappedNative, MockNftCollection} from "./mocks/MockWrappedNative.sol";

contract GmEscrowTest is Test {
    DoomToken internal token;
    DoomRewards internal rewards;
    GmEscrow internal escrow;
    MockWrappedNative internal weth;
    MockNftCollection internal nft;

    address internal creator = makeAddr("creator");
    address internal campaignManager = makeAddr("campaignManager");
    address internal communityVault = makeAddr("communityVault");
    uint256 internal constant AMOUNT = 200_000 ether;
    uint32 internal constant REQUIRED = 3;
    uint32 internal constant CADENCE = 1 days;
    uint32 internal constant GRACE = 4 hours;

    function setUp() external {
        token = new DoomToken("Doom", "DOOM", 1_000_000 ether, address(this));
        weth = new MockWrappedNative();
        nft = new MockNftCollection();
        rewards = new DoomRewards(campaignManager, address(nft), communityVault, address(weth), 7 days);
        escrow = new GmEscrow(1, address(token), creator, address(rewards), AMOUNT, REQUIRED, CADENCE, GRACE);
        token.transfer(address(escrow), AMOUNT);
    }

    function testCreatorCompletesCommitment() external {
        for (uint256 i; i < REQUIRED; ++i) {
            vm.warp(escrow.nextCheckInAt());
            vm.prank(creator);
            escrow.recordGm();
        }

        assertEq(uint256(escrow.status()), uint256(GmEscrow.Status.Completed));
        assertEq(token.balanceOf(creator), AMOUNT);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function testCreatorCannotUnlockEarly() external {
        vm.prank(creator);
        vm.expectPartialRevert(GmEscrow.CheckInTooEarly.selector);
        escrow.recordGm();
        assertEq(token.balanceOf(creator), 0);
    }

    function testDefaultCannotHappenEarly() external {
        vm.expectPartialRevert(GmEscrow.DefaultTooEarly.selector);
        escrow.finalizeDefault();
    }

    function testGmAcceptedAtExactDeadlineAndDefaultStillBlocked() external {
        uint256 deadline = escrow.nextDeadline();
        vm.warp(deadline);

        vm.prank(creator);
        escrow.recordGm();
        assertEq(escrow.completedCheckIns(), 1);
    }

    function testLateCheckInDoesNotShiftNextSchedule() external {
        uint256 firstDue = escrow.nextCheckInAt();
        vm.warp(firstDue + GRACE);
        vm.prank(creator);
        escrow.recordGm();

        assertEq(escrow.nextCheckInAt(), firstDue + CADENCE);
    }

    function testCheckInAfterDeadlineFails() external {
        uint256 deadline = escrow.nextDeadline();
        vm.warp(deadline + 1);
        vm.prank(creator);
        vm.expectPartialRevert(GmEscrow.CheckInWindowMissed.selector);
        escrow.recordGm();
    }

    function testDefaultBecomesAvailableOneSecondAfterDeadline() external {
        vm.warp(uint256(escrow.nextDeadline()) + 1);
        escrow.finalizeDefault();
        assertEq(uint256(escrow.status()), uint256(GmEscrow.Status.Defaulted));
    }

    function testPermissionlessDefaultFundsRewards() external {
        vm.warp(uint256(escrow.nextDeadline()) + 1);
        vm.prank(makeAddr("keeper"));
        escrow.finalizeDefault();

        assertEq(uint256(escrow.status()), uint256(GmEscrow.Status.Defaulted));
        assertEq(token.balanceOf(address(rewards)), AMOUNT);
        assertEq(rewards.availableRewards(address(token)), AMOUNT);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function testNoDoubleCompletion() external {
        for (uint256 i; i < REQUIRED; ++i) {
            vm.warp(escrow.nextCheckInAt());
            vm.prank(creator);
            escrow.recordGm();
        }
        vm.prank(creator);
        vm.expectPartialRevert(GmEscrow.CommitmentResolved.selector);
        escrow.recordGm();
    }

    function testNoDoubleDefault() external {
        vm.warp(uint256(escrow.nextDeadline()) + 1);
        escrow.finalizeDefault();
        vm.expectPartialRevert(GmEscrow.CommitmentResolved.selector);
        escrow.finalizeDefault();
    }

    function testOnlyCreatorCanRecordGm() external {
        vm.warp(escrow.nextCheckInAt());
        vm.prank(makeAddr("attacker"));
        vm.expectPartialRevert(GmEscrow.OnlyCreator.selector);
        escrow.recordGm();
    }

    function testRewardVaultCannotReenterDefault() external {
        ReentrantRewards reentrantRewards = new ReentrantRewards();
        GmEscrow reentrantEscrow =
            new GmEscrow(2, address(token), creator, address(reentrantRewards), AMOUNT, REQUIRED, CADENCE, GRACE);
        reentrantRewards.setEscrow(address(reentrantEscrow));
        token.transfer(address(reentrantEscrow), AMOUNT);

        vm.warp(uint256(reentrantEscrow.nextDeadline()) + 1);
        reentrantEscrow.finalizeDefault();

        assertTrue(reentrantRewards.reentryAttempted());
        assertFalse(reentrantRewards.reentrySucceeded());
        assertEq(token.balanceOf(address(reentrantRewards)), AMOUNT);
        assertEq(uint256(reentrantEscrow.status()), uint256(GmEscrow.Status.Defaulted));
    }

    function testRewardVaultCannotSilentlySkipDeposit() external {
        NonPullingRewards nonPullingRewards = new NonPullingRewards();
        GmEscrow guardedEscrow =
            new GmEscrow(3, address(token), creator, address(nonPullingRewards), AMOUNT, REQUIRED, CADENCE, GRACE);
        token.transfer(address(guardedEscrow), AMOUNT);

        vm.warp(uint256(guardedEscrow.nextDeadline()) + 1);
        vm.expectPartialRevert(GmEscrow.RewardDepositMismatch.selector);
        guardedEscrow.finalizeDefault();

        assertEq(uint256(guardedEscrow.status()), uint256(GmEscrow.Status.Active));
        assertEq(token.balanceOf(address(guardedEscrow)), AMOUNT);
    }
}
