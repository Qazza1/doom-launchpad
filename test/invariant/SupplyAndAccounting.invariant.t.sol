// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";
import {DoomToken} from "../../src/DoomToken.sol";
import {DoomRewards} from "../../src/DoomRewards.sol";
import {GmEscrow} from "../../src/GmEscrow.sol";
import {GmAccountingHandler} from "./GmAccountingHandler.sol";
import {MockWrappedNative, MockNftCollection} from "../mocks/MockWrappedNative.sol";

contract SupplyAndAccountingInvariantTest is StdInvariant, Test {
    DoomToken internal token;
    DoomRewards internal rewards;
    GmEscrow internal escrow;
    GmAccountingHandler internal handler;

    address internal creator = makeAddr("creator");
    uint256 internal constant TOTAL_SUPPLY = 1_000_000 ether;
    uint256 internal constant ESCROW_AMOUNT = 200_000 ether;

    function setUp() external {
        token = new DoomToken("Doom", "DOOM", TOTAL_SUPPLY, address(this));
        MockWrappedNative weth = new MockWrappedNative();
        MockNftCollection nft = new MockNftCollection();
        rewards = new DoomRewards(makeAddr("manager"), address(nft), makeAddr("communityVault"), address(weth), 7 days);
        escrow = new GmEscrow(1, address(token), creator, address(rewards), ESCROW_AMOUNT, 3, 1 days, 4 hours);
        token.transfer(address(escrow), ESCROW_AMOUNT);

        handler = new GmAccountingHandler(escrow, creator);
        targetContract(address(handler));
    }

    function invariantTotalSupplyRemainsFixed() external view {
        assertEq(token.totalSupply(), TOTAL_SUPPLY);
        assertEq(token.INITIAL_SUPPLY(), TOTAL_SUPPLY);
    }

    function invariantEscrowAndRewardsReconcile() external view {
        assertLe(escrow.completedCheckIns(), escrow.requiredCheckIns());
        assertEq(
            token.balanceOf(address(rewards)),
            rewards.availableRewards(address(token)) + rewards.reservedRewards(address(token))
        );

        GmEscrow.Status state = escrow.status();
        if (state == GmEscrow.Status.Active) {
            assertEq(token.balanceOf(address(escrow)), ESCROW_AMOUNT);
            assertEq(token.balanceOf(creator), 0);
            assertEq(rewards.availableRewards(address(token)), 0);
        } else if (state == GmEscrow.Status.Completed) {
            assertEq(token.balanceOf(address(escrow)), 0);
            assertEq(token.balanceOf(creator), ESCROW_AMOUNT);
            assertEq(rewards.availableRewards(address(token)), 0);
        } else {
            assertEq(token.balanceOf(address(escrow)), 0);
            assertEq(token.balanceOf(creator), 0);
            assertEq(token.balanceOf(address(rewards)), ESCROW_AMOUNT);
            assertEq(rewards.availableRewards(address(token)), ESCROW_AMOUNT);
        }
    }
}
