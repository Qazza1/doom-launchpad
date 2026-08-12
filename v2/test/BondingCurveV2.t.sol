// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DoomLaunchFactoryV2} from "../src/DoomLaunchFactoryV2.sol";
import {DoomLaunchDeployerV2} from "../src/DoomLaunchDeployerV2.sol";
import {DoomBondingCurve} from "../src/DoomBondingCurve.sol";
import {GmEscrowV2} from "../src/GmEscrowV2.sol";
import {MockWrappedNativeV2, MockDoomRewardsV2, MockGraduationManagerV2} from "./mocks/ProtocolMocks.sol";

contract BondingCurveV2Test is Test {
    uint256 internal constant SUPPLY = 1_000_000_000 ether;
    address internal creator = makeAddr("creator");
    address internal buyer = makeAddr("buyer");
    address internal treasury = makeAddr("treasury");
    address internal guardian = makeAddr("guardian");
    MockWrappedNativeV2 internal weth;
    MockDoomRewardsV2 internal rewards;
    MockGraduationManagerV2 internal manager;
    DoomLaunchFactoryV2 internal factory;
    DoomLaunchDeployerV2 internal deployer;

    function setUp() public {
        weth = new MockWrappedNativeV2();
        rewards = new MockDoomRewardsV2(address(weth));
        manager = new MockGraduationManagerV2();
        deployer = new DoomLaunchDeployerV2(address(this));
        factory = new DoomLaunchFactoryV2(
            DoomLaunchFactoryV2.FactoryConfig({
                operator: address(this),
                emergencyGuardian: guardian,
                initialApprovedCreator: creator,
                treasury: treasury,
                doomRewards: address(rewards),
                wrappedNative: address(weth),
                graduationManager: address(manager),
                curveDeployer: address(deployer)
            })
        );
        deployer.bindFactory(address(factory));
        factory.resumeLaunches();
        vm.deal(creator, 1 ether);
        vm.deal(buyer, 2 ether);
    }

    function _launch() internal returns (DoomBondingCurve curve, IERC20 token, GmEscrowV2 escrow) {
        vm.prank(creator, creator);
        (, address tokenAddress, address curveAddress, address escrowAddress) = factory.launch{value: 0.001 ether}(
            DoomLaunchFactoryV2.LaunchParams("Doom Dog", "DOOM", SUPPLY, "ipfs://metadata")
        );
        curve = DoomBondingCurve(payable(curveAddress));
        token = IERC20(tokenAddress);
        escrow = GmEscrowV2(escrowAddress);
    }

    function testLaunchFundsCurveAndPendingEscrow() public {
        (DoomBondingCurve curve, IERC20 token, GmEscrowV2 escrow) = _launch();
        assertEq(token.balanceOf(address(curve)), SUPPLY * 40 / 100);
        assertEq(token.balanceOf(address(escrow)), SUPPLY * 60 / 100);
        assertEq(uint8(escrow.status()), uint8(GmEscrowV2.Status.Pending));
        assertEq(factory.accruedTreasuryFees(), 0.0005 ether);
        assertEq(weth.balanceOf(address(rewards)), 0.0005 ether);
        assertTrue(factory.isCurve(address(curve)));
    }

    function testBuyThenSellPreservesAccounting() public {
        (DoomBondingCurve curve, IERC20 token,) = _launch();
        vm.prank(buyer);
        uint256 bought = curve.buy{value: 0.01 ether}(0, block.timestamp);
        assertGt(bought, 0);
        assertEq(token.balanceOf(buyer), bought);
        assertEq(address(curve).balance, curve.accountedNativeBalance());
        vm.startPrank(buyer);
        token.approve(address(curve), bought / 2);
        uint256 returned = curve.sell(bought / 2, 0, block.timestamp);
        vm.stopPrank();
        assertGt(returned, 0);
        assertEq(address(curve).balance, curve.accountedNativeBalance());
    }

    function testFinalBuyRefundsExcessAndGraduates() public {
        (DoomBondingCurve curve, IERC20 token, GmEscrowV2 escrow) = _launch();
        uint256 beforeBalance = buyer.balance;
        vm.prank(buyer);
        uint256 bought = curve.buy{value: 1 ether}(0, block.timestamp);
        assertTrue(curve.graduated());
        assertEq(bought, SUPPLY * 30 / 100);
        assertEq(token.balanceOf(buyer), SUPPLY * 30 / 100);
        assertEq(manager.lastNative(), 0.05 ether);
        assertEq(manager.lastTokens(), SUPPLY * 10 / 100);
        assertEq(uint8(escrow.status()), uint8(GmEscrowV2.Status.Active));
        assertGt(buyer.balance, beforeBalance - 0.051 ether);
        assertEq(address(curve).balance, curve.accountedNativeBalance());
    }

    function testCreatorCurveFeesVestWithGms() public {
        (DoomBondingCurve curve,, GmEscrowV2 escrow) = _launch();
        vm.prank(buyer);
        curve.buy{value: 1 ether}(0, block.timestamp);
        uint256 totalCreatorFees = curve.creatorFeePool();
        assertGt(totalCreatorFees, 0);
        vm.warp(escrow.nextCheckInAt());
        vm.prank(creator, creator);
        escrow.recordGm();
        uint256 expected = totalCreatorFees / 3;
        assertEq(curve.creatorFeesClaimable(), expected);
        uint256 beforeBalance = creator.balance;
        vm.prank(creator, creator);
        uint256 claimed = curve.claimCreatorFees();
        assertEq(claimed, expected);
        assertEq(creator.balance, beforeBalance + expected);
    }

    function testDefaultRedirectsUnvestedCurveFeesAndTokens() public {
        (DoomBondingCurve curve, IERC20 token, GmEscrowV2 escrow) = _launch();
        vm.prank(buyer);
        curve.buy{value: 1 ether}(0, block.timestamp);
        uint256 creatorPool = curve.creatorFeePool();
        vm.warp(uint256(escrow.nextDeadline()) + 1);
        escrow.finalizeDefault();
        assertEq(rewards.failedDeposits(address(token)), SUPPLY * 60 / 100);
        uint256 beforeRewards = weth.balanceOf(address(rewards));
        uint256 forfeited = curve.forfeitDefaultedCreatorFees();
        assertEq(forfeited, creatorPool);
        assertEq(weth.balanceOf(address(rewards)), beforeRewards + creatorPool);
        assertEq(address(curve).balance, curve.accountedNativeBalance());
    }

    function testDeadlineAndSlippageProtections() public {
        (DoomBondingCurve curve,,) = _launch();
        vm.expectRevert(abi.encodeWithSelector(DoomBondingCurve.DeadlineExpired.selector, 0, block.timestamp));
        vm.prank(buyer);
        curve.buy{value: 0.01 ether}(0, block.timestamp - 1);
        (uint256 quoted,,,) = curve.quoteBuy(0.01 ether);
        vm.expectRevert(abi.encodeWithSelector(DoomBondingCurve.SlippageExceeded.selector, type(uint256).max, quoted));
        vm.prank(buyer);
        curve.buy{value: 0.01 ether}(type(uint256).max, block.timestamp);
    }

    function testPauseAllowlistAndExactFee() public {
        vm.prank(guardian);
        factory.pauseLaunches();
        vm.expectRevert(DoomLaunchFactoryV2.LaunchesArePaused.selector);
        vm.prank(creator, creator);
        factory.launch{value: 0.001 ether}(
            DoomLaunchFactoryV2.LaunchParams("Doom Dog", "DOOM", SUPPLY, "ipfs://metadata")
        );
        factory.resumeLaunches();
        vm.expectRevert(abi.encodeWithSelector(DoomLaunchFactoryV2.InvalidLaunchFee.selector, 0.001 ether, 0.002 ether));
        vm.prank(creator, creator);
        factory.launch{value: 0.002 ether}(
            DoomLaunchFactoryV2.LaunchParams("Doom Dog", "DOOM", SUPPLY, "ipfs://metadata")
        );
    }

    function testFactoryStartsPausedUntilDependenciesAreBound() public {
        DoomLaunchDeployerV2 unboundDeployer = new DoomLaunchDeployerV2(address(this));
        DoomLaunchFactoryV2 unboundFactory = new DoomLaunchFactoryV2(
            DoomLaunchFactoryV2.FactoryConfig({
                operator: address(this),
                emergencyGuardian: guardian,
                initialApprovedCreator: creator,
                treasury: treasury,
                doomRewards: address(rewards),
                wrappedNative: address(weth),
                graduationManager: address(manager),
                curveDeployer: address(unboundDeployer)
            })
        );
        assertTrue(unboundFactory.launchesPaused());
        assertFalse(unboundFactory.isLaunchConfigurationValid());
    }

    function testFuzzQuoteBuyNeverPassesThirtyPercent(uint96 gross) public {
        (DoomBondingCurve curve,,) = _launch();
        uint256 value = bound(uint256(gross), 1, 2 ether);
        (uint256 tokenOut, uint256 used,, uint256 refund) = curve.quoteBuy(value);
        assertLe(tokenOut, SUPPLY * 30 / 100);
        assertLe(used, value);
        assertEq(used + refund, value);
    }
}
