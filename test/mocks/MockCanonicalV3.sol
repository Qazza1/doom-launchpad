// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ICanonicalV3PositionManager} from "../../src/interfaces/ICanonicalV3PositionManager.sol";
import {ILiquidityManager} from "../../src/interfaces/ILiquidityManager.sol";

contract MockCanonicalV3Factory {
    mapping(uint24 fee => int24 spacing) public feeAmountTickSpacing;

    constructor() {
        feeAmountTickSpacing[3_000] = 60;
    }
}

contract MockCanonicalV3Pool {}

contract MockCanonicalPositionManager is ERC721 {
    using SafeERC20 for IERC20;

    address public immutable factory;
    address public immutable WETH9;
    address public immutable pool;
    uint32 public usePpm = 1_000_000;
    uint256 public nextId = 1;
    uint160 public initializedPrice;

    constructor(address factory_, address weth_) ERC721("Mock V3 Positions", "MV3") {
        factory = factory_;
        WETH9 = weth_;
        pool = address(new MockCanonicalV3Pool());
    }

    function setUsePpm(uint32 value) external {
        usePpm = value;
    }

    function createAndInitializePoolIfNecessary(address, address, uint24, uint160 sqrtPriceX96)
        external
        returns (address)
    {
        initializedPrice = sqrtPriceX96;
        return pool;
    }

    function mint(ICanonicalV3PositionManager.MintParams calldata params)
        external
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        amount0 = params.amount0Desired * usePpm / 1_000_000;
        amount1 = params.amount1Desired * usePpm / 1_000_000;
        require(amount0 >= params.amount0Min && amount1 >= params.amount1Min, "minimum");
        IERC20(params.token0).safeTransferFrom(msg.sender, address(this), amount0);
        IERC20(params.token1).safeTransferFrom(msg.sender, address(this), amount1);

        tokenId = nextId++;
        uint256 smaller = amount0 < amount1 ? amount0 : amount1;
        liquidity = uint128(smaller > type(uint128).max ? type(uint128).max : smaller);
        _safeMint(params.recipient, tokenId);
    }
}

contract MockBindingFactory {
    using SafeERC20 for IERC20;

    address public immutable liquidityManager;

    constructor(address liquidityManager_) {
        liquidityManager = liquidityManager_;
    }

    function provide(ILiquidityManager.CreateLiquidityParams calldata params)
        external
        payable
        returns (address pool, uint256 positionId, uint256 tokenUsed, uint256 nativeUsed)
    {
        IERC20(params.token).forceApprove(liquidityManager, params.tokenAmount);
        (pool, positionId, tokenUsed, nativeUsed) =
            ILiquidityManager(liquidityManager).createAndLockLiquidity{value: msg.value}(params);
        IERC20(params.token).forceApprove(liquidityManager, 0);
    }

    receive() external payable {}
}
