// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IUniswapV3Factory} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import {ICanonicalV3PositionManager} from "./interfaces/ICanonicalV3PositionManager.sol";
import {ILiquidityManager} from "./interfaces/ILiquidityManager.sol";
import {IPositionLocker} from "./interfaces/IPositionLocker.sol";
import {IWrappedNative} from "./interfaces/IWrappedNative.sol";

interface ILaunchFactoryBinding {
    function liquidityManager() external view returns (address);
}

/// @title V3LiquidityManager
/// @notice One-time-bound adapter for canonical Uniswap V3 full-range liquidity on Robinhood Chain.
contract V3LiquidityManager is ILiquidityManager, IERC721Receiver, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint24 public constant POOL_FEE = 3_000;
    int24 public constant TICK_SPACING = 60;
    int24 public constant FULL_RANGE_TICK_LOWER = -887220;
    int24 public constant FULL_RANGE_TICK_UPPER = 887220;
    uint256 public constant UTILIZATION_DENOMINATOR = 1_000_000;
    uint256 public constant MINIMUM_UTILIZATION = 999_999;

    error ZeroAddress();
    error DependencyHasNoCode(address dependency);
    error InvalidNetworkConfiguration();
    error UnauthorizedBinder(address caller);
    error FactoryAlreadyBound(address factory);
    error InvalidFactoryBinding(address factory, address configuredManager);
    error UnauthorizedFactory(address caller);
    error InvalidNativeValue(uint256 expected, uint256 supplied);
    error InvalidLiquidityParams();
    error InvalidPool(address pool);
    error ZeroLiquidity();
    error NativeTransferFailed(address recipient, uint256 amount);
    error ResidualBalance(address asset, uint256 amount);
    error UnexpectedNativeSender(address sender);

    uint256 public immutable expectedChainId;
    address public immutable factoryBinder;
    address public immutable uniswapV3Factory;
    ICanonicalV3PositionManager public immutable nonfungiblePositionManager;
    IWrappedNative public immutable wrappedNative;
    address public immutable override positionLocker;
    bytes32 public immutable override configurationHash;

    address public authorizedFactory;

    event FactoryBound(address indexed factory, address indexed binder);
    event V3LiquidityCreated(
        address indexed factory,
        address indexed token,
        address indexed pool,
        uint256 positionId,
        uint128 liquidity,
        uint256 tokenDesired,
        uint256 tokenUsed,
        uint256 nativeDesired,
        uint256 nativeUsed,
        uint160 sqrtPriceX96,
        uint64 unlockTime
    );

    constructor(
        uint256 expectedChainId_,
        address factoryBinder_,
        address uniswapV3Factory_,
        address nonfungiblePositionManager_,
        address wrappedNative_,
        address positionLocker_
    ) {
        if (
            expectedChainId_ == 0 || factoryBinder_ == address(0) || uniswapV3Factory_ == address(0)
                || nonfungiblePositionManager_ == address(0) || wrappedNative_ == address(0)
                || positionLocker_ == address(0)
        ) revert ZeroAddress();
        if (uniswapV3Factory_.code.length == 0) revert DependencyHasNoCode(uniswapV3Factory_);
        if (nonfungiblePositionManager_.code.length == 0) {
            revert DependencyHasNoCode(nonfungiblePositionManager_);
        }
        if (wrappedNative_.code.length == 0) revert DependencyHasNoCode(wrappedNative_);
        if (positionLocker_.code.length == 0) revert DependencyHasNoCode(positionLocker_);

        ICanonicalV3PositionManager npm = ICanonicalV3PositionManager(nonfungiblePositionManager_);
        if (
            npm.factory() != uniswapV3Factory_ || npm.WETH9() != wrappedNative_
                || IUniswapV3Factory(uniswapV3Factory_).feeAmountTickSpacing(POOL_FEE) != TICK_SPACING
                || IPositionLocker(positionLocker_).positionManager() != nonfungiblePositionManager_
        ) revert InvalidNetworkConfiguration();

        expectedChainId = expectedChainId_;
        factoryBinder = factoryBinder_;
        uniswapV3Factory = uniswapV3Factory_;
        nonfungiblePositionManager = npm;
        wrappedNative = IWrappedNative(wrappedNative_);
        positionLocker = positionLocker_;
        configurationHash = keccak256(
            abi.encode(
                expectedChainId_,
                uniswapV3Factory_,
                nonfungiblePositionManager_,
                wrappedNative_,
                positionLocker_,
                POOL_FEE,
                TICK_SPACING,
                bytes32("UNISWAP_V3_CORE_PERIPHERY_V1.0.0")
            )
        );
    }

    /// @notice Irreversibly binds this adapter to the factory that was configured with it.
    function bindFactory(address factory_) external {
        if (msg.sender != factoryBinder) revert UnauthorizedBinder(msg.sender);
        if (authorizedFactory != address(0)) revert FactoryAlreadyBound(authorizedFactory);
        if (factory_ == address(0) || factory_.code.length == 0) revert DependencyHasNoCode(factory_);

        address configuredManager;
        try ILaunchFactoryBinding(factory_).liquidityManager() returns (address manager) {
            configuredManager = manager;
        } catch {
            revert InvalidFactoryBinding(factory_, address(0));
        }
        if (configuredManager != address(this)) {
            revert InvalidFactoryBinding(factory_, configuredManager);
        }

        authorizedFactory = factory_;
        emit FactoryBound(factory_, msg.sender);
    }

    function createAndLockLiquidity(CreateLiquidityParams calldata params)
        external
        payable
        override
        nonReentrant
        returns (address pool, uint256 positionId, uint256 tokenUsed, uint256 nativeUsed)
    {
        if (msg.sender != authorizedFactory) revert UnauthorizedFactory(msg.sender);
        if (msg.value != params.nativeAmount) revert InvalidNativeValue(params.nativeAmount, msg.value);
        if (
            params.token == address(0) || params.token == address(wrappedNative) || params.tokenAmount == 0
                || params.nativeAmount == 0 || params.creator == address(0) || params.lpBeneficiary == address(0)
                || params.fee != POOL_FEE || params.tickLower != FULL_RANGE_TICK_LOWER
                || params.tickUpper != FULL_RANGE_TICK_UPPER || params.sqrtPriceX96 == 0
                || params.unlockTime <= block.timestamp
        ) revert InvalidLiquidityParams();

        IERC20 launchToken = IERC20(params.token);
        launchToken.safeTransferFrom(msg.sender, address(this), params.tokenAmount);
        wrappedNative.deposit{value: params.nativeAmount}();

        (address token0, address token1) = params.token < address(wrappedNative)
            ? (params.token, address(wrappedNative))
            : (address(wrappedNative), params.token);
        pool = nonfungiblePositionManager.createAndInitializePoolIfNecessary(
            token0, token1, POOL_FEE, params.sqrtPriceX96
        );
        if (pool == address(0) || pool.code.length == 0) revert InvalidPool(pool);

        launchToken.forceApprove(address(nonfungiblePositionManager), params.tokenAmount);
        IERC20(address(wrappedNative)).forceApprove(address(nonfungiblePositionManager), params.nativeAmount);

        uint256 amount0Desired = token0 == params.token ? params.tokenAmount : params.nativeAmount;
        uint256 amount1Desired = token1 == params.token ? params.tokenAmount : params.nativeAmount;
        uint256 amount0Min = amount0Desired * MINIMUM_UTILIZATION / UTILIZATION_DENOMINATOR;
        uint256 amount1Min = amount1Desired * MINIMUM_UTILIZATION / UTILIZATION_DENOMINATOR;

        uint128 liquidity;
        uint256 amount0;
        uint256 amount1;
        (positionId, liquidity, amount0, amount1) = nonfungiblePositionManager.mint(
            ICanonicalV3PositionManager.MintParams({
                token0: token0,
                token1: token1,
                fee: POOL_FEE,
                tickLower: FULL_RANGE_TICK_LOWER,
                tickUpper: FULL_RANGE_TICK_UPPER,
                amount0Desired: amount0Desired,
                amount1Desired: amount1Desired,
                amount0Min: amount0Min,
                amount1Min: amount1Min,
                recipient: address(this),
                deadline: block.timestamp
            })
        );
        if (liquidity == 0) revert ZeroLiquidity();

        tokenUsed = token0 == params.token ? amount0 : amount1;
        nativeUsed = token0 == address(wrappedNative) ? amount0 : amount1;

        launchToken.forceApprove(address(nonfungiblePositionManager), 0);
        IERC20(address(wrappedNative)).forceApprove(address(nonfungiblePositionManager), 0);

        nonfungiblePositionManager.safeTransferFrom(address(this), positionLocker, positionId);
        IPositionLocker(positionLocker).registerLock(positionId, pool, params.lpBeneficiary, params.unlockTime);

        uint256 tokenRemainder = params.tokenAmount - tokenUsed;
        if (tokenRemainder != 0) launchToken.safeTransfer(msg.sender, tokenRemainder);

        uint256 nativeRemainder = params.nativeAmount - nativeUsed;
        if (nativeRemainder != 0) {
            wrappedNative.withdraw(nativeRemainder);
            (bool success,) = payable(msg.sender).call{value: nativeRemainder}("");
            if (!success) revert NativeTransferFailed(msg.sender, nativeRemainder);
        }

        uint256 tokenBalance = launchToken.balanceOf(address(this));
        if (tokenBalance != 0) revert ResidualBalance(params.token, tokenBalance);
        uint256 wrappedBalance = wrappedNative.balanceOf(address(this));
        if (wrappedBalance != 0) revert ResidualBalance(address(wrappedNative), wrappedBalance);
        if (address(this).balance != 0) revert ResidualBalance(address(0), address(this).balance);

        emit V3LiquidityCreated(
            msg.sender,
            params.token,
            pool,
            positionId,
            liquidity,
            params.tokenAmount,
            tokenUsed,
            params.nativeAmount,
            nativeUsed,
            params.sqrtPriceX96,
            params.unlockTime
        );
    }

    function isNetworkConfigurationValid() external view override returns (bool) {
        address boundFactory = authorizedFactory;
        if (
            block.chainid != expectedChainId || boundFactory == address(0) || boundFactory.code.length == 0
                || uniswapV3Factory.code.length == 0 || address(nonfungiblePositionManager).code.length == 0
                || address(wrappedNative).code.length == 0 || positionLocker.code.length == 0
        ) return false;

        try nonfungiblePositionManager.factory() returns (address configuredFactory) {
            if (configuredFactory != uniswapV3Factory) return false;
        } catch {
            return false;
        }
        try nonfungiblePositionManager.WETH9() returns (address configuredWeth) {
            if (configuredWeth != address(wrappedNative)) return false;
        } catch {
            return false;
        }
        try IUniswapV3Factory(uniswapV3Factory).feeAmountTickSpacing(POOL_FEE) returns (int24 spacing) {
            if (spacing != TICK_SPACING) return false;
        } catch {
            return false;
        }
        try IPositionLocker(positionLocker).positionManager() returns (address configuredNpm) {
            if (configuredNpm != address(nonfungiblePositionManager)) return false;
        } catch {
            return false;
        }
        try ILaunchFactoryBinding(boundFactory).liquidityManager() returns (address configuredManager) {
            return configuredManager == address(this);
        } catch {
            return false;
        }
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {
        if (msg.sender != address(wrappedNative)) revert UnexpectedNativeSender(msg.sender);
    }
}
