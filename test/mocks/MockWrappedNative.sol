// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockWrappedNative is ERC20 {
    constructor() ERC20("Wrapped Native", "WNATIVE") {}

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        (bool success,) = payable(msg.sender).call{value: amount}("");
        require(success, "native transfer failed");
    }

    receive() external payable {
        _mint(msg.sender, msg.value);
    }
}

contract MockNftCollection {}
