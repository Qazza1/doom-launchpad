// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {DoomLaunchFactory} from "../src/DoomLaunchFactory.sol";
import {DoomToken} from "../src/DoomToken.sol";
import {DoomRewards} from "../src/DoomRewards.sol";
import {GmEscrow} from "../src/GmEscrow.sol";
import {PositionLocker} from "../src/PositionLocker.sol";
import {MockPositionManager} from "./mocks/MockPositionManager.sol";
import {MockLiquidityManager} from "./mocks/MockLiquidityManager.sol";
import {MockWrappedNative, MockNftCollection} from "./mocks/MockWrappedNative.sol";
import {RejectingTreasury} from "./mocks/RejectingTreasury.sol";

contract DoomLaunchFactoryTest is Test {
    DoomRewards internal rewards;
    MockPositionManager internal npm;
    PositionLocker internal locker;
    MockLiquidityManager internal manager;
    MockWrappedNative internal weth;
    MockNftCollection internal nft;
    DoomLaunchFactory internal factory;

    address internal operator = makeAddr("operator");
    address internal guardian = makeAddr("guardian");
    address internal treasury = makeAddr("treasury");
    address internal campaignManager = makeAddr("campaignManager");
    address internal creator = makeAddr("creator");

    uint256 internal constant NATIVE_LIQUIDITY = 1 ether;
    uint256 internal constant CREATION_FEE = 0.1 ether;
    uint256 internal constant TREASURY_FEE = 0.05 ether;
    uint256 internal constant NFT_REWARD_FEE = 0.05 ether;
    uint256 internal constant REQUIRED_VALUE = NATIVE_LIQUIDITY + CREATION_FEE;

    function setUp() external {
        weth = new MockWrappedNative();
        nft = new MockNftCollection();
        rewards = new DoomRewards(campaignManager, address(nft), treasury, address(weth), 7 days);
        npm = new MockPositionManager();
        locker = new PositionLocker(address(npm));
        manager = new MockLiquidityManager(address(npm), address(locker));
        factory = _deployFactory(treasury, 3, 1 ether, 3 ether);

        vm.prank(operator);
        factory.resumeLaunches();
        vm.deal(creator, 100 ether);
    }

    function _config(address treasury_, uint32 maxLaunches_, uint256 perLaunch, uint256 globalLimit)
        internal
        view
        returns (DoomLaunchFactory.FactoryConfig memory)
    {
        return DoomLaunchFactory.FactoryConfig({
            operator: operator,
            emergencyGuardian: guardian,
            approvedCreator: creator,
            treasury: treasury_,
            doomRewards: address(rewards),
            wrappedNative: address(weth),
            liquidityManager: address(manager),
            positionLocker: address(locker),
            maxLaunches: maxLaunches_,
            maxNativeLiquidityPerLaunch: perLaunch,
            maxNativeLiquidityGlobal: globalLimit
        });
    }

    function _deployFactory(address treasury_, uint32 maxLaunches_, uint256 perLaunch, uint256 globalLimit)
        internal
        returns (DoomLaunchFactory deployed)
    {
        deployed = new DoomLaunchFactory(_config(treasury_, maxLaunches_, perLaunch, globalLimit));
    }

    function _params() internal pure returns (DoomLaunchFactory.LaunchParams memory p) {
        p = DoomLaunchFactory.LaunchParams({
            name: "Doom Coin", symbol: "DOOM", totalSupply: 1_000_000_000 ether, nativeLiquidityAmount: NATIVE_LIQUIDITY
        });
    }

    function _launch(DoomLaunchFactory target) internal returns (address tokenAddress, address escrowAddress) {
        vm.prank(creator);
        (, tokenAddress,,, escrowAddress) = target.launch{value: REQUIRED_VALUE}(_params());
    }

    function testHappyPathEnforcesEconomicsAndLockedPosition() external {
        vm.prank(creator);
        (uint256 id, address tokenAddress, address pool, uint256 positionId, address escrowAddress) =
            factory.launch{value: REQUIRED_VALUE}(_params());

        DoomToken token = DoomToken(tokenAddress);
        assertEq(id, 1);
        assertEq(pool, manager.pool());
        assertEq(token.totalSupply(), 1_000_000_000 ether);
        assertEq(token.balanceOf(creator), token.totalSupply() * 10 / 100);
        assertEq(token.balanceOf(address(manager)), token.totalSupply() * 40 / 100);
        assertEq(token.balanceOf(escrowAddress), token.totalSupply() * 50 / 100);
        assertEq(token.balanceOf(address(factory)), 0);
        assertTrue(locker.isLocked(positionId));

        assertEq(factory.accruedTreasuryFees(), TREASURY_FEE);
        assertEq(rewards.availableRewards(address(weth)), NFT_REWARD_FEE);
        assertEq(weth.balanceOf(address(rewards)), NFT_REWARD_FEE);
        assertEq(manager.nativeReceived(), NATIVE_LIQUIDITY);
        assertEq(factory.totalNativeLiquidity(), NATIVE_LIQUIDITY);

        GmEscrow escrow = GmEscrow(escrowAddress);
        assertEq(escrow.creator(), creator);
        assertEq(escrow.requiredCheckIns(), 3);
        assertEq(escrow.cadenceSeconds(), 1 days);
        assertEq(escrow.gracePeriodSeconds(), 12 hours);

        DoomLaunchFactory.LaunchRecord memory record = factory.getLaunch(id);
        assertEq(record.creator, creator);
        assertEq(record.creationFee, CREATION_FEE);
        assertEq(record.treasuryFee, TREASURY_FEE);
        assertEq(record.nftRewardFee, NFT_REWARD_FEE);
        assertEq(record.lpUnlockTime, block.timestamp + 365 days);
        assertGt(record.sqrtPriceX96, factory.MIN_SQRT_RATIO());
        assertLt(record.sqrtPriceX96, factory.MAX_SQRT_RATIO());
        assertEq(record.configurationHash, manager.configurationHash());
    }

    function testNewFactoryStartsPaused() external {
        DoomLaunchFactory fresh = _deployFactory(treasury, 3, 1 ether, 3 ether);
        assertTrue(fresh.launchesPaused());
    }

    function testZeroNftSupplyLeavesFeeRewardsAvailableInVault() external {
        _launch(factory);
        assertEq(rewards.availableRewards(address(weth)), NFT_REWARD_FEE);
        assertEq(rewards.reservedRewards(address(weth)), 0);
        assertEq(weth.balanceOf(address(rewards)), NFT_REWARD_FEE);
    }

    function testFactoryRejectsMismatchedRewardToken() external {
        MockWrappedNative wrongWeth = new MockWrappedNative();
        DoomLaunchFactory.FactoryConfig memory config = _config(treasury, 3, 1 ether, 3 ether);
        config.wrappedNative = address(wrongWeth);

        vm.expectPartialRevert(DoomLaunchFactory.RewardTokenMismatch.selector);
        new DoomLaunchFactory(config);
    }

    function testFeeAndRefundAccounting() external {
        uint256 overpayment = 0.4 ether;
        uint256 beforeBalance = creator.balance;
        vm.txGasPrice(0);

        vm.prank(creator);
        factory.launch{value: REQUIRED_VALUE + overpayment}(_params());

        assertEq(creator.balance, beforeBalance - REQUIRED_VALUE);
        assertEq(address(factory).balance, TREASURY_FEE);
        assertEq(address(manager).balance, NATIVE_LIQUIDITY);
        assertEq(weth.balanceOf(address(rewards)), NFT_REWARD_FEE);

        uint256 treasuryBefore = treasury.balance;
        vm.prank(treasury);
        factory.withdrawAccruedTreasuryFees(TREASURY_FEE);
        assertEq(treasury.balance, treasuryBefore + TREASURY_FEE);
        assertEq(factory.accruedTreasuryFees(), 0);
        assertEq(address(factory).balance, 0);
    }

    function testBoundedV3RemainderGoesToRewardsAndFeeUsesActualNative() external {
        manager.setUsagePpm(999_999, 999_999);
        uint256 beforeBalance = creator.balance;
        vm.txGasPrice(0);

        vm.prank(creator);
        (uint256 id, address tokenAddress,,,) = factory.launch{value: REQUIRED_VALUE}(_params());

        DoomLaunchFactory.LaunchRecord memory record = factory.getLaunch(id);
        uint256 allocated = 400_000_000 ether;
        uint256 expectedTokenUsed = allocated * 999_999 / 1_000_000;
        uint256 expectedRemainder = allocated - expectedTokenUsed;
        uint256 expectedNativeUsed = NATIVE_LIQUIDITY * 999_999 / 1_000_000;
        uint256 expectedFee = expectedNativeUsed / 10;

        assertEq(record.liquidityTokenAmountAllocated, allocated);
        assertEq(record.liquidityTokenAmountUsed, expectedTokenUsed);
        assertEq(record.liquidityTokenRemainder, expectedRemainder);
        assertEq(record.nativeLiquidityAmountUsed, expectedNativeUsed);
        assertEq(record.creationFee, expectedFee);
        assertEq(rewards.availableRewards(tokenAddress), expectedRemainder);
        assertEq(creator.balance, beforeBalance - expectedNativeUsed - expectedFee);
    }

    function testV3UtilizationBelowOnePpmToleranceReverts() external {
        manager.setUsagePpm(999_998, 999_998);

        vm.prank(creator);
        vm.expectPartialRevert(DoomLaunchFactory.LiquidityUtilizationTooLow.selector);
        factory.launch{value: REQUIRED_VALUE}(_params());

        assertEq(factory.nextLaunchId(), 1);
        assertEq(factory.totalNativeLiquidity(), 0);
    }

    function testGuardianCanPauseButCannotResume() external {
        vm.prank(guardian);
        factory.pauseLaunches();
        assertTrue(factory.launchesPaused());

        vm.prank(creator);
        vm.expectRevert(DoomLaunchFactory.LaunchesArePaused.selector);
        factory.launch{value: REQUIRED_VALUE}(_params());

        vm.prank(guardian);
        vm.expectPartialRevert(DoomLaunchFactory.UnauthorizedOperator.selector);
        factory.resumeLaunches();

        vm.prank(operator);
        factory.resumeLaunches();
        assertFalse(factory.launchesPaused());
    }

    function testUnauthorizedAccountCannotPause() external {
        address attacker = makeAddr("attacker");
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(DoomLaunchFactory.UnauthorizedPauseCaller.selector, attacker));
        factory.pauseLaunches();
    }

    function testOnlyApprovedCreatorCanLaunch() external {
        address attacker = makeAddr("attacker");
        vm.deal(attacker, REQUIRED_VALUE);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(DoomLaunchFactory.UnauthorizedCreator.selector, attacker));
        factory.launch{value: REQUIRED_VALUE}(_params());
    }

    function testLaunchCountCapIsEnforced() external {
        _launch(factory);
        _launch(factory);
        _launch(factory);

        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(DoomLaunchFactory.LaunchLimitReached.selector, 3));
        factory.launch{value: REQUIRED_VALUE}(_params());
    }

    function testPerLaunchLiquidityCapIsEnforced() external {
        DoomLaunchFactory.LaunchParams memory p = _params();
        p.nativeLiquidityAmount = 1 ether + 1;
        vm.prank(creator);
        vm.expectPartialRevert(DoomLaunchFactory.PerLaunchLiquidityLimitExceeded.selector);
        factory.launch{value: 2 ether}(p);
    }

    function testLiquidityTooSmallToSplitFeeIsRejected() external {
        DoomLaunchFactory.LaunchParams memory p = _params();
        p.nativeLiquidityAmount = 10;
        vm.prank(creator);
        vm.expectPartialRevert(DoomLaunchFactory.CreationFeeTooSmall.selector);
        factory.launch{value: 11}(p);
    }

    function testGlobalLiquidityCapIsEnforced() external {
        DoomLaunchFactory limited = _deployFactory(treasury, 4, 1 ether, 2 ether);
        vm.prank(operator);
        limited.resumeLaunches();
        _launch(limited);
        _launch(limited);

        vm.prank(creator);
        vm.expectPartialRevert(DoomLaunchFactory.GlobalLiquidityLimitExceeded.selector);
        limited.launch{value: REQUIRED_VALUE}(_params());
    }

    function testCreationFeeQuoteIsTenPercent() external view {
        assertEq(factory.quoteCreationFee(0.01 ether), 0.001 ether);
        assertEq(factory.quoteCreationFee(1 ether), CREATION_FEE);
    }

    function testInvalidUniswapConfigurationFailsSafely() external {
        manager.setValid(false);
        vm.prank(creator);
        vm.expectRevert(DoomLaunchFactory.InvalidLiquidityConfiguration.selector);
        factory.launch{value: REQUIRED_VALUE}(_params());
    }

    function testInsufficientNativeValueFails() external {
        vm.prank(creator);
        vm.expectPartialRevert(DoomLaunchFactory.InsufficientNativeValue.selector);
        factory.launch{value: REQUIRED_VALUE - 1}(_params());
    }

    function testZeroSupplyFails() external {
        DoomLaunchFactory.LaunchParams memory p = _params();
        p.totalSupply = 0;
        vm.prank(creator);
        vm.expectRevert(DoomLaunchFactory.InvalidSupply.selector);
        factory.launch{value: REQUIRED_VALUE}(p);
    }

    function testImpracticalSupplyThatCannotBePricedFailsClosed() external {
        DoomLaunchFactory.LaunchParams memory p = _params();
        p.totalSupply = type(uint256).max;

        vm.prank(creator);
        vm.expectPartialRevert(DoomLaunchFactory.InitialPriceOutOfRange.selector);
        factory.launch{value: REQUIRED_VALUE}(p);
    }

    function testSpoofedLockerTermsFailSafely() external {
        manager.setRecordedPoolOverride(makeAddr("spoofedPool"));

        vm.prank(creator);
        vm.expectPartialRevert(DoomLaunchFactory.PositionLockTermsMismatch.selector);
        factory.launch{value: REQUIRED_VALUE}(_params());

        assertEq(factory.nextLaunchId(), 1);
        assertEq(factory.accruedTreasuryFees(), 0);
        assertEq(factory.totalNativeLiquidity(), 0);
        assertEq(address(factory).balance, 0);
    }

    function testReturnedPoolMustContainCode() external {
        manager.setPool(makeAddr("eoaPool"));

        vm.prank(creator);
        vm.expectPartialRevert(DoomLaunchFactory.PoolHasNoCode.selector);
        factory.launch{value: REQUIRED_VALUE}(_params());
    }

    function testOnlyTreasuryCanWithdrawFees() external {
        _launch(factory);

        vm.prank(creator);
        vm.expectPartialRevert(DoomLaunchFactory.UnauthorizedTreasury.selector);
        factory.withdrawAccruedTreasuryFees(TREASURY_FEE);
    }

    function testTreasuryPayoutUsesSafeCallAndDoesNotSilentlyFail() external {
        RejectingTreasury rejecting = new RejectingTreasury();
        DoomLaunchFactory rejectingFactory = _deployFactory(address(rejecting), 3, 1 ether, 3 ether);
        vm.prank(operator);
        rejectingFactory.resumeLaunches();
        _launch(rejectingFactory);

        vm.prank(address(rejecting));
        vm.expectPartialRevert(DoomLaunchFactory.NativeTransferFailed.selector);
        rejectingFactory.withdrawAccruedTreasuryFees(TREASURY_FEE);
        assertEq(rejectingFactory.accruedTreasuryFees(), TREASURY_FEE);
    }

    function testReentrantManagerCannotReenterLaunch() external {
        DoomLaunchFactory.LaunchParams memory p = _params();
        bytes memory reentry = abi.encodeCall(DoomLaunchFactory.launch, (p));
        manager.setReentry(address(factory), reentry);

        vm.prank(creator);
        factory.launch{value: REQUIRED_VALUE}(p);

        assertTrue(manager.reentryAttempted());
        assertFalse(manager.reentrySucceeded());
        assertEq(factory.nextLaunchId(), 2);
    }

    function testFuzzFixedAllocationAccounting(uint96 rawSupply) external {
        uint256 supply = bound(uint256(rawSupply), 10_000, 1e28);
        DoomLaunchFactory.LaunchParams memory p = _params();
        p.totalSupply = supply;

        vm.prank(creator);
        (, address tokenAddress,,, address escrowAddress) = factory.launch{value: REQUIRED_VALUE}(p);

        DoomToken token = DoomToken(tokenAddress);
        uint256 creatorAmount = Math.mulDiv(supply, 1_000, 10_000);
        uint256 liquidityAmount = Math.mulDiv(supply, 4_000, 10_000);
        uint256 escrowAmount = supply - creatorAmount - liquidityAmount;

        assertEq(token.balanceOf(creator), creatorAmount);
        assertEq(token.balanceOf(address(manager)), liquidityAmount);
        assertEq(token.balanceOf(escrowAddress), escrowAmount);
        assertEq(creatorAmount + liquidityAmount + escrowAmount, supply);
        assertEq(token.totalSupply(), supply);
    }
}
