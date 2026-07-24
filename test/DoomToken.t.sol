// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DoomToken} from "../src/DoomToken.sol";

contract DoomTokenTest is Test {
    function testFixedSupplyAndNoOwnerControls() external {
        address holder = makeAddr("holder");
        DoomToken token = new DoomToken("Doom", "DOOM", 1_000_000 ether, holder);

        assertEq(token.totalSupply(), 1_000_000 ether);
        assertEq(token.INITIAL_SUPPLY(), 1_000_000 ether);
        assertEq(token.balanceOf(holder), 1_000_000 ether);

        (bool mintExists,) = address(token).call(abi.encodeWithSignature("mint(address,uint256)", holder, 1));
        (bool ownerExists,) = address(token).call(abi.encodeWithSignature("owner()"));
        assertFalse(mintExists);
        assertFalse(ownerExists);
    }

    function testRevertZeroSupply() external {
        vm.expectRevert(DoomToken.ZeroSupply.selector);
        new DoomToken("Doom", "DOOM", 0, address(this));
    }

    function testTransfersAreUntaxedAndExact() external {
        address holder = makeAddr("holder");
        address recipient = makeAddr("recipient");
        DoomToken token = new DoomToken("Doom", "DOOM", 1_000 ether, holder);

        vm.prank(holder);
        token.transfer(recipient, 250 ether);

        assertEq(token.balanceOf(holder), 750 ether);
        assertEq(token.balanceOf(recipient), 250 ether);
        assertEq(token.totalSupply(), 1_000 ether);
    }
}
