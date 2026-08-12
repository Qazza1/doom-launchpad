// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IUniswapV3Factory} from "@uniswap/v3-core/interfaces/IUniswapV3Factory.sol";
import {IUniswapV3Pool} from "@uniswap/v3-core/interfaces/IUniswapV3Pool.sol";
import {ICanonicalV3PositionManagerV2} from "./interfaces/ICanonicalV3PositionManagerV2.sol";
import {IDoomLaunchFactoryV2} from "./interfaces/IDoomLaunchFactoryV2.sol";
import {IPositionLockerV2} from "./interfaces/IPositionLockerV2.sol";
import {IWrappedNativeV2} from "./interfaces/IWrappedNativeV2.sol";

/// @notice One-time-bound adapter that graduates registered curves into permanent canonical V3 positions.
contract V3GraduationManagerV2 is IERC721Receiver, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint24 public constant POOL_FEE = 10_000;
    int24 public constant TICK_SPACING = 200;
    int24 public constant FULL_RANGE_TICK_LOWER = -887200;
    int24 public constant FULL_RANGE_TICK_UPPER = 887200;
    uint160 public constant FULL_RANGE_MIN_SQRT_RATIO = 4_310_618_292;
    uint160 public constant FULL_RANGE_MAX_SQRT_RATIO =
        1_456_195_216_270_955_103_206_513_029_158_776_779_468_408_838_535;
    uint256 public constant UTILIZATION_DENOMINATOR = 1_000_000;
    uint256 public constant MINIMUM_UTILIZATION = 999_999;

    error ZeroAddress();
    error DependencyHasNoCode(address dependency);
    error InvalidNetworkConfiguration();
    error UnauthorizedBinder(address caller);
    error FactoryAlreadyBound(address factory);
    error InvalidFactoryBinding(address factory, address configuredManager);
    error UnauthorizedCurve(address caller);
    error InvalidLiquidityParams();
    error InvalidPool(address pool);
    error PoolPriceMismatch(uint160 expected, uint160 actual);
    error ZeroLiquidity();
    error NativeTransferFailed(address recipient, uint256 amount);
    error ResidualBalance(address asset, uint256 amount);
    error UnexpectedNativeSender(address sender);

    uint256 public immutable expectedChainId;
    address public immutable factoryBinder;
    address public immutable uniswapV3Factory;
    ICanonicalV3PositionManagerV2 public immutable positionManagerContract;
    IWrappedNativeV2 public immutable wrappedNative;
    address public immutable positionLocker;
    bytes32 public immutable configurationHash;
    address public authorizedFactory;

    event FactoryBound(address indexed factory, address indexed binder);
    event V3Graduation(
        address indexed curve,
        address indexed token,
        address indexed pool,
        uint256 positionId,
        uint128 liquidity,
        uint256 tokenDesired,
        uint256 tokenUsed,
        uint256 nativeDesired,
        uint256 nativeUsed,
        uint160 sqrtPriceX96,
        address gmEscrow,
        uint256 launchId
    );

    constructor(
        uint256 expectedChainId_,
        address factoryBinder_,
        address uniswapV3Factory_,
        address positionManager_,
        address wrappedNative_,
        address positionLocker_
    ) {
        if (
            expectedChainId_ == 0 || factoryBinder_ == address(0) || uniswapV3Factory_ == address(0)
                || positionManager_ == address(0) || wrappedNative_ == address(0) || positionLocker_ == address(0)
        ) revert ZeroAddress();
        if (uniswapV3Factory_.code.length == 0) revert DependencyHasNoCode(uniswapV3Factory_);
        if (positionManager_.code.length == 0) revert DependencyHasNoCode(positionManager_);
        if (wrappedNative_.code.length == 0) revert DependencyHasNoCode(wrappedNative_);
        if (positionLocker_.code.length == 0) revert DependencyHasNoCode(positionLocker_);
        ICanonicalV3PositionManagerV2 npm = ICanonicalV3PositionManagerV2(positionManager_);
        if (
            npm.factory() != uniswapV3Factory_ || npm.WETH9() != wrappedNative_
                || IUniswapV3Factory(uniswapV3Factory_).feeAmountTickSpacing(POOL_FEE) != TICK_SPACING
                || IPositionLockerV2(positionLocker_).positionManager() != positionManager_
        ) revert InvalidNetworkConfiguration();
        expectedChainId = expectedChainId_;
        factoryBinder = factoryBinder_;
        uniswapV3Factory = uniswapV3Factory_;
        positionManagerContract = npm;
        wrappedNative = IWrappedNativeV2(wrappedNative_);
        positionLocker = positionLocker_;
        configurationHash = keccak256(
            abi.encode(
                expectedChainId_,
                uniswapV3Factory_,
                positionManager_,
                wrappedNative_,
                positionLocker_,
                POOL_FEE,
                TICK_SPACING,
                keccak256("DOOM_BONDING_CURVE_V3_GRADUATION_V2")
            )
        );
    }

    function bindFactory(address factory_) external {
        if (msg.sender != factoryBinder) revert UnauthorizedBinder(msg.sender);
        if (authorizedFactory != address(0)) revert FactoryAlreadyBound(authorizedFactory);
        if (factory_ == address(0) || factory_.code.length == 0) revert DependencyHasNoCode(factory_);
        address configured;
        try IDoomLaunchFactoryV2(factory_).graduationManager() returns (address manager) {
            configured = manager;
        } catch {
            revert InvalidFactoryBinding(factory_, address(0));
        }
        if (configured != address(this)) revert InvalidFactoryBinding(factory_, configured);
        authorizedFactory = factory_;
        emit FactoryBound(factory_, msg.sender);
    }

    function createAndLockPosition(
        uint256 launchId,
        address token,
        address escrow,
        address creator,
        uint256 tokenAmount,
        uint160 sqrtPriceX96
    ) external payable nonReentrant returns (address pool, uint256 positionId, uint256 tokenUsed, uint256 nativeUsed) {
        address factory = authorizedFactory;
        if (factory == address(0) || !IDoomLaunchFactoryV2(factory).isCurve(msg.sender)) {
            revert UnauthorizedCurve(msg.sender);
        }
        if (
            launchId == 0 || token == address(0) || token == address(wrappedNative) || escrow == address(0)
                || creator == address(0) || tokenAmount == 0 || msg.value == 0
                || sqrtPriceX96 <= FULL_RANGE_MIN_SQRT_RATIO || sqrtPriceX96 >= FULL_RANGE_MAX_SQRT_RATIO
        ) revert InvalidLiquidityParams();
        if (token.code.length == 0) revert DependencyHasNoCode(token);
        if (escrow.code.length == 0) revert DependencyHasNoCode(escrow);

        IERC20 launchToken = IERC20(token);
        uint256 tokenBaseline = launchToken.balanceOf(address(this));
        uint256 wrappedBaseline = wrappedNative.balanceOf(address(this));
        uint256 nativeBaseline = address(this).balance - msg.value;
        launchToken.safeTransferFrom(msg.sender, address(this), tokenAmount);
        wrappedNative.deposit{value: msg.value}();
        (address token0, address token1) =
            token < address(wrappedNative) ? (token, address(wrappedNative)) : (address(wrappedNative), token);
        pool = positionManagerContract.createAndInitializePoolIfNecessary(token0, token1, POOL_FEE, sqrtPriceX96);
        if (pool == address(0) || pool.code.length == 0) revert InvalidPool(pool);
        (uint160 actual,,,,,,) = IUniswapV3Pool(pool).slot0();
        if (actual != sqrtPriceX96) revert PoolPriceMismatch(sqrtPriceX96, actual);

        launchToken.forceApprove(address(positionManagerContract), tokenAmount);
        IERC20(address(wrappedNative)).forceApprove(address(positionManagerContract), msg.value);
        uint256 amount0Desired = token0 == token ? tokenAmount : msg.value;
        uint256 amount1Desired = token1 == token ? tokenAmount : msg.value;
        uint128 liquidity;
        uint256 amount0;
        uint256 amount1;
        (positionId, liquidity, amount0, amount1) = positionManagerContract.mint(
            ICanonicalV3PositionManagerV2.MintParams({
                token0: token0,
                token1: token1,
                fee: POOL_FEE,
                tickLower: FULL_RANGE_TICK_LOWER,
                tickUpper: FULL_RANGE_TICK_UPPER,
                amount0Desired: amount0Desired,
                amount1Desired: amount1Desired,
                amount0Min: Math.mulDiv(amount0Desired, MINIMUM_UTILIZATION, UTILIZATION_DENOMINATOR),
                amount1Min: Math.mulDiv(amount1Desired, MINIMUM_UTILIZATION, UTILIZATION_DENOMINATOR),
                recipient: address(this),
                deadline: block.timestamp
            })
        );
        if (liquidity == 0) revert ZeroLiquidity();
        tokenUsed = token0 == token ? amount0 : amount1;
        nativeUsed = token0 == address(wrappedNative) ? amount0 : amount1;
        launchToken.forceApprove(address(positionManagerContract), 0);
        IERC20(address(wrappedNative)).forceApprove(address(positionManagerContract), 0);

        positionManagerContract.safeTransferFrom(address(this), positionLocker, positionId);
        IPositionLockerV2(positionLocker).registerPermanentLock(positionId, pool, launchId, token, escrow, creator);

        uint256 tokenRemainder = tokenAmount - tokenUsed;
        if (tokenRemainder != 0) launchToken.safeTransfer(msg.sender, tokenRemainder);
        uint256 nativeRemainder = msg.value - nativeUsed;
        if (nativeRemainder != 0) {
            wrappedNative.withdraw(nativeRemainder);
            (bool sent,) = payable(msg.sender).call{value: nativeRemainder}("");
            if (!sent) revert NativeTransferFailed(msg.sender, nativeRemainder);
        }
        uint256 tokenBalance = launchToken.balanceOf(address(this));
        if (tokenBalance != tokenBaseline) revert ResidualBalance(token, tokenBalance);
        uint256 wethBalance = wrappedNative.balanceOf(address(this));
        if (wethBalance != wrappedBaseline) {
            revert ResidualBalance(address(wrappedNative), wethBalance);
        }
        if (address(this).balance != nativeBaseline) {
            revert ResidualBalance(address(0), address(this).balance);
        }
        emit V3Graduation(
            msg.sender,
            token,
            pool,
            positionId,
            liquidity,
            tokenAmount,
            tokenUsed,
            msg.value,
            nativeUsed,
            sqrtPriceX96,
            escrow,
            launchId
        );
    }

    function isNetworkConfigurationValid() external view returns (bool) {
        address factory = authorizedFactory;
        if (
            block.chainid != expectedChainId || factory == address(0) || factory.code.length == 0
                || uniswapV3Factory.code.length == 0 || address(positionManagerContract).code.length == 0
                || address(wrappedNative).code.length == 0 || positionLocker.code.length == 0
        ) return false;
        try positionManagerContract.factory() returns (address configured) {
            if (configured != uniswapV3Factory) return false;
        } catch {
            return false;
        }
        try positionManagerContract.WETH9() returns (address configured) {
            if (configured != address(wrappedNative)) return false;
        } catch {
            return false;
        }
        try IUniswapV3Factory(uniswapV3Factory).feeAmountTickSpacing(POOL_FEE) returns (int24 spacing) {
            if (spacing != TICK_SPACING) return false;
        } catch {
            return false;
        }
        try IPositionLockerV2(positionLocker).authorizedRegistrar() returns (address registrar) {
            if (registrar != address(this)) return false;
        } catch {
            return false;
        }
        try IDoomLaunchFactoryV2(factory).graduationManager() returns (address configured) {
            return configured == address(this);
        } catch {
            return false;
        }
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {
        if (msg.sender != address(wrappedNative)) revert UnexpectedNativeSender(msg.sender);
    }
}
