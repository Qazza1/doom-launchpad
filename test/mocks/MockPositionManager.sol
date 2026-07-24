// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract MockPositionManager is ERC721 {
    uint256 public nextId = 1;

    constructor() ERC721("Mock V3 Position", "MV3P") {}

    function mint(address to) external returns (uint256 tokenId) {
        tokenId = nextId++;
        _mint(to, tokenId);
    }
}
