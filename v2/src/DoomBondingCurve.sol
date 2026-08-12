// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {GmEscrowV2} from "./GmEscrowV2.sol";
import {IDoomRewardsV2} from "./interfaces/IDoomRewardsV2.sol";
import {IWrappedNativeV2} from "./interfaces/IWrappedNativeV2.sol";
import {IGraduationManagerV2} from "./interfaces/IGraduationManagerV2.sol";

/// @title DoomBondingCurve
/// @notice Per-launch, two-way constant-product market that graduates permanently into canonical V3.
contract DoomBondingCurve is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    uint256 public constant BPS = 10_000;
    uint256 public constant TRADE_FEE_BPS = 100;
    uint256 public constant CREATOR_FEE_BPS = 7_000;
    uint256 public constant TREASURY_FEE_BPS = 1_500;
    uint256 public constant CURVE_TOKEN_BPS = 3_000;
    uint256 public constant LP_TOKEN_BPS = 1_000;
    uint256 public constant ESCROW_TOKEN_BPS = 6_000;
    uint256 public constant VIRTUAL_TOKEN_BPS = 4_500;
    uint256 public constant TERMINAL_VIRTUAL_TOKEN_BPS = 1_500;
    uint256 public constant GRADUATION_TARGET = 0.05 ether;
    uint256 public constant INITIAL_VIRTUAL_NATIVE = 0.025 ether;
    uint256 private constant Q192 = 1 << 192;

    error ZeroAddress();
    error DependencyHasNoCode(address dependency);
    error InvalidSupply();
    error InvalidRewardsToken(address expected, address actual);
    error NotFunded(uint256 expected, uint256 actual);
    error AlreadyGraduated();
    error NotGraduated();
    error ZeroTrade();
    error DeadlineExpired(uint256 deadline, uint256 currentTime);
    error SlippageExceeded(uint256 minimum, uint256 actual);
    error InsufficientCurveLiquidity(uint256 requested, uint256 available);
    error TransferFailed(address recipient, uint256 amount);
    error OnlyGraduationManager(address caller);
    error NoFeesAvailable();
    error CreatorFeesUnavailable();
    error CreatorFeesNotDefaulted();
    error AccountingMismatch(uint256 expected, uint256 actual);
    error InvalidSqrtPrice();

    uint256 public immutable launchId;
    IERC20 public immutable token;
    address public immutable creator;
    address public immutable treasury;
    IDoomRewardsV2 public immutable doomRewards;
    IWrappedNativeV2 public immutable wrappedNative;
    IGraduationManagerV2 public immutable graduationManager;
    GmEscrowV2 public immutable escrow;
    uint256 public immutable totalSupply;
    uint256 public immutable curveTokenAllocation;
    uint256 public immutable lpTokenAllocation;
    uint256 public immutable escrowTokenAllocation;
    uint256 public immutable virtualTokenStart;
    uint256 public immutable virtualTokenFloor;
    uint256 public immutable invariantK;

    uint256 public virtualTokenReserve;
    uint256 public virtualNativeReserve;
    uint256 public realTokenReserve;
    uint256 public realNativeReserve;
    uint256 public creatorFeePool;
    uint256 public creatorFeesClaimed;
    uint256 public creatorFeesForfeited;
    uint256 public treasuryFeesAccrued;
    uint256 public rewardsFeesAccrued;
    bool public graduated;
    address public pool;
    uint256 public positionId;
    uint256 public lpTokensUsed;
    uint256 public nativeUsed;

    event Trade(
        uint256 indexed launchId,
        address indexed trader,
        bool indexed isBuy,
        uint256 tokenAmount,
        uint256 nativeAmount,
        uint256 feeAmount,
        uint256 nativeRaised
    );
    event Graduated(
        uint256 indexed launchId,
        address indexed pool,
        uint256 indexed positionId,
        uint256 tokenUsed,
        uint256 nativeUsed,
        uint256 tokenRemainder,
        uint256 nativeRemainder
    );
    event ProtocolFeesSettled(uint256 indexed launchId, uint256 treasuryAmount, uint256 rewardsAmount);
    event CreatorFeesClaimed(uint256 indexed launchId, address indexed creator, uint256 amount);
    event CreatorFeesForfeited(uint256 indexed launchId, uint256 amount);

    constructor(
        uint256 launchId_,
        address token_,
        address creator_,
        address treasury_,
        address doomRewards_,
        address wrappedNative_,
        address graduationManager_,
        uint256 totalSupply_
    ) {
        if (
            token_ == address(0) || creator_ == address(0) || treasury_ == address(0) || doomRewards_ == address(0)
                || wrappedNative_ == address(0) || graduationManager_ == address(0)
        ) revert ZeroAddress();
        if (token_.code.length == 0) revert DependencyHasNoCode(token_);
        if (doomRewards_.code.length == 0) revert DependencyHasNoCode(doomRewards_);
        if (wrappedNative_.code.length == 0) revert DependencyHasNoCode(wrappedNative_);
        if (graduationManager_.code.length == 0) revert DependencyHasNoCode(graduationManager_);
        if (totalSupply_ == 0 || totalSupply_ % BPS != 0) revert InvalidSupply();
        address configuredRewardToken = IDoomRewardsV2(doomRewards_).feeRewardToken();
        if (configuredRewardToken != wrappedNative_) revert InvalidRewardsToken(wrappedNative_, configuredRewardToken);

        launchId = launchId_;
        token = IERC20(token_);
        creator = creator_;
        treasury = treasury_;
        doomRewards = IDoomRewardsV2(doomRewards_);
        wrappedNative = IWrappedNativeV2(wrappedNative_);
        graduationManager = IGraduationManagerV2(graduationManager_);
        totalSupply = totalSupply_;

        curveTokenAllocation = totalSupply_ * CURVE_TOKEN_BPS / BPS;
        lpTokenAllocation = totalSupply_ * LP_TOKEN_BPS / BPS;
        escrowTokenAllocation = totalSupply_ * ESCROW_TOKEN_BPS / BPS;
        virtualTokenStart = totalSupply_ * VIRTUAL_TOKEN_BPS / BPS;
        virtualTokenFloor = totalSupply_ * TERMINAL_VIRTUAL_TOKEN_BPS / BPS;
        invariantK = virtualTokenStart * INITIAL_VIRTUAL_NATIVE;
        virtualTokenReserve = virtualTokenStart;
        virtualNativeReserve = INITIAL_VIRTUAL_NATIVE;
        realTokenReserve = curveTokenAllocation + lpTokenAllocation;

        GmEscrowV2 deployedEscrow = new GmEscrowV2(
            launchId_, token_, creator_, address(this), doomRewards_, escrowTokenAllocation, 3, 1 days, 12 hours
        );
        escrow = deployedEscrow;
    }

    receive() external payable {
        if (msg.sender != address(graduationManager)) revert OnlyGraduationManager(msg.sender);
    }

    function remainingToGraduate() public view returns (uint256) {
        return GRADUATION_TARGET - realNativeReserve;
    }

    function tokensSold() public view returns (uint256) {
        return virtualTokenStart - virtualTokenReserve;
    }

    function quoteBuy(uint256 grossNativeIn)
        public
        view
        returns (uint256 tokenOut, uint256 grossUsed, uint256 fee, uint256 refund)
    {
        if (grossNativeIn == 0 || graduated) return (0, 0, 0, grossNativeIn);
        uint256 remaining = remainingToGraduate();
        uint256 ordinaryFee = grossNativeIn * TRADE_FEE_BPS / BPS;
        uint256 net = grossNativeIn - ordinaryFee;
        if (net >= remaining) {
            net = remaining;
            grossUsed = Math.mulDiv(net, BPS, BPS - TRADE_FEE_BPS, Math.Rounding.Ceil);
            if (grossUsed > grossNativeIn) return (0, 0, 0, grossNativeIn);
            fee = grossUsed - net;
            refund = grossNativeIn - grossUsed;
        } else {
            grossUsed = grossNativeIn;
            fee = ordinaryFee;
        }
        uint256 newVirtualNative = virtualNativeReserve + net;
        uint256 newVirtualToken = Math.ceilDiv(invariantK, newVirtualNative);
        if (newVirtualToken < virtualTokenFloor) newVirtualToken = virtualTokenFloor;
        tokenOut = virtualTokenReserve - newVirtualToken;
    }

    function quoteSell(uint256 tokenIn) public view returns (uint256 nativeOut, uint256 fee) {
        if (tokenIn == 0 || graduated) return (0, 0);
        uint256 available = tokensSold();
        if (tokenIn > available) return (0, 0);
        uint256 newVirtualToken = virtualTokenReserve + tokenIn;
        uint256 newVirtualNative = Math.ceilDiv(invariantK, newVirtualToken);
        uint256 grossOut = virtualNativeReserve - newVirtualNative;
        fee = grossOut * TRADE_FEE_BPS / BPS;
        nativeOut = grossOut - fee;
    }

    function buy(uint256 minTokensOut, uint256 deadline) external payable nonReentrant returns (uint256 tokenOut) {
        _checkDeadline(deadline);
        if (graduated) revert AlreadyGraduated();
        if (msg.value == 0) revert ZeroTrade();
        _requireFunded();
        uint256 grossUsed;
        uint256 fee;
        uint256 refund;
        (tokenOut, grossUsed, fee, refund) = quoteBuy(msg.value);
        if (tokenOut == 0) revert ZeroTrade();
        if (tokenOut < minTokensOut) revert SlippageExceeded(minTokensOut, tokenOut);
        uint256 net = grossUsed - fee;
        uint256 newVirtualNative = virtualNativeReserve + net;
        uint256 newVirtualToken = virtualTokenReserve - tokenOut;
        virtualNativeReserve = newVirtualNative;
        virtualTokenReserve = newVirtualToken;
        realNativeReserve += net;
        realTokenReserve -= tokenOut;
        _allocateFee(fee);
        token.safeTransfer(msg.sender, tokenOut);
        emit Trade(launchId, msg.sender, true, tokenOut, net, fee, realNativeReserve);
        if (realNativeReserve == GRADUATION_TARGET) _graduate();
        if (refund != 0) _sendNative(msg.sender, refund);
    }

    function sell(uint256 tokenIn, uint256 minNativeOut, uint256 deadline)
        external
        nonReentrant
        returns (uint256 nativeOut)
    {
        _checkDeadline(deadline);
        if (graduated) revert AlreadyGraduated();
        if (tokenIn == 0) revert ZeroTrade();
        uint256 available = tokensSold();
        if (tokenIn > available) revert InsufficientCurveLiquidity(tokenIn, available);
        uint256 fee;
        (nativeOut, fee) = quoteSell(tokenIn);
        if (nativeOut == 0) revert ZeroTrade();
        if (nativeOut < minNativeOut) revert SlippageExceeded(minNativeOut, nativeOut);
        uint256 grossOut = nativeOut + fee;
        virtualTokenReserve += tokenIn;
        virtualNativeReserve -= grossOut;
        realTokenReserve += tokenIn;
        realNativeReserve -= grossOut;
        _allocateFee(fee);
        token.safeTransferFrom(msg.sender, address(this), tokenIn);
        _sendNative(msg.sender, nativeOut);
        emit Trade(launchId, msg.sender, false, tokenIn, nativeOut, fee, realNativeReserve);
    }

    function settleProtocolFees() external nonReentrant {
        uint256 treasuryAmount = treasuryFeesAccrued;
        uint256 rewardsAmount = rewardsFeesAccrued;
        if (treasuryAmount == 0 && rewardsAmount == 0) revert NoFeesAvailable();
        treasuryFeesAccrued = 0;
        rewardsFeesAccrued = 0;
        if (treasuryAmount != 0) _sendNative(treasury, treasuryAmount);
        if (rewardsAmount != 0) _depositNativeRewards(rewardsAmount);
        emit ProtocolFeesSettled(launchId, treasuryAmount, rewardsAmount);
    }

    function claimCreatorFees() external nonReentrant returns (uint256 amount) {
        if (msg.sender != creator) revert CreatorFeesUnavailable();
        if (!graduated) revert NotGraduated();
        uint256 vested = creatorFeePool * escrow.completedCheckIns() / escrow.requiredCheckIns();
        amount = vested - creatorFeesClaimed;
        if (amount == 0) revert CreatorFeesUnavailable();
        creatorFeesClaimed += amount;
        _sendNative(creator, amount);
        emit CreatorFeesClaimed(launchId, creator, amount);
    }

    function forfeitDefaultedCreatorFees() external nonReentrant returns (uint256 amount) {
        if (escrow.status() != GmEscrowV2.Status.Defaulted) revert CreatorFeesNotDefaulted();
        uint256 vested = creatorFeePool * escrow.completedCheckIns() / escrow.requiredCheckIns();
        amount = creatorFeePool - vested - creatorFeesForfeited;
        if (amount == 0) revert NoFeesAvailable();
        creatorFeesForfeited += amount;
        _depositNativeRewards(amount);
        emit CreatorFeesForfeited(launchId, amount);
    }

    function creatorFeesClaimable() external view returns (uint256) {
        if (!graduated) return 0;
        uint256 vested = creatorFeePool * escrow.completedCheckIns() / escrow.requiredCheckIns();
        return vested > creatorFeesClaimed ? vested - creatorFeesClaimed : 0;
    }

    function accountedNativeBalance() external view returns (uint256) {
        return realNativeReserve + treasuryFeesAccrued + rewardsFeesAccrued + creatorFeePool - creatorFeesClaimed
            - creatorFeesForfeited;
    }

    function _graduate() internal {
        graduated = true;
        uint256 tokenAmount = realTokenReserve;
        uint256 nativeAmount = realNativeReserve;
        realTokenReserve = 0;
        realNativeReserve = 0;
        uint160 sqrtPriceX96 = _computeInitialSqrtPrice(tokenAmount, nativeAmount);
        token.forceApprove(address(graduationManager), tokenAmount);
        (address deployedPool, uint256 nftId, uint256 tokenUsed_, uint256 nativeUsed_) = graduationManager.createAndLockPosition{
            value: nativeAmount
        }(
            launchId, address(token), address(escrow), creator, tokenAmount, sqrtPriceX96
        );
        token.forceApprove(address(graduationManager), 0);
        if (tokenUsed_ > tokenAmount || nativeUsed_ > nativeAmount) {
            revert AccountingMismatch(tokenAmount + nativeAmount, tokenUsed_ + nativeUsed_);
        }
        uint256 tokenRemainder = tokenAmount - tokenUsed_;
        uint256 nativeRemainder = nativeAmount - nativeUsed_;
        if (tokenRemainder != 0) {
            token.forceApprove(address(doomRewards), tokenRemainder);
            doomRewards.depositLiquidityRemainder(address(token), tokenRemainder, launchId);
            token.forceApprove(address(doomRewards), 0);
        }
        if (nativeRemainder != 0) _depositNativeRewards(nativeRemainder);
        escrow.activate();
        pool = deployedPool;
        positionId = nftId;
        lpTokensUsed = tokenUsed_;
        nativeUsed = nativeUsed_;
        emit Graduated(launchId, deployedPool, nftId, tokenUsed_, nativeUsed_, tokenRemainder, nativeRemainder);
    }

    function _computeInitialSqrtPrice(uint256 tokenAmount, uint256 nativeAmount) internal view returns (uint160) {
        uint256 amount0 = address(token) < address(wrappedNative) ? tokenAmount : nativeAmount;
        uint256 amount1 = address(token) < address(wrappedNative) ? nativeAmount : tokenAmount;
        uint256 maxAmount1 = Math.mulDiv(type(uint256).max, amount0, Q192);
        if (amount1 > maxAmount1) revert InvalidSqrtPrice();
        uint256 priceX192 = Math.mulDiv(amount1, Q192, amount0);
        uint256 result = Math.sqrt(priceX192);
        if (result == 0 || result > type(uint160).max) revert InvalidSqrtPrice();
        return result.toUint160();
    }

    function _allocateFee(uint256 fee) internal {
        if (fee == 0) return;
        uint256 creatorShare = fee * CREATOR_FEE_BPS / BPS;
        uint256 treasuryShare = fee * TREASURY_FEE_BPS / BPS;
        creatorFeePool += creatorShare;
        treasuryFeesAccrued += treasuryShare;
        rewardsFeesAccrued += fee - creatorShare - treasuryShare;
    }

    function _depositNativeRewards(uint256 amount) internal {
        uint256 beforeBalance = wrappedNative.balanceOf(address(doomRewards));
        wrappedNative.deposit{value: amount}();
        IERC20(address(wrappedNative)).forceApprove(address(doomRewards), amount);
        doomRewards.depositFeeRewards(address(wrappedNative), amount, launchId);
        IERC20(address(wrappedNative)).forceApprove(address(doomRewards), 0);
        uint256 actual = wrappedNative.balanceOf(address(doomRewards)) - beforeBalance;
        if (actual != amount) revert AccountingMismatch(amount, actual);
    }

    function _requireFunded() internal view {
        uint256 actual = token.balanceOf(address(this));
        if (actual < realTokenReserve) revert NotFunded(realTokenReserve, actual);
    }

    function _checkDeadline(uint256 deadline) internal view {
        // A caller-selected timestamp is the standard transaction-expiry guard.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > deadline) revert DeadlineExpired(deadline, block.timestamp);
    }

    function _sendNative(address recipient, uint256 amount) internal {
        (bool success,) = payable(recipient).call{value: amount}("");
        if (!success) revert TransferFailed(recipient, amount);
    }
}
