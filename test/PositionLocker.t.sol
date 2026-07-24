// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PositionLocker} from "../src/PositionLocker.sol";
import {MockPositionManager} from "./mocks/MockPositionManager.sol";

contract PositionLockerTest is Test {
    MockPositionManager internal npm;
    PositionLocker internal locker;
    address internal beneficiary = makeAddr("beneficiary");
    address internal pool = makeAddr("pool");

    function setUp() external {
        npm = new MockPositionManager();
        locker = new PositionLocker(address(npm));
    }

    function testPositionCannotBeWithdrawnBeforeUnlock() external {
        uint256 id = npm.mint(address(this));
        npm.safeTransferFrom(address(this), address(locker), id);
        uint64 unlock = uint64(block.timestamp + 30 days);
        locker.registerLock(id, pool, beneficiary, unlock);

        assertTrue(locker.isLocked(id));
        vm.expectRevert(
            abi.encodeWithSelector(PositionLocker.PositionStillLocked.selector, id, unlock, block.timestamp)
        );
        locker.release(id);
        assertEq(npm.ownerOf(id), address(locker));
    }

    function testPermissionlessReleasePaysPrecommittedBeneficiary() external {
        uint256 id = npm.mint(address(this));
        npm.safeTransferFrom(address(this), address(locker), id);
        uint64 unlock = uint64(block.timestamp + 1 days);
        locker.registerLock(id, pool, beneficiary, unlock);

        vm.warp(unlock);
        vm.prank(makeAddr("keeper"));
        locker.release(id);

        assertEq(npm.ownerOf(id), beneficiary);
        assertFalse(locker.isLocked(id));
    }

    function testCannotRegisterPositionNotOwnedByLocker() external {
        uint256 id = npm.mint(address(this));
        vm.expectRevert(abi.encodeWithSelector(PositionLocker.LockerDoesNotOwnPosition.selector, id, address(this)));
        locker.registerLock(id, pool, beneficiary, uint64(block.timestamp + 1 days));
    }

    function testLockerCannotBeItsOwnReleaseBeneficiary() external {
        uint256 id = npm.mint(address(this));
        npm.safeTransferFrom(address(this), address(locker), id);

        vm.expectPartialRevert(PositionLocker.InvalidBeneficiary.selector);
        locker.registerLock(id, pool, address(locker), uint64(block.timestamp + 1 days));
    }
}
