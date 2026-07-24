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
import {MockLiquidityManager, MockPool} from "./mocks/MockLiquidityManager.sol";
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

    uint256 internal constant NATIVE_LIQUIDITY = 0.01 ether;
    uint256 internal constant CREATION_FEE = 0.0003 ether;
    uint256 internal constant TREASURY_FEE = 0.00015 ether;
    uint256 internal constant NFT_REWARD_FEE = 0.00015 ether;
    uint256 internal constant REQUIRED_VALUE = NATIVE_LIQUIDITY + CREATION_FEE;

    function setUp() external {
        weth = new MockWrappedNative();
        nft = new MockNftCollection();
        rewards = new DoomRewards(campaignManager, address(nft), treasury, address(weth), 7 days);
        npm = new MockPositionManager();
        locker = new PositionLocker(address(npm), address(weth), address(rewards), treasury, operator);
        manager = new MockLiquidityManager(address(npm), address(locker));
        vm.prank(operator);
        locker.bindRegistrar(address(manager));
        factory = _deployFactory(treasury, rewards, locker, manager);

        vm.prank(operator);
        factory.resumeLaunches();
        vm.deal(creator, 10 ether);
    }

    function _config(address treasury_, DoomRewards rewards_, PositionLocker locker_, MockLiquidityManager manager_)
        internal
        view
        returns (DoomLaunchFactory.FactoryConfig memory)
    {
        return DoomLaunchFactory.FactoryConfig({
            operator: operator,
            emergencyGuardian: guardian,
            approvedCreator: creator,
            treasury: treasury_,
            doomRewards: address(rewards_),
            wrappedNative: address(weth),
            liquidityManager: address(manager_),
            positionLocker: address(locker_),
            maxLaunches: 3,
            maxNativeLiquidityPerLaunch: NATIVE_LIQUIDITY,
            maxNativeLiquidityGlobal: 0.03 ether
        });
    }

    function _deployFactory(
        address treasury_,
        DoomRewards rewards_,
        PositionLocker locker_,
        MockLiquidityManager manager_
    ) internal returns (DoomLaunchFactory deployed) {
        deployed = new DoomLaunchFactory(_config(treasury_, rewards_, locker_, manager_));
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

    function testHappyPathEnforcesEconomicsAndPermanentPosition() external {
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
        assertTrue(locker.isPermanentlyLocked(positionId));

        assertEq(factory.accruedTreasuryFees(), TREASURY_FEE);
        assertEq(rewards.availableRewards(address(weth)), NFT_REWARD_FEE);
        assertEq(weth.balanceOf(address(rewards)), NFT_REWARD_FEE);
        assertEq(manager.nativeReceived(), NATIVE_LIQUIDITY);
        assertEq(factory.totalNativeLiquidity(), NATIVE_LIQUIDITY);
        assertEq(factory.launchCount(), 1);

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
        assertTrue(record.liquidityPermanent);
        assertGt(record.sqrtPriceX96, factory.FULL_RANGE_MIN_SQRT_RATIO());
        assertLt(record.sqrtPriceX96, factory.FULL_RANGE_MAX_SQRT_RATIO());
        assertEq(record.configurationHash, manager.configurationHash());
    }

    function testNewFactoryStartsPaused() external {
        DoomLaunchFactory fresh = _deployFactory(treasury, rewards, locker, manager);
        assertTrue(fresh.launchesPaused());
    }

    function testZeroNftSupplyLeavesFeeRewardsAvailableInVault() external {
        _launch(factory);
        assertEq(rewards.availableRewards(address(weth)), NFT_REWARD_FEE);
        assertEq(rewards.reservedRewards(address(weth)), 0);
    }

    function testFactoryRejectsMismatchedRewardToken() external {
        MockWrappedNative wrongWeth = new MockWrappedNative();
        DoomLaunchFactory.FactoryConfig memory config = _config(treasury, rewards, locker, manager);
        config.wrappedNative = address(wrongWeth);

        vm.expectPartialRevert(DoomLaunchFactory.PositionLockerDependencyMismatch.selector);
        new DoomLaunchFactory(config);
    }

    function testFeeAndRefundAccounting() external {
        uint256 overpayment = 0.004 ether;
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
    }

    function testBoundedV3RemainderGoesToRewardsAndFeeUsesActualNative() external {
        manager.setUsagePpm(999_999, 999_999);
        uint256 beforeBalance = creator.balance;
        vm.txGasPrice(0);

        vm.prank(creator);
        (uint256 id, address tokenAddress,,,) = factory.launch{value: REQUIRED_VALUE}(_params());

        DoomLaunchFactory.LaunchRecord memory record = factory.getLaunch(id);
        uint256 allocated = 400_000_000 ether;
        uint256 expectedTokenUsed = Math.mulDiv(allocated, 999_999, 1_000_000);
        uint256 expectedRemainder = allocated - expectedTokenUsed;
        uint256 expectedNativeUsed = Math.mulDiv(NATIVE_LIQUIDITY, 999_999, 1_000_000);
        uint256 expectedFee = Math.mulDiv(expectedNativeUsed, 300, 10_000);

        assertEq(record.liquidityTokenAmountUsed, expectedTokenUsed);
        assertEq(record.liquidityTokenRemainder, expectedRemainder);
        assertEq(record.nativeLiquidityAmountUsed, expectedNativeUsed);
        assertEq(record.creationFee, expectedFee);
        assertEq(rewards.availableRewards(tokenAddress), expectedRemainder);
        assertEq(creator.balance, beforeBalance - expectedNativeUsed - expectedFee);
    }

    function testV3UtilizationBelowToleranceReverts() external {
        manager.setUsagePpm(999_998, 999_998);
        vm.prank(creator);
        vm.expectPartialRevert(DoomLaunchFactory.LiquidityUtilizationTooLow.selector);
        factory.launch{value: REQUIRED_VALUE}(_params());
        assertEq(factory.nextLaunchId(), 1);
    }

    function testGuardianCanPauseButCannotResume() external {
        vm.prank(guardian);
        factory.pauseLaunches();
        assertTrue(factory.launchesPaused());

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

    function testContractApprovedCreatorIsRejectedAtDeployment() external {
        DoomLaunchFactory.FactoryConfig memory config = _config(treasury, rewards, locker, manager);
        config.approvedCreator = address(this);
        vm.expectRevert(abi.encodeWithSelector(DoomLaunchFactory.ContractCreatorNotAllowed.selector, address(this)));
        new DoomLaunchFactory(config);
    }

    function testLaunchCountCapIsEnforced() external {
        _launch(factory);
        _launch(factory);
        _launch(factory);

        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(DoomLaunchFactory.LaunchLimitReached.selector, 3));
        factory.launch{value: REQUIRED_VALUE}(_params());
    }

    function testCanaryLiquidityMustBeExact() external {
        DoomLaunchFactory.LaunchParams memory p = _params();
        p.nativeLiquidityAmount = NATIVE_LIQUIDITY - 1;
        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(
                DoomLaunchFactory.InvalidCanaryLiquidity.selector, NATIVE_LIQUIDITY, NATIVE_LIQUIDITY - 1
            )
        );
        factory.launch{value: REQUIRED_VALUE}(p);
    }

    function testCreationFeeQuoteIsThreePercent() external view {
        assertEq(factory.quoteCreationFee(NATIVE_LIQUIDITY), CREATION_FEE);
        assertEq(factory.quoteCreationFee(1 ether), 0.03 ether);
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

    function testSupplyBoundsFailClearly() external {
        DoomLaunchFactory.LaunchParams memory p = _params();
        p.totalSupply = factory.MIN_TOTAL_SUPPLY() - 1;
        vm.prank(creator);
        vm.expectPartialRevert(DoomLaunchFactory.SupplyOutsideCanaryBounds.selector);
        factory.launch{value: REQUIRED_VALUE}(p);

        p.totalSupply = factory.MAX_TOTAL_SUPPLY() + 1;
        vm.prank(creator);
        vm.expectPartialRevert(DoomLaunchFactory.SupplyOutsideCanaryBounds.selector);
        factory.launch{value: REQUIRED_VALUE}(p);
    }

    function testSpoofedLockerTermsFailSafely() external {
        MockPool spoofedPool = new MockPool();
        manager.setRecordedPoolOverride(address(spoofedPool));

        vm.prank(creator);
        vm.expectPartialRevert(DoomLaunchFactory.PermanentPositionTermsMismatch.selector);
        factory.launch{value: REQUIRED_VALUE}(_params());

        assertEq(factory.nextLaunchId(), 1);
        assertEq(factory.accruedTreasuryFees(), 0);
    }

    function testReturnedPoolMustContainCode() external {
        manager.setPool(makeAddr("eoaPool"));
        vm.prank(creator);
        vm.expectPartialRevert(PositionLocker.DependencyHasNoCode.selector);
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
        DoomRewards localRewards =
            new DoomRewards(campaignManager, address(nft), address(rejecting), address(weth), 7 days);
        MockPositionManager localNpm = new MockPositionManager();
        PositionLocker localLocker =
            new PositionLocker(address(localNpm), address(weth), address(localRewards), address(rejecting), operator);
        MockLiquidityManager localManager = new MockLiquidityManager(address(localNpm), address(localLocker));
        vm.prank(operator);
        localLocker.bindRegistrar(address(localManager));
        DoomLaunchFactory rejectingFactory = _deployFactory(address(rejecting), localRewards, localLocker, localManager);
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
        manager.setReentry(address(factory), abi.encodeCall(DoomLaunchFactory.launch, (p)));

        vm.prank(creator);
        factory.launch{value: REQUIRED_VALUE}(p);

        assertTrue(manager.reentryAttempted());
        assertFalse(manager.reentrySucceeded());
        assertEq(factory.nextLaunchId(), 2);
    }

    function testFuzzFixedAllocationAccounting(uint128 rawSupply) external {
        uint256 supply = bound(uint256(rawSupply), factory.MIN_TOTAL_SUPPLY(), factory.MAX_TOTAL_SUPPLY());
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
