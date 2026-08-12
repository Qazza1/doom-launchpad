// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Ownerless, fixed-supply launch token with no privileged control path.
contract DoomTokenV2 is ERC20 {
    error ZeroInitialHolder();
    error ZeroSupply();

    uint256 public immutable INITIAL_SUPPLY;

    constructor(string memory name_, string memory symbol_, uint256 totalSupply_, address initialHolder_)
        ERC20(name_, symbol_)
    {
        if (initialHolder_ == address(0)) revert ZeroInitialHolder();
        if (totalSupply_ == 0) revert ZeroSupply();
        INITIAL_SUPPLY = totalSupply_;
        _mint(initialHolder_, totalSupply_);
    }
}
