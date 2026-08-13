// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DoomTokenV2} from "../../src/DoomTokenV2.sol";
import {DoomBondingCurve} from "../../src/DoomBondingCurve.sol";
import {GmEscrowV2} from "../../src/GmEscrowV2.sol";
import {MockWrappedNativeV2, MockDoomRewardsV2, MockGraduationManagerV2} from "../mocks/ProtocolMocks.sol";

contract CurveTradingHandler {
    DoomBondingCurve public immutable curve;
    IERC20 public immutable token;

    constructor(DoomBondingCurve curve_, IERC20 token_) {
        curve = curve_;
        token = token_;
    }

    receive() external payable {}

    function buy(uint96 seed) external {
        if (curve.graduated() || address(this).balance == 0) return;
        uint256 value = uint256(seed) % 0.005 ether + 1;
        if (value > address(this).balance) value = address(this).balance;
        try curve.buy{value: value}(0, block.timestamp) {} catch {}
    }

    function sell(uint96 seed) external {
        if (curve.graduated()) return;
        uint256 balance = token.balanceOf(address(this));
        if (balance == 0) return;
        uint256 amount = uint256(seed) % balance + 1;
        token.approve(address(curve), amount);
        try curve.sell(amount, 0, block.timestamp) {} catch {}
    }
}

contract CurveAccountingInvariantTest is Test {
    uint256 internal constant SUPPLY = 1_000_000_000 ether;
    DoomTokenV2 internal token;
    DoomBondingCurve internal curve;
    GmEscrowV2 internal escrow;
    MockWrappedNativeV2 internal weth;
    MockDoomRewardsV2 internal rewards;
    MockGraduationManagerV2 internal manager;
    CurveTradingHandler internal handler;

    function setUp() public {
        weth = new MockWrappedNativeV2();
        rewards = new MockDoomRewardsV2(address(weth));
        manager = new MockGraduationManagerV2();
        token = new DoomTokenV2("Invariant", "INV", SUPPLY, address(this));
        curve = new DoomBondingCurve(
            1,
            address(token),
            address(0xC0FFEE),
            address(0xBEEF),
            address(rewards),
            address(weth),
            address(manager),
            SUPPLY
        );
        escrow = curve.escrow();
        token.bindLaunch(address(curve), address(escrow), address(manager));
        assertTrue(token.transfer(address(escrow), SUPPLY * 60 / 100));
        assertTrue(token.transfer(address(curve), SUPPLY * 40 / 100));
        handler = new CurveTradingHandler(curve, token);
        vm.deal(address(handler), 10 ether);
        targetContract(address(handler));
    }

    function invariantNativeCustodyAlwaysReconciles() public view {
        assertEq(address(curve).balance, curve.accountedNativeBalance());
        assertLe(curve.realNativeReserve(), curve.GRADUATION_TARGET());
    }

    function invariantCurveCannotDistributeMoreThanThirtyPercent() public view {
        assertLe(curve.tokensSold(), SUPPLY * 30 / 100);
        assertGe(curve.virtualTokenReserve(), curve.virtualTokenFloor());
        assertLe(curve.virtualTokenReserve(), curve.virtualTokenStart());
    }

    function invariantTokenSupplyRemainsFullyAccounted() public view {
        uint256 knownBalances = token.balanceOf(address(curve)) + token.balanceOf(address(escrow))
            + token.balanceOf(address(handler)) + token.balanceOf(address(manager)) + token.balanceOf(address(rewards));
        assertEq(knownBalances, SUPPLY);
    }

    function invariantEscrowActivatesOnlyAtGraduation() public view {
        if (curve.graduated()) assertEq(uint8(escrow.status()), uint8(GmEscrowV2.Status.Active));
        else assertEq(uint8(escrow.status()), uint8(GmEscrowV2.Status.Pending));
    }
}
