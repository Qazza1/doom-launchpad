// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract RejectingTreasury {
    receive() external payable {
        revert("reject native");
    }
}
