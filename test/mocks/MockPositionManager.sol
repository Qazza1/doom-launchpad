// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ICanonicalV3PositionManager} from "../../src/interfaces/ICanonicalV3PositionManager.sol";

contract MockPositionManager is ERC721 {
    struct PositionData {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
    }

    uint256 public nextId = 1;
    mapping(uint256 => PositionData) internal _positionData;

    constructor() ERC721("Mock V3 Position", "MV3P") {}

    function mintConfigured(address to, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper)
        external
        returns (uint256 tokenId)
    {
        tokenId = nextId++;
        _positionData[tokenId] = PositionData({
            token0: token0, token1: token1, fee: fee, tickLower: tickLower, tickUpper: tickUpper, liquidity: 1
        });
        _mint(to, tokenId);
    }

    function positions(uint256 tokenId)
        external
        view
        returns (
            uint96 nonce,
            address operator,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            uint256 feeGrowthInside0LastX128,
            uint256 feeGrowthInside1LastX128,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        )
    {
        require(_ownerOf(tokenId) != address(0), "unknown");
        PositionData memory data = _positionData[tokenId];
        return
            (
                0,
                address(0),
                data.token0,
                data.token1,
                data.fee,
                data.tickLower,
                data.tickUpper,
                data.liquidity,
                0,
                0,
                0,
                0
            );
    }

    function collect(ICanonicalV3PositionManager.CollectParams calldata)
        external
        pure
        returns (uint256 amount0, uint256 amount1)
    {
        return (0, 0);
    }
}
