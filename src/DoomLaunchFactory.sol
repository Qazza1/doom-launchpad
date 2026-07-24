// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {DoomToken} from "./DoomToken.sol";
import {GmEscrow} from "./GmEscrow.sol";
import {IDoomRewards} from "./interfaces/IDoomRewards.sol";
import {ILiquidityManager} from "./interfaces/ILiquidityManager.sol";
import {IPositionLocker} from "./interfaces/IPositionLocker.sol";
import {IWrappedNative} from "./interfaces/IWrappedNative.sol";

/// @title DoomLaunchFactory
/// @notice Non-upgradeable, fail-closed launch orchestrator for the Doom Launchpad canary.
/// @dev Economic terms are constants. The operator cannot alter launched tokens, escrows, or LP locks.
contract DoomLaunchFactory is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint16 public constant CREATOR_LIQUID_BPS = 1_000;
    uint16 public constant LIQUIDITY_BPS = 4_000;
    uint16 public constant GM_ESCROW_BPS = 5_000;
    uint16 public constant CREATION_FEE_BPS = 1_000;
    uint16 public constant NFT_REWARD_FEE_SHARE_BPS = 5_000;
    uint32 public constant REQUIRED_GM_CHECK_INS = 3;
    uint32 public constant GM_CADENCE_SECONDS = 1 days;
    uint32 public constant GM_GRACE_PERIOD_SECONDS = 12 hours;
    uint64 public constant LP_LOCK_DURATION = 365 days;
    uint24 public constant POOL_FEE = 3_000;
    int24 public constant TICK_SPACING = 60;
    int24 public constant FULL_RANGE_TICK_LOWER = -887220;
    int24 public constant FULL_RANGE_TICK_UPPER = 887220;
    uint160 public constant MIN_SQRT_RATIO = 4_295_128_739;
    uint160 public constant MAX_SQRT_RATIO = 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342;
    uint256 public constant UTILIZATION_DENOMINATOR = 1_000_000;
    uint256 public constant MINIMUM_LIQUIDITY_UTILIZATION = 999_999;
    uint256 private constant Q192 = 1 << 192;

    error ZeroAddress();
    error DependencyHasNoCode(address dependency);
    error InvalidNameLength(uint256 length);
    error InvalidSymbolLength(uint256 length);
    error InvalidSupply();
    error ZeroAllocationAmount();
    error InitialPriceOutOfRange(uint256 sqrtPriceX96);
    error InvalidLiquidityConfiguration();
    error InvalidPilotConfiguration();
    error NativeValueOverflow(uint256 creationFee, uint256 nativeLiquidityAmount);
    error InsufficientNativeValue(uint256 required, uint256 supplied);
    error NativeTransferFailed(address recipient, uint256 amount);
    error UnauthorizedTreasury(address caller);
    error UnauthorizedOperator(address caller);
    error UnauthorizedPauseCaller(address caller);
    error UnauthorizedCreator(address caller);
    error LaunchesArePaused();
    error LaunchesAlreadyPaused();
    error LaunchesAlreadyActive();
    error LaunchLimitReached(uint256 maximum);
    error PerLaunchLiquidityLimitExceeded(uint256 maximum, uint256 supplied);
    error GlobalLiquidityLimitExceeded(uint256 maximum, uint256 suppliedTotal);
    error CreationFeeTooSmall(uint256 calculatedFee);
    error InsufficientAccruedFees(uint256 accrued, uint256 requested);
    error LiquidityUsageExceedsDesired(
        uint256 tokenDesired, uint256 tokenUsed, uint256 nativeDesired, uint256 nativeUsed
    );
    error LiquidityUtilizationTooLow(
        uint256 tokenDesired, uint256 tokenUsed, uint256 nativeDesired, uint256 nativeUsed
    );
    error LiquidityRemainderMismatch(uint256 expected, uint256 actual);
    error PositionNotLocked(uint256 positionId);
    error PoolHasNoCode(address pool);
    error PositionLockTermsMismatch(
        uint256 positionId,
        address expectedPool,
        address recordedPool,
        address expectedBeneficiary,
        address recordedBeneficiary,
        uint64 expectedUnlockTime,
        uint64 recordedUnlockTime
    );
    error PositionLockerMismatch(address expected, address actual);
    error RewardTokenMismatch(address expected, address actual);
    error WrappedRewardDepositMismatch(uint256 expected, uint256 received);
    error UnexpectedNativeSender(address sender);

    struct FactoryConfig {
        address operator;
        address emergencyGuardian;
        address approvedCreator;
        address treasury;
        address doomRewards;
        address wrappedNative;
        address liquidityManager;
        address positionLocker;
        uint32 maxLaunches;
        uint256 maxNativeLiquidityPerLaunch;
        uint256 maxNativeLiquidityGlobal;
    }

    struct LaunchParams {
        string name;
        string symbol;
        uint256 totalSupply;
        uint256 nativeLiquidityAmount;
    }

    struct LaunchRecord {
        address token;
        address creator;
        address pool;
        address creatorEscrow;
        uint256 positionId;
        uint256 totalSupply;
        uint256 creatorLiquidAmount;
        uint256 liquidityTokenAmountAllocated;
        uint256 liquidityTokenAmountUsed;
        uint256 liquidityTokenRemainder;
        uint256 escrowTokenAmount;
        uint256 nativeLiquidityAmountRequested;
        uint256 nativeLiquidityAmountUsed;
        uint256 creationFee;
        uint256 treasuryFee;
        uint256 nftRewardFee;
        uint64 createdAt;
        uint64 lpUnlockTime;
        uint160 sqrtPriceX96;
        bytes32 configurationHash;
    }

    address public immutable operator;
    address public immutable emergencyGuardian;
    address public immutable approvedCreator;
    address public immutable treasury;
    address public immutable doomRewards;
    IWrappedNative public immutable wrappedNative;
    ILiquidityManager public immutable liquidityManager;
    address public immutable positionLocker;
    uint32 public immutable maxLaunches;
    uint256 public immutable maxNativeLiquidityPerLaunch;
    uint256 public immutable maxNativeLiquidityGlobal;

    bool public launchesPaused = true;
    uint256 public accruedTreasuryFees;
    uint256 public totalNativeLiquidity;
    uint256 public nextLaunchId = 1;
    mapping(uint256 launchId => LaunchRecord record) private _launches;
    mapping(address token => uint256 launchId) public launchIdByToken;

    event LaunchCreated(
        uint256 indexed launchId,
        address indexed token,
        address indexed creator,
        address pool,
        uint256 positionId,
        address creatorEscrow,
        address positionLocker
    );
    event LaunchAllocations(
        uint256 indexed launchId,
        uint256 totalSupply,
        uint16 creatorLiquidBps,
        uint16 liquidityBps,
        uint16 gmEscrowBps,
        uint256 creatorLiquidAmount,
        uint256 liquidityTokenAmount,
        uint256 escrowTokenAmount,
        uint256 nativeLiquidityAmount
    );
    event LaunchCommitmentConfigured(
        uint256 indexed launchId, uint32 requiredCheckIns, uint32 cadenceSeconds, uint32 gracePeriodSeconds
    );
    event LaunchLiquidityUtilization(
        uint256 indexed launchId,
        uint256 tokenAllocated,
        uint256 tokenUsed,
        uint256 tokenRemainderToRewards,
        uint256 nativeRequested,
        uint256 nativeUsed,
        uint256 nativeRefunded
    );
    event LaunchLiquidityConfigured(
        uint256 indexed launchId,
        uint64 lpUnlockTime,
        address lpBeneficiary,
        uint24 poolFee,
        int24 tickLower,
        int24 tickUpper,
        uint160 sqrtPriceX96,
        bytes32 configurationHash
    );
    event LaunchFeeProcessed(
        uint256 indexed launchId,
        address indexed payer,
        uint256 totalFee,
        uint256 treasuryFee,
        uint256 nftRewardFee,
        uint256 accruedTreasuryFeesAfter
    );
    event LaunchPauseChanged(bool paused, address indexed caller);
    event NativeRefunded(uint256 indexed launchId, address indexed recipient, uint256 amount);
    event AccruedTreasuryFeesWithdrawn(address indexed treasury, uint256 amount, uint256 accruedAfter);

    modifier onlyTreasury() {
        if (msg.sender != treasury) revert UnauthorizedTreasury(msg.sender);
        _;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert UnauthorizedOperator(msg.sender);
        _;
    }

    constructor(FactoryConfig memory config_) {
        if (
            config_.operator == address(0) || config_.emergencyGuardian == address(0)
                || config_.approvedCreator == address(0) || config_.treasury == address(0)
                || config_.doomRewards == address(0) || config_.wrappedNative == address(0)
                || config_.liquidityManager == address(0) || config_.positionLocker == address(0)
        ) revert ZeroAddress();
        if (config_.doomRewards.code.length == 0) revert DependencyHasNoCode(config_.doomRewards);
        if (config_.wrappedNative.code.length == 0) revert DependencyHasNoCode(config_.wrappedNative);
        if (config_.liquidityManager.code.length == 0) revert DependencyHasNoCode(config_.liquidityManager);
        if (config_.positionLocker.code.length == 0) revert DependencyHasNoCode(config_.positionLocker);
        if (
            config_.maxLaunches == 0 || config_.maxNativeLiquidityPerLaunch == 0
                || config_.maxNativeLiquidityGlobal < config_.maxNativeLiquidityPerLaunch
        ) revert InvalidPilotConfiguration();

        address managerLocker = ILiquidityManager(config_.liquidityManager).positionLocker();
        if (managerLocker != config_.positionLocker) {
            revert PositionLockerMismatch(config_.positionLocker, managerLocker);
        }
        address configuredRewardToken = IDoomRewards(config_.doomRewards).feeRewardToken();
        if (configuredRewardToken != config_.wrappedNative) {
            revert RewardTokenMismatch(config_.wrappedNative, configuredRewardToken);
        }

        operator = config_.operator;
        emergencyGuardian = config_.emergencyGuardian;
        approvedCreator = config_.approvedCreator;
        treasury = config_.treasury;
        doomRewards = config_.doomRewards;
        wrappedNative = IWrappedNative(config_.wrappedNative);
        liquidityManager = ILiquidityManager(config_.liquidityManager);
        positionLocker = config_.positionLocker;
        maxLaunches = config_.maxLaunches;
        maxNativeLiquidityPerLaunch = config_.maxNativeLiquidityPerLaunch;
        maxNativeLiquidityGlobal = config_.maxNativeLiquidityGlobal;
    }

    /// @notice Lets the operator or guardian stop new launches without affecting existing escrows or claims.
    function pauseLaunches() external {
        if (msg.sender != operator && msg.sender != emergencyGuardian) {
            revert UnauthorizedPauseCaller(msg.sender);
        }
        if (launchesPaused) revert LaunchesAlreadyPaused();
        launchesPaused = true;
        emit LaunchPauseChanged(true, msg.sender);
    }

    /// @notice Lets only the operator resume new launches after reviewing the incident or configuration.
    function resumeLaunches() external onlyOperator {
        if (!launchesPaused) revert LaunchesAlreadyActive();
        launchesPaused = false;
        emit LaunchPauseChanged(false, msg.sender);
    }

    /// @notice Deploys one fixed-supply token, one three-day GM escrow, and one 365-day locked LP position.
    function launch(LaunchParams calldata params)
        external
        payable
        nonReentrant
        returns (uint256 launchId, address tokenAddress, address pool, uint256 positionId, address creatorEscrow)
    {
        if (launchesPaused) revert LaunchesArePaused();
        if (msg.sender != approvedCreator) revert UnauthorizedCreator(msg.sender);
        if (nextLaunchId > maxLaunches) revert LaunchLimitReached(maxLaunches);

        _validateLaunchParams(params);
        if (!liquidityManager.isNetworkConfigurationValid()) revert InvalidLiquidityConfiguration();

        uint256 requestedTotalLiquidity = totalNativeLiquidity + params.nativeLiquidityAmount;
        if (requestedTotalLiquidity > maxNativeLiquidityGlobal) {
            revert GlobalLiquidityLimitExceeded(maxNativeLiquidityGlobal, requestedTotalLiquidity);
        }

        uint256 maximumCreationFee = Math.mulDiv(params.nativeLiquidityAmount, CREATION_FEE_BPS, BPS_DENOMINATOR);
        if (params.nativeLiquidityAmount > type(uint256).max - maximumCreationFee) {
            revert NativeValueOverflow(maximumCreationFee, params.nativeLiquidityAmount);
        }
        uint256 maximumRequiredValue = params.nativeLiquidityAmount + maximumCreationFee;
        if (msg.value < maximumRequiredValue) revert InsufficientNativeValue(maximumRequiredValue, msg.value);

        launchId = nextLaunchId++;
        DoomToken token = new DoomToken(params.name, params.symbol, params.totalSupply, address(this));
        tokenAddress = address(token);

        uint256 creatorAmount = Math.mulDiv(params.totalSupply, CREATOR_LIQUID_BPS, BPS_DENOMINATOR);
        uint256 liquidityAllocated = Math.mulDiv(params.totalSupply, LIQUIDITY_BPS, BPS_DENOMINATOR);
        uint256 escrowAmount = params.totalSupply - creatorAmount - liquidityAllocated;
        if (creatorAmount == 0 || liquidityAllocated == 0 || escrowAmount == 0) revert ZeroAllocationAmount();

        GmEscrow escrow = new GmEscrow(
            launchId,
            tokenAddress,
            msg.sender,
            doomRewards,
            escrowAmount,
            REQUIRED_GM_CHECK_INS,
            GM_CADENCE_SECONDS,
            GM_GRACE_PERIOD_SECONDS
        );
        creatorEscrow = address(escrow);

        IERC20 launchToken = IERC20(tokenAddress);
        launchToken.safeTransfer(msg.sender, creatorAmount);
        launchToken.safeTransfer(creatorEscrow, escrowAmount);
        launchToken.forceApprove(address(liquidityManager), liquidityAllocated);

        uint64 lpUnlockTime = uint64(block.timestamp + LP_LOCK_DURATION);
        uint160 sqrtPriceX96 = _computeInitialSqrtPrice(tokenAddress, liquidityAllocated, params.nativeLiquidityAmount);
        ILiquidityManager.CreateLiquidityParams memory liquidityParams = ILiquidityManager.CreateLiquidityParams({
            token: tokenAddress,
            tokenAmount: liquidityAllocated,
            nativeAmount: params.nativeLiquidityAmount,
            creator: msg.sender,
            lpBeneficiary: msg.sender,
            fee: POOL_FEE,
            tickLower: FULL_RANGE_TICK_LOWER,
            tickUpper: FULL_RANGE_TICK_UPPER,
            sqrtPriceX96: sqrtPriceX96,
            unlockTime: lpUnlockTime
        });

        uint256 tokenUsed;
        uint256 nativeUsed;
        (pool, positionId, tokenUsed, nativeUsed) =
            liquidityManager.createAndLockLiquidity{value: params.nativeLiquidityAmount}(liquidityParams);
        launchToken.forceApprove(address(liquidityManager), 0);

        if (tokenUsed > liquidityAllocated || nativeUsed > params.nativeLiquidityAmount) {
            revert LiquidityUsageExceedsDesired(liquidityAllocated, tokenUsed, params.nativeLiquidityAmount, nativeUsed);
        }
        uint256 minimumTokenUsed =
            Math.mulDiv(liquidityAllocated, MINIMUM_LIQUIDITY_UTILIZATION, UTILIZATION_DENOMINATOR);
        uint256 minimumNativeUsed =
            Math.mulDiv(params.nativeLiquidityAmount, MINIMUM_LIQUIDITY_UTILIZATION, UTILIZATION_DENOMINATOR);
        if (tokenUsed < minimumTokenUsed || nativeUsed < minimumNativeUsed) {
            revert LiquidityUtilizationTooLow(liquidityAllocated, tokenUsed, params.nativeLiquidityAmount, nativeUsed);
        }

        uint256 tokenRemainder = liquidityAllocated - tokenUsed;
        uint256 remaining = launchToken.balanceOf(address(this));
        if (remaining != tokenRemainder) revert LiquidityRemainderMismatch(tokenRemainder, remaining);
        if (tokenRemainder != 0) {
            uint256 rewardsTokenBalanceBefore = launchToken.balanceOf(doomRewards);
            launchToken.forceApprove(doomRewards, tokenRemainder);
            IDoomRewards(doomRewards).depositLiquidityRemainder(tokenAddress, tokenRemainder, launchId);
            launchToken.forceApprove(doomRewards, 0);
            uint256 rewardsTokenDelta = launchToken.balanceOf(doomRewards) - rewardsTokenBalanceBefore;
            if (rewardsTokenDelta != tokenRemainder) {
                revert LiquidityRemainderMismatch(tokenRemainder, rewardsTokenDelta);
            }
        }

        if (pool == address(0) || pool.code.length == 0) revert PoolHasNoCode(pool);
        _validateLockedPosition(positionId, pool, msg.sender, lpUnlockTime);

        bytes32 configurationHash = liquidityManager.configurationHash();
        if (configurationHash == bytes32(0)) revert InvalidLiquidityConfiguration();

        totalNativeLiquidity += nativeUsed;
        uint256 creationFee = Math.mulDiv(nativeUsed, CREATION_FEE_BPS, BPS_DENOMINATOR);
        uint256 nftRewardFee = Math.mulDiv(creationFee, NFT_REWARD_FEE_SHARE_BPS, BPS_DENOMINATOR);
        uint256 treasuryFee = creationFee - nftRewardFee;
        if (nftRewardFee == 0 || treasuryFee == 0) revert CreationFeeTooSmall(creationFee);

        uint256 rewardsBalanceBefore = IERC20(address(wrappedNative)).balanceOf(doomRewards);
        wrappedNative.deposit{value: nftRewardFee}();
        IERC20(address(wrappedNative)).forceApprove(doomRewards, nftRewardFee);
        IDoomRewards(doomRewards).depositFeeRewards(address(wrappedNative), nftRewardFee, launchId);
        IERC20(address(wrappedNative)).forceApprove(doomRewards, 0);
        uint256 rewardDelta = IERC20(address(wrappedNative)).balanceOf(doomRewards) - rewardsBalanceBefore;
        if (rewardDelta != nftRewardFee) revert WrappedRewardDepositMismatch(nftRewardFee, rewardDelta);

        accruedTreasuryFees += treasuryFee;
        _recordLaunch(
            launchId,
            params,
            tokenAddress,
            pool,
            creatorEscrow,
            positionId,
            creatorAmount,
            liquidityAllocated,
            tokenUsed,
            tokenRemainder,
            escrowAmount,
            nativeUsed,
            creationFee,
            treasuryFee,
            nftRewardFee,
            lpUnlockTime,
            configurationHash
        );

        emit LaunchCreated(launchId, tokenAddress, msg.sender, pool, positionId, creatorEscrow, positionLocker);
        emit LaunchAllocations(
            launchId,
            params.totalSupply,
            CREATOR_LIQUID_BPS,
            LIQUIDITY_BPS,
            GM_ESCROW_BPS,
            creatorAmount,
            liquidityAllocated,
            escrowAmount,
            params.nativeLiquidityAmount
        );
        emit LaunchCommitmentConfigured(launchId, REQUIRED_GM_CHECK_INS, GM_CADENCE_SECONDS, GM_GRACE_PERIOD_SECONDS);
        emit LaunchLiquidityUtilization(
            launchId,
            liquidityAllocated,
            tokenUsed,
            tokenRemainder,
            params.nativeLiquidityAmount,
            nativeUsed,
            params.nativeLiquidityAmount - nativeUsed
        );
        emit LaunchLiquidityConfigured(
            launchId,
            lpUnlockTime,
            msg.sender,
            POOL_FEE,
            FULL_RANGE_TICK_LOWER,
            FULL_RANGE_TICK_UPPER,
            sqrtPriceX96,
            configurationHash
        );
        emit LaunchFeeProcessed(launchId, msg.sender, creationFee, treasuryFee, nftRewardFee, accruedTreasuryFees);

        uint256 refund = msg.value - nativeUsed - creationFee;
        if (refund != 0) {
            (bool success,) = payable(msg.sender).call{value: refund}("");
            if (!success) revert NativeTransferFailed(msg.sender, refund);
            emit NativeRefunded(launchId, msg.sender, refund);
        }
    }

    function getLaunch(uint256 launchId) external view returns (LaunchRecord memory) {
        return _launches[launchId];
    }

    function quoteCreationFee(uint256 nativeLiquidityAmount) external pure returns (uint256) {
        return Math.mulDiv(nativeLiquidityAmount, CREATION_FEE_BPS, BPS_DENOMINATOR);
    }

    /// @notice Withdraws only the treasury share; NFT rewards are already isolated in DoomRewards.
    function withdrawAccruedTreasuryFees(uint256 amount) external onlyTreasury nonReentrant {
        if (amount > accruedTreasuryFees) revert InsufficientAccruedFees(accruedTreasuryFees, amount);
        accruedTreasuryFees -= amount;

        (bool success,) = payable(treasury).call{value: amount}("");
        if (!success) revert NativeTransferFailed(treasury, amount);
        emit AccruedTreasuryFeesWithdrawn(treasury, amount, accruedTreasuryFees);
    }

    function _validateLaunchParams(LaunchParams calldata params) internal view {
        uint256 nameLength = bytes(params.name).length;
        uint256 symbolLength = bytes(params.symbol).length;
        if (nameLength == 0 || nameLength > 64) revert InvalidNameLength(nameLength);
        if (symbolLength == 0 || symbolLength > 12) revert InvalidSymbolLength(symbolLength);
        if (params.totalSupply == 0) revert InvalidSupply();
        if (params.nativeLiquidityAmount == 0) revert InvalidLiquidityConfiguration();
        if (params.nativeLiquidityAmount > maxNativeLiquidityPerLaunch) {
            revert PerLaunchLiquidityLimitExceeded(maxNativeLiquidityPerLaunch, params.nativeLiquidityAmount);
        }
    }

    function _computeInitialSqrtPrice(address token, uint256 tokenAmount, uint256 nativeAmount)
        internal
        view
        returns (uint160 sqrtPriceX96)
    {
        uint256 amount0 = token < address(wrappedNative) ? tokenAmount : nativeAmount;
        uint256 amount1 = token < address(wrappedNative) ? nativeAmount : tokenAmount;
        if (amount0 <= Q192) {
            uint256 maximumAmount1 = Math.mulDiv(type(uint256).max, amount0, Q192);
            if (amount1 > maximumAmount1) revert InitialPriceOutOfRange(type(uint256).max);
        }
        uint256 priceX192 = Math.mulDiv(amount1, Q192, amount0);
        uint256 calculated = Math.sqrt(priceX192);
        if (calculated <= MIN_SQRT_RATIO || calculated >= MAX_SQRT_RATIO) {
            revert InitialPriceOutOfRange(calculated);
        }
        sqrtPriceX96 = uint160(calculated);
    }

    function _validateLockedPosition(uint256 positionId, address pool, address beneficiary, uint64 unlockTime)
        internal
        view
    {
        (
            address recordedPool,
            address recordedBeneficiary,
            uint64 registeredAt,
            uint64 recordedUnlockTime,
            bool released,
            bool currentlyLocked
        ) = IPositionLocker(positionLocker).lockState(positionId);
        if (!currentlyLocked || released || registeredAt != uint64(block.timestamp)) {
            revert PositionNotLocked(positionId);
        }
        if (recordedPool != pool || recordedBeneficiary != beneficiary || recordedUnlockTime != unlockTime) {
            revert PositionLockTermsMismatch(
                positionId, pool, recordedPool, beneficiary, recordedBeneficiary, unlockTime, recordedUnlockTime
            );
        }
    }

    function _recordLaunch(
        uint256 launchId,
        LaunchParams calldata params,
        address tokenAddress,
        address pool,
        address creatorEscrow,
        uint256 positionId,
        uint256 creatorAmount,
        uint256 liquidityAllocated,
        uint256 liquidityUsed,
        uint256 liquidityRemainder,
        uint256 escrowAmount,
        uint256 nativeUsed,
        uint256 creationFee,
        uint256 treasuryFee,
        uint256 nftRewardFee,
        uint64 lpUnlockTime,
        bytes32 configurationHash
    ) internal {
        _launches[launchId] = LaunchRecord({
            token: tokenAddress,
            creator: msg.sender,
            pool: pool,
            creatorEscrow: creatorEscrow,
            positionId: positionId,
            totalSupply: params.totalSupply,
            creatorLiquidAmount: creatorAmount,
            liquidityTokenAmountAllocated: liquidityAllocated,
            liquidityTokenAmountUsed: liquidityUsed,
            liquidityTokenRemainder: liquidityRemainder,
            escrowTokenAmount: escrowAmount,
            nativeLiquidityAmountRequested: params.nativeLiquidityAmount,
            nativeLiquidityAmountUsed: nativeUsed,
            creationFee: creationFee,
            treasuryFee: treasuryFee,
            nftRewardFee: nftRewardFee,
            createdAt: uint64(block.timestamp),
            lpUnlockTime: lpUnlockTime,
            sqrtPriceX96: _computeInitialSqrtPrice(tokenAddress, liquidityAllocated, params.nativeLiquidityAmount),
            configurationHash: configurationHash
        });
        launchIdByToken[tokenAddress] = launchId;
    }

    receive() external payable {
        if (msg.sender != address(liquidityManager)) revert UnexpectedNativeSender(msg.sender);
    }
}
