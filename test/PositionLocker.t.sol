// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DoomToken} from "../src/DoomToken.sol";
import {DoomRewards} from "../src/DoomRewards.sol";
import {PositionLocker} from "../src/PositionLocker.sol";
import {MockCanonicalV3Factory, MockCanonicalPositionManager, MockCanonicalV3Pool} from "./mocks/MockCanonicalV3.sol";
import {MockWrappedNative, MockNftCollection} from "./mocks/MockWrappedNative.sol";

contract MockPermanentRegistrar {
    PositionLocker public immutable positionLockerContract;

    constructor(address locker_) {
        positionLockerContract = PositionLocker(locker_);
    }

    function positionLocker() external view returns (address) {
        return address(positionLockerContract);
    }

    function register(
        uint256 positionId,
        address pool,
        address launchToken,
        address creator,
        address gmEscrow,
        uint256 launchId
    ) external {
        positionLockerContract.registerPermanentLock(positionId, pool, launchToken, creator, gmEscrow, launchId);
    }
}

contract MockFeeEligibilityEscrow {
    uint8 public status;
    uint64 public nextDeadline;

    constructor(uint8 status_, uint64 deadline_) {
        status = status_;
        nextDeadline = deadline_;
    }

    function setEligibility(uint8 status_, uint64 deadline_) external {
        status = status_;
        nextDeadline = deadline_;
    }
}

contract PositionLockerTest is Test {
    uint24 internal constant POOL_FEE = 10_000;
    int24 internal constant LOWER = -887200;
    int24 internal constant UPPER = 887200;

    MockWrappedNative internal weth;
    MockNftCollection internal nft;
    DoomToken internal launchToken;
    DoomRewards internal rewards;
    MockCanonicalV3Factory internal v3Factory;
    MockCanonicalPositionManager internal npm;
    PositionLocker internal locker;
    MockPermanentRegistrar internal registrar;
    MockFeeEligibilityEscrow internal escrow;
    MockCanonicalV3Pool internal pool;

    address internal creator = makeAddr("creator");
    address internal treasury = makeAddr("treasury");
    address internal campaignManager = makeAddr("campaignManager");
    uint256 internal positionId;

    function setUp() external {
        weth = new MockWrappedNative();
        nft = new MockNftCollection();
        launchToken = new DoomToken("Doom", "DOOM", 1_000_000 ether, address(this));
        rewards = new DoomRewards(campaignManager, address(nft), treasury, address(weth), 7 days);
        v3Factory = new MockCanonicalV3Factory();
        npm = new MockCanonicalPositionManager(address(v3Factory), address(weth));
        locker = new PositionLocker(address(npm), address(weth), address(rewards), treasury, address(this));
        registrar = new MockPermanentRegistrar(address(locker));
        locker.bindRegistrar(address(registrar));
        escrow = new MockFeeEligibilityEscrow(0, uint64(block.timestamp + 1 days));
        pool = new MockCanonicalV3Pool();

        positionId = npm.mintTestPosition(address(locker), address(launchToken), address(weth), POOL_FEE, LOWER, UPPER);
        registrar.register(positionId, address(pool), address(launchToken), creator, address(escrow), 1);
    }

    function _seedFees(uint128 tokenFees, uint128 wethFees) internal {
        if (wethFees != 0) {
            vm.deal(address(this), wethFees);
            weth.deposit{value: wethFees}();
        }
        launchToken.approve(address(npm), tokenFees);
        weth.approve(address(npm), wethFees);
        npm.seedFees(positionId, tokenFees, wethFees);
    }

    function testPositionIsPermanentlyLockedWithNoReleaseSurface() external view {
        assertTrue(locker.isPermanentlyLocked(positionId));
        assertEq(npm.ownerOf(positionId), address(locker));

        (,,,,,, bool permanent, bool currentlyLocked) = locker.lockState(positionId);
        assertTrue(permanent);
        assertTrue(currentlyLocked);
    }

    function testOnlyBoundRegistrarCanRegister() external {
        uint256 otherId =
            npm.mintTestPosition(address(locker), address(launchToken), address(weth), POOL_FEE, LOWER, UPPER);
        vm.expectRevert(abi.encodeWithSelector(PositionLocker.UnauthorizedRegistrar.selector, address(this)));
        locker.registerPermanentLock(otherId, address(pool), address(launchToken), creator, address(escrow), 2);
    }

    function testRegistrarBindingIsOneTime() external {
        vm.expectRevert(abi.encodeWithSelector(PositionLocker.RegistrarAlreadyBound.selector, address(registrar)));
        locker.bindRegistrar(address(registrar));
    }

    function testActiveCreatorReceivesSixtyTwentyTwentyWethSplit() external {
        _seedFees(100 ether, 10 ether);

        vm.prank(makeAddr("keeper"));
        locker.collectFees(positionId);

        assertEq(weth.balanceOf(creator), 6 ether);
        assertEq(weth.balanceOf(treasury), 2 ether);
        assertEq(rewards.availableRewards(address(weth)), 2 ether);
        assertEq(rewards.availableRewards(address(launchToken)), 100 ether);
        assertEq(weth.balanceOf(address(locker)), 0);
        assertEq(launchToken.balanceOf(address(locker)), 0);
    }

    function testCompletedCreatorRemainsFeeEligible() external {
        escrow.setEligibility(1, 0);
        _seedFees(0, 10 ether);

        locker.collectFees(positionId);

        assertEq(weth.balanceOf(creator), 6 ether);
        assertEq(weth.balanceOf(treasury), 2 ether);
        assertEq(rewards.availableRewards(address(weth)), 2 ether);
    }

    function testDefaultRedirectsCreatorShareToRewards() external {
        escrow.setEligibility(2, 0);
        _seedFees(0, 10 ether);

        locker.collectFees(positionId);

        assertEq(weth.balanceOf(creator), 0);
        assertEq(weth.balanceOf(treasury), 2 ether);
        assertEq(rewards.availableRewards(address(weth)), 8 ether);
    }

    function testOverdueActiveEscrowRedirectsCreatorShareBeforeFinalization() external {
        uint64 deadline = escrow.nextDeadline();
        vm.warp(uint256(deadline) + 1);
        _seedFees(0, 10 ether);

        locker.collectFees(positionId);

        assertEq(weth.balanceOf(creator), 0);
        assertEq(weth.balanceOf(treasury), 2 ether);
        assertEq(rewards.availableRewards(address(weth)), 8 ether);
    }

    function testLaunchTokenFeesAlwaysGoEntirelyToRewards() external {
        _seedFees(123 ether, 0);

        locker.collectFees(positionId);

        assertEq(rewards.availableRewards(address(launchToken)), 123 ether);
        assertEq(launchToken.balanceOf(creator), 0);
        assertEq(launchToken.balanceOf(treasury), 0);
    }

    function testPermissionlessCollectorCannotCaptureFees() external {
        address keeper = makeAddr("keeper");
        _seedFees(10 ether, 10 ether);

        vm.prank(keeper);
        locker.collectFees(positionId);

        assertEq(weth.balanceOf(keeper), 0);
        assertEq(launchToken.balanceOf(keeper), 0);
    }

    function testRejectsNonCanonicalPositionTerms() external {
        uint256 badId =
            npm.mintTestPosition(address(locker), address(launchToken), address(weth), 3_000, -887220, 887220);
        vm.expectRevert(abi.encodeWithSelector(PositionLocker.InvalidPositionConfiguration.selector, badId));
        registrar.register(badId, address(pool), address(launchToken), creator, address(escrow), 2);
    }
}
