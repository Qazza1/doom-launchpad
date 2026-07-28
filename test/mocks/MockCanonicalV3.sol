// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ICanonicalV3PositionManager} from "../../src/interfaces/ICanonicalV3PositionManager.sol";
import {ILiquidityManager} from "../../src/interfaces/ILiquidityManager.sol";

contract MockCanonicalV3Factory {
    mapping(uint24 fee => int24 spacing) public feeAmountTickSpacing;

    constructor() {
        feeAmountTickSpacing[10_000] = 200;
    }
}

contract MockCanonicalV3Pool {
    uint160 public sqrtPriceX96;

    function initialize(uint160 sqrtPriceX96_) external {
        require(sqrtPriceX96 == 0, "already initialized");
        sqrtPriceX96 = sqrtPriceX96_;
    }

    function slot0()
        external
        view
        returns (
            uint160,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        )
    {
        return (sqrtPriceX96, 0, 0, 0, 0, 0, true);
    }
}

contract MockCanonicalPositionManager is ERC721 {
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
    address public immutable pool;
    uint32 public usePpm = 1_000_000;
    uint256 public nextId = 1;
    uint160 public initializedPrice;
    mapping(uint256 => PositionData) internal _positionData;

    constructor(address factory_, address weth_) ERC721("Mock V3 Positions", "MV3") {
        factory = factory_;
        WETH9 = weth_;
        pool = address(new MockCanonicalV3Pool());
    }

    function setUsePpm(uint32 value) external {
        usePpm = value;
    }

    function preInitializePool(uint160 sqrtPriceX96) external {
        MockCanonicalV3Pool(pool).initialize(sqrtPriceX96);
        initializedPrice = sqrtPriceX96;
    }

    function mintTestPosition(
        address recipient,
        address token0,
        address token1,
        uint24 fee,
        int24 tickLower,
        int24 tickUpper
    ) external returns (uint256 tokenId) {
        tokenId = nextId++;
        _positionData[tokenId] = PositionData({
            token0: token0,
            token1: token1,
            fee: fee,
            tickLower: tickLower,
            tickUpper: tickUpper,
            liquidity: 1,
            tokensOwed0: 0,
            tokensOwed1: 0
        });
        _mint(recipient, tokenId);
    }

    function createAndInitializePoolIfNecessary(address, address, uint24, uint160 sqrtPriceX96)
        external
        returns (address)
    {
        MockCanonicalV3Pool target = MockCanonicalV3Pool(pool);
        if (target.sqrtPriceX96() == 0) target.initialize(sqrtPriceX96);
        initializedPrice = target.sqrtPriceX96();
        return pool;
    }

    function mint(ICanonicalV3PositionManager.MintParams calldata params)
        external
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        amount0 = Math.mulDiv(params.amount0Desired, usePpm, 1_000_000);
        amount1 = Math.mulDiv(params.amount1Desired, usePpm, 1_000_000);
        require(amount0 >= params.amount0Min && amount1 >= params.amount1Min, "minimum");
        IERC20(params.token0).safeTransferFrom(msg.sender, address(this), amount0);
        IERC20(params.token1).safeTransferFrom(msg.sender, address(this), amount1);

        tokenId = nextId++;
        uint256 smaller = amount0 < amount1 ? amount0 : amount1;
        liquidity = uint128(smaller > type(uint128).max ? type(uint128).max : smaller);
        _positionData[tokenId] = PositionData({
            token0: params.token0,
            token1: params.token1,
            fee: params.fee,
            tickLower: params.tickLower,
            tickUpper: params.tickUpper,
            liquidity: liquidity,
            tokensOwed0: 0,
            tokensOwed1: 0
        });
        _safeMint(params.recipient, tokenId);
    }

    function seedFees(uint256 tokenId, uint128 amount0, uint128 amount1) external {
        PositionData storage data = _positionData[tokenId];
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

    function collect(ICanonicalV3PositionManager.CollectParams calldata params)
        external
        returns (uint256 amount0, uint256 amount1)
    {
        address owner = ownerOf(params.tokenId);
        require(
            msg.sender == owner || getApproved(params.tokenId) == msg.sender || isApprovedForAll(owner, msg.sender),
            "unauthorized"
        );
        PositionData storage data = _positionData[params.tokenId];
        amount0 = params.amount0Max < data.tokensOwed0 ? params.amount0Max : data.tokensOwed0;
        amount1 = params.amount1Max < data.tokensOwed1 ? params.amount1Max : data.tokensOwed1;
        data.tokensOwed0 -= uint128(amount0);
        data.tokensOwed1 -= uint128(amount1);
        if (amount0 != 0) IERC20(data.token0).safeTransfer(params.recipient, amount0);
        if (amount1 != 0) IERC20(data.token1).safeTransfer(params.recipient, amount1);
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
