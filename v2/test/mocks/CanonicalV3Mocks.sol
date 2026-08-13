// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ICanonicalV3PositionManagerV2} from "../../src/interfaces/ICanonicalV3PositionManagerV2.sol";

contract MockCanonicalV3FactoryV2 {
    mapping(uint24 fee => int24 spacing) public feeAmountTickSpacing;
    mapping(bytes32 key => address pool) private _pools;

    constructor() {
        feeAmountTickSpacing[10_000] = 200;
    }

    function createPool(address tokenA, address tokenB, uint24 fee) external returns (address pool) {
        require(tokenA != tokenB && tokenA != address(0) && tokenB != address(0), "tokens");
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        bytes32 key = keccak256(abi.encode(token0, token1, fee));
        require(_pools[key] == address(0), "exists");
        pool = address(new MockCanonicalV3PoolV2());
        _pools[key] = pool;
    }

    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return _pools[keccak256(abi.encode(token0, token1, fee))];
    }
}

contract MockCanonicalV3PoolV2 {
    uint160 public sqrtPriceX96;

    function initialize(uint160 value) external {
        require(sqrtPriceX96 == 0, "initialized");
        sqrtPriceX96 = value;
    }

    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint8, bool) {
        return (sqrtPriceX96, 0, 0, 0, 0, 0, true);
    }
}

contract MockCanonicalPositionManagerV2 is ERC721 {
    using SafeERC20 for IERC20;

    struct PositionData {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint128 tokensOwed0;
        uint128 tokensOwed1;
    }

    address public immutable factory;
    address public immutable WETH9;
    address public pool;
    uint32 public usePpm = 1_000_000;
    uint256 public nextId = 1;
    mapping(uint256 => PositionData) private _positions;

    constructor(address factory_, address weth_) ERC721("Mock V3 Positions", "MV3") {
        factory = factory_;
        WETH9 = weth_;
    }

    function setUsePpm(uint32 value) external {
        usePpm = value;
    }

    function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96)
        external
        returns (address targetPool)
    {
        MockCanonicalV3FactoryV2 v3Factory = MockCanonicalV3FactoryV2(factory);
        targetPool = v3Factory.getPool(token0, token1, fee);
        if (targetPool == address(0)) targetPool = v3Factory.createPool(token0, token1, fee);
        MockCanonicalV3PoolV2 target = MockCanonicalV3PoolV2(targetPool);
        if (target.sqrtPriceX96() == 0) target.initialize(sqrtPriceX96);
        pool = targetPool;
    }

    function mint(ICanonicalV3PositionManagerV2.MintParams calldata params)
        external
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        address targetPool = MockCanonicalV3FactoryV2(factory).getPool(params.token0, params.token1, params.fee);
        require(targetPool != address(0), "pool");
        amount0 = Math.mulDiv(params.amount0Desired, usePpm, 1_000_000);
        amount1 = Math.mulDiv(params.amount1Desired, usePpm, 1_000_000);
        require(amount0 >= params.amount0Min && amount1 >= params.amount1Min, "minimum");
        IERC20(params.token0).safeTransferFrom(msg.sender, targetPool, amount0);
        IERC20(params.token1).safeTransferFrom(msg.sender, targetPool, amount1);
        tokenId = nextId++;
        uint256 smaller = amount0 < amount1 ? amount0 : amount1;
        liquidity = uint128(smaller > type(uint128).max ? type(uint128).max : smaller);
        _positions[tokenId] =
            PositionData(params.token0, params.token1, params.fee, params.tickLower, params.tickUpper, liquidity, 0, 0);
        _safeMint(params.recipient, tokenId);
    }

    function seedFees(uint256 tokenId, uint128 amount0, uint128 amount1) external {
        PositionData storage data = _positions[tokenId];
        require(data.token0 != address(0), "unknown");
        if (amount0 != 0) IERC20(data.token0).safeTransferFrom(msg.sender, address(this), amount0);
        if (amount1 != 0) IERC20(data.token1).safeTransferFrom(msg.sender, address(this), amount1);
        data.tokensOwed0 += amount0;
        data.tokensOwed1 += amount1;
    }

    function positions(uint256 tokenId)
        external
        view
        returns (
            uint96,
            address,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            uint256,
            uint256,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        )
    {
        require(_ownerOf(tokenId) != address(0), "unknown");
        PositionData memory data = _positions[tokenId];
        return (
            0,
            getApproved(tokenId),
            data.token0,
            data.token1,
            data.fee,
            data.tickLower,
            data.tickUpper,
            data.liquidity,
            0,
            0,
            data.tokensOwed0,
            data.tokensOwed1
        );
    }

    function collect(ICanonicalV3PositionManagerV2.CollectParams calldata params)
        external
        returns (uint256 amount0, uint256 amount1)
    {
        address owner = ownerOf(params.tokenId);
        require(
            msg.sender == owner || getApproved(params.tokenId) == msg.sender || isApprovedForAll(owner, msg.sender),
            "unauthorized"
        );
        PositionData storage data = _positions[params.tokenId];
        amount0 = params.amount0Max < data.tokensOwed0 ? params.amount0Max : data.tokensOwed0;
        amount1 = params.amount1Max < data.tokensOwed1 ? params.amount1Max : data.tokensOwed1;
        // Both values are bounded by their uint128 stored balances above.
        // forge-lint: disable-next-line(unsafe-typecast)
        data.tokensOwed0 -= uint128(amount0);
        // forge-lint: disable-next-line(unsafe-typecast)
        data.tokensOwed1 -= uint128(amount1);
        if (amount0 != 0) IERC20(data.token0).safeTransfer(params.recipient, amount0);
        if (amount1 != 0) IERC20(data.token1).safeTransfer(params.recipient, amount1);
    }
}
