// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DoomToken} from "../src/DoomToken.sol";
import {PositionLocker} from "../src/PositionLocker.sol";
import {V3LiquidityManager} from "../src/V3LiquidityManager.sol";
import {ILiquidityManager} from "../src/interfaces/ILiquidityManager.sol";
import {MockWrappedNative} from "./mocks/MockWrappedNative.sol";
import {MockCanonicalV3Factory, MockCanonicalPositionManager, MockBindingFactory} from "./mocks/MockCanonicalV3.sol";

contract V3LiquidityManagerTest is Test {
    MockWrappedNative internal weth;
    MockCanonicalV3Factory internal v3Factory;
    MockCanonicalPositionManager internal npm;
    PositionLocker internal locker;
    V3LiquidityManager internal manager;
    MockBindingFactory internal boundFactory;
    DoomToken internal token;

    address internal beneficiary = makeAddr("beneficiary");
    uint256 internal constant AMOUNT = 1 ether;

    function setUp() external {
        weth = new MockWrappedNative();
        v3Factory = new MockCanonicalV3Factory();
        npm = new MockCanonicalPositionManager(address(v3Factory), address(weth));
        locker = new PositionLocker(address(npm));
        manager = new V3LiquidityManager(
            block.chainid, address(this), address(v3Factory), address(npm), address(weth), address(locker)
        );
        boundFactory = new MockBindingFactory(address(manager));
        manager.bindFactory(address(boundFactory));
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
            lpBeneficiary: beneficiary,
            fee: 3_000,
            tickLower: -887220,
            tickUpper: 887220,
            sqrtPriceX96: 79228162514264337593543950336,
            unlockTime: uint64(block.timestamp + 365 days)
        });
    }

    function testConfigurationAndOneTimeBindingAreFailClosed() external {
        assertTrue(manager.isNetworkConfigurationValid());

        vm.expectPartialRevert(V3LiquidityManager.FactoryAlreadyBound.selector);
        manager.bindFactory(address(boundFactory));

        vm.chainId(block.chainid + 1);
        assertFalse(manager.isNetworkConfigurationValid());
    }

    function testCreatesPositionLocksNftAndLeavesNoAdapterBalance() external {
        ILiquidityManager.CreateLiquidityParams memory params = _params();
        (address pool, uint256 positionId, uint256 tokenUsed, uint256 nativeUsed) =
            boundFactory.provide{value: AMOUNT}(params);

        assertEq(pool, npm.pool());
        assertEq(tokenUsed, AMOUNT);
        assertEq(nativeUsed, AMOUNT);
        assertEq(npm.ownerOf(positionId), address(locker));
        assertTrue(locker.isLocked(positionId));
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
}
