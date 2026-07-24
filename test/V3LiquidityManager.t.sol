// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DoomToken} from "../src/DoomToken.sol";
import {DoomRewards} from "../src/DoomRewards.sol";
import {PositionLocker} from "../src/PositionLocker.sol";
import {V3LiquidityManager} from "../src/V3LiquidityManager.sol";
import {ILiquidityManager} from "../src/interfaces/ILiquidityManager.sol";
import {MockWrappedNative, MockNftCollection} from "./mocks/MockWrappedNative.sol";
import {MockCanonicalV3Factory, MockCanonicalPositionManager, MockBindingFactory} from "./mocks/MockCanonicalV3.sol";

contract MockActiveGmEscrow {
    function status() external pure returns (uint8) {
        return 0;
    }

    function nextDeadline() external view returns (uint64) {
        return uint64(block.timestamp + 1 days);
    }
}

contract V3LiquidityManagerTest is Test {
    MockWrappedNative internal weth;
    MockNftCollection internal nft;
    DoomRewards internal rewards;
    MockCanonicalV3Factory internal v3Factory;
    MockCanonicalPositionManager internal npm;
    PositionLocker internal locker;
    V3LiquidityManager internal manager;
    MockBindingFactory internal boundFactory;
    MockActiveGmEscrow internal gmEscrow;
    DoomToken internal token;

    address internal treasury = makeAddr("treasury");
    uint256 internal constant AMOUNT = 1 ether;
    uint160 internal constant ONE_TO_ONE_PRICE = 79_228_162_514_264_337_593_543_950_336;

    function setUp() external {
        weth = new MockWrappedNative();
        nft = new MockNftCollection();
        rewards = new DoomRewards(makeAddr("campaignManager"), address(nft), treasury, address(weth), 7 days);
        v3Factory = new MockCanonicalV3Factory();
        npm = new MockCanonicalPositionManager(address(v3Factory), address(weth));
        locker = new PositionLocker(address(npm), address(weth), address(rewards), treasury, address(this));
        manager = new V3LiquidityManager(
            block.chainid, address(this), address(v3Factory), address(npm), address(weth), address(locker)
        );
        locker.bindRegistrar(address(manager));
        boundFactory = new MockBindingFactory(address(manager));
        manager.bindFactory(address(boundFactory));
        gmEscrow = new MockActiveGmEscrow();
        token = new DoomToken("Launch", "LCH", 10 ether, address(this));
        token.transfer(address(boundFactory), AMOUNT);
        vm.deal(address(this), 10 ether);
    }

    function _params() internal view returns (ILiquidityManager.CreateLiquidityParams memory) {
        return ILiquidityManager.CreateLiquidityParams({
            token: address(token),
            tokenAmount: AMOUNT,
            nativeAmount: AMOUNT,
            creator: address(this),
            gmEscrow: address(gmEscrow),
            launchId: 1,
            fee: 10_000,
            tickLower: -887200,
            tickUpper: 887200,
            sqrtPriceX96: ONE_TO_ONE_PRICE
        });
    }

    function testConfigurationAndOneTimeBindingsAreFailClosed() external {
        assertTrue(manager.isNetworkConfigurationValid());

        vm.expectPartialRevert(V3LiquidityManager.FactoryAlreadyBound.selector);
        manager.bindFactory(address(boundFactory));

        vm.expectPartialRevert(PositionLocker.RegistrarAlreadyBound.selector);
        locker.bindRegistrar(address(manager));

        vm.chainId(block.chainid + 1);
        assertFalse(manager.isNetworkConfigurationValid());
    }

    function testCreatesPositionPermanentlyLocksNftAndLeavesNoAdapterBalance() external {
        ILiquidityManager.CreateLiquidityParams memory params = _params();
        (address pool, uint256 positionId, uint256 tokenUsed, uint256 nativeUsed) =
            boundFactory.provide{value: AMOUNT}(params);

        assertEq(pool, npm.pool());
        assertEq(tokenUsed, AMOUNT);
        assertEq(nativeUsed, AMOUNT);
        assertEq(npm.ownerOf(positionId), address(locker));
        assertTrue(locker.isPermanentlyLocked(positionId));
        (
            address recordedPool,
            address recordedToken,
            address recordedCreator,
            address recordedEscrow,
            uint256 launchId,,
            bool permanent,
        ) = locker.lockState(positionId);
        assertEq(recordedPool, pool);
        assertEq(recordedToken, address(token));
        assertEq(recordedCreator, address(this));
        assertEq(recordedEscrow, address(gmEscrow));
        assertEq(launchId, 1);
        assertTrue(permanent);
        assertEq(token.balanceOf(address(manager)), 0);
        assertEq(weth.balanceOf(address(manager)), 0);
        assertEq(address(manager).balance, 0);
    }

    function testReturnsBoundedTokenAndNativeRemaindersToFactory() external {
        npm.setUsePpm(999_999);
        ILiquidityManager.CreateLiquidityParams memory params = _params();
        uint256 tokenBefore = token.balanceOf(address(boundFactory));
        uint256 nativeBefore = address(boundFactory).balance;

        (,, uint256 tokenUsed, uint256 nativeUsed) = boundFactory.provide{value: AMOUNT}(params);

        assertEq(token.balanceOf(address(boundFactory)), tokenBefore - tokenUsed);
        assertEq(address(boundFactory).balance, nativeBefore + AMOUNT - nativeUsed);
        assertEq(token.balanceOf(address(manager)), 0);
        assertEq(weth.balanceOf(address(manager)), 0);
    }

    function testRejectsUtilizationBelowConfiguredTolerance() external {
        npm.setUsePpm(999_998);
        vm.expectRevert(bytes("minimum"));
        boundFactory.provide{value: AMOUNT}(_params());
    }

    function testOnlyBoundFactoryCanProvideLiquidity() external {
        vm.expectPartialRevert(V3LiquidityManager.UnauthorizedFactory.selector);
        manager.createAndLockLiquidity{value: AMOUNT}(_params());
    }

    function testRejectsLegacyPointThreePercentTierAndTicks() external {
        ILiquidityManager.CreateLiquidityParams memory params = _params();
        params.fee = 3_000;
        params.tickLower = -887220;
        params.tickUpper = 887220;

        vm.expectPartialRevert(V3LiquidityManager.InvalidLiquidityParams.selector);
        boundFactory.provide{value: AMOUNT}(params);
    }

    function testRejectsPriceAtFullRangeBoundary() external {
        ILiquidityManager.CreateLiquidityParams memory params = _params();
        params.sqrtPriceX96 = manager.FULL_RANGE_MIN_SQRT_RATIO();

        vm.expectPartialRevert(V3LiquidityManager.InvalidLiquidityParams.selector);
        boundFactory.provide{value: AMOUNT}(params);
    }
}
