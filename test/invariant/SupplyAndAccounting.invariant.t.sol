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

        uint256 released = escrow.releasedAmount();
        uint256 held = token.balanceOf(address(escrow));
        uint256 creatorBalance = token.balanceOf(creator);
        uint256 rewardsBalance = token.balanceOf(address(rewards));

        // Conservation: escrowed tokens are only ever held, released to the creator, or forfeited to
        // the reward vault. Staggered release makes partial states reachable, so this must hold at
        // every point in the schedule rather than only at the two end states.
        assertEq(held + creatorBalance + rewardsBalance, ESCROW_AMOUNT);
        assertEq(creatorBalance, released);
        assertLe(released, ESCROW_AMOUNT);

        GmEscrow.Status state = escrow.status();
        if (state == GmEscrow.Status.Active) {
            // Exactly one share per completed check-in, nothing forfeited yet.
            assertEq(held, escrow.remainingAmount());
            assertEq(rewardsBalance, 0);
            assertEq(released, _expectedRelease(escrow.completedCheckIns()));
        } else if (state == GmEscrow.Status.Completed) {
            assertEq(held, 0);
            assertEq(creatorBalance, ESCROW_AMOUNT);
            assertEq(rewards.availableRewards(address(token)), 0);
        } else {
            // A default forfeits only what was still held; honoured check-ins are never clawed back.
            assertEq(held, 0);
            assertEq(rewardsBalance, ESCROW_AMOUNT - released);
            assertEq(rewards.availableRewards(address(token)), ESCROW_AMOUNT - released);
        }
    }

    function _expectedRelease(uint32 checkIns) internal view returns (uint256 total) {
        for (uint32 ordinal = 1; ordinal <= checkIns; ordinal++) {
            total += escrow.releaseFor(ordinal);
        }
    }
}
