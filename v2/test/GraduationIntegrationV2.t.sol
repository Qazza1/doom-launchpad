// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DoomLaunchFactoryV2} from "../src/DoomLaunchFactoryV2.sol";
import {DoomLaunchDeployerV2} from "../src/DoomLaunchDeployerV2.sol";
import {DoomBondingCurve} from "../src/DoomBondingCurve.sol";
import {GmEscrowV2} from "../src/GmEscrowV2.sol";
import {PositionLockerV2} from "../src/PositionLockerV2.sol";
import {V3GraduationManagerV2} from "../src/V3GraduationManagerV2.sol";
import {MockWrappedNativeV2, MockDoomRewardsV2} from "./mocks/ProtocolMocks.sol";
import {MockCanonicalV3FactoryV2, MockCanonicalPositionManagerV2} from "./mocks/CanonicalV3Mocks.sol";

contract GraduationIntegrationV2Test is Test {
    uint256 internal constant SUPPLY = 1_000_000_000 ether;
    address internal creator = makeAddr("creator");
    address internal buyer = makeAddr("buyer");
    address internal treasury = makeAddr("treasury");
    address internal guardian = makeAddr("guardian");

    MockWrappedNativeV2 internal weth;
    MockDoomRewardsV2 internal rewards;
    MockCanonicalV3FactoryV2 internal v3Factory;
    MockCanonicalPositionManagerV2 internal npm;
    PositionLockerV2 internal locker;
    V3GraduationManagerV2 internal manager;
    DoomLaunchFactoryV2 internal factory;
    DoomLaunchDeployerV2 internal deployer;

    function setUp() public {
        weth = new MockWrappedNativeV2();
        rewards = new MockDoomRewardsV2(address(weth));
        v3Factory = new MockCanonicalV3FactoryV2();
        npm = new MockCanonicalPositionManagerV2(address(v3Factory), address(weth));
        locker = new PositionLockerV2(address(npm), address(weth), address(rewards), treasury, address(this));
        manager = new V3GraduationManagerV2(
            block.chainid, address(this), address(v3Factory), address(npm), address(weth), address(locker)
        );
        locker.bindRegistrar(address(manager));
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
        manager.bindFactory(address(factory));
        factory.resumeLaunches();
        vm.deal(creator, 1 ether);
        vm.deal(buyer, 2 ether);
    }

    function _graduate()
        internal
        returns (DoomBondingCurve curve, IERC20 token, GmEscrowV2 escrow, uint256 positionId)
    {
        vm.prank(creator, creator);
        (, address tokenAddress, address curveAddress, address escrowAddress) = factory.launch{value: 0.001 ether}(
            DoomLaunchFactoryV2.LaunchParams("Doom Dog", "DOOM", SUPPLY, "ipfs://metadata")
        );
        curve = DoomBondingCurve(payable(curveAddress));
        token = IERC20(tokenAddress);
        escrow = GmEscrowV2(escrowAddress);
        vm.prank(buyer);
        curve.buy{value: 1 ether}(0, block.timestamp);
        positionId = curve.positionId();
    }

    function testEndToEndGraduationPermanentlyLocksCanonicalPosition() public {
        (DoomBondingCurve curve, IERC20 token, GmEscrowV2 escrow, uint256 positionId) = _graduate();
        assertTrue(manager.isNetworkConfigurationValid());
        assertTrue(curve.graduated());
        assertEq(curve.pool(), npm.pool());
        assertEq(npm.ownerOf(positionId), address(locker));
        assertTrue(locker.isPermanentlyLocked(positionId));
        assertEq(token.balanceOf(address(npm)), SUPPLY * 10 / 100);
        assertEq(weth.balanceOf(address(npm)), 0.05 ether);
        assertEq(uint8(escrow.status()), uint8(GmEscrowV2.Status.Active));
        assertEq(token.balanceOf(address(escrow)), SUPPLY * 60 / 100);
        assertEq(address(manager).balance, 0);
        assertEq(token.balanceOf(address(manager)), 0);
        assertEq(weth.balanceOf(address(manager)), 0);
    }

    function testPermanentPositionFeesRouteByGmEligibility() public {
        (, IERC20 token, GmEscrowV2 escrow, uint256 positionId) = _graduate();
        uint128 launchFee = uint128(300 ether);
        uint128 wethFee = uint128(0.003 ether);
        _seedFees(token, positionId, launchFee, wethFee);
        uint256 creatorBefore = weth.balanceOf(creator);
        uint256 treasuryBefore = weth.balanceOf(treasury);
        uint256 rewardsWethBefore = weth.balanceOf(address(rewards));
        uint256 rewardsTokenBefore = token.balanceOf(address(rewards));
        locker.collectFees(positionId);
        assertEq(weth.balanceOf(creator) - creatorBefore, uint256(wethFee) * 70 / 100);
        assertEq(weth.balanceOf(treasury) - treasuryBefore, uint256(wethFee) * 15 / 100);
        assertEq(weth.balanceOf(address(rewards)) - rewardsWethBefore, uint256(wethFee) * 15 / 100);
        assertEq(token.balanceOf(address(rewards)) - rewardsTokenBefore, launchFee);

        vm.warp(uint256(escrow.nextDeadline()) + 1);
        _seedFees(token, positionId, launchFee, wethFee);
        creatorBefore = weth.balanceOf(creator);
        rewardsWethBefore = weth.balanceOf(address(rewards));
        locker.collectFees(positionId);
        assertEq(weth.balanceOf(creator), creatorBefore);
        assertEq(weth.balanceOf(address(rewards)) - rewardsWethBefore, uint256(wethFee) * 85 / 100);
    }

    function _seedFees(IERC20 token, uint256 positionId, uint128 launchFee, uint128 wethFee) internal {
        vm.startPrank(buyer);
        token.approve(address(npm), launchFee);
        weth.deposit{value: wethFee}();
        weth.approve(address(npm), wethFee);
        (,, address token0,,,,,,,,,) = npm.positions(positionId);
        if (token0 == address(token)) npm.seedFees(positionId, launchFee, wethFee);
        else npm.seedFees(positionId, wethFee, launchFee);
        vm.stopPrank();
    }
}
