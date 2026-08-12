// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ICanonicalV3PositionManagerV2} from "./interfaces/ICanonicalV3PositionManagerV2.sol";
import {IDoomRewardsV2} from "./interfaces/IDoomRewardsV2.sol";

interface IGraduationRegistrarBinding {
    function positionLocker() external view returns (address);
}

interface IGmFeeEligibilityV2 {
    function status() external view returns (uint8);
    function nextDeadline() external view returns (uint64);
}

/// @notice Ownerless permanent custody and immutable fee routing for graduated V3 positions.
contract PositionLockerV2 is ERC721Holder, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant BPS = 10_000;
    uint16 public constant CREATOR_WETH_FEE_BPS = 7_000;
    uint16 public constant TREASURY_WETH_FEE_BPS = 1_500;
    uint24 public constant POOL_FEE = 10_000;
    int24 public constant FULL_RANGE_TICK_LOWER = -887200;
    int24 public constant FULL_RANGE_TICK_UPPER = 887200;
    uint8 private constant ESCROW_PENDING = 0;
    uint8 private constant ESCROW_ACTIVE = 1;
    uint8 private constant ESCROW_COMPLETED = 2;
    uint8 private constant ESCROW_DEFAULTED = 3;

    error ZeroAddress();
    error DependencyHasNoCode(address dependency);
    error UnauthorizedBinder(address caller);
    error RegistrarAlreadyBound(address registrar);
    error InvalidRegistrarBinding(address registrar, address configuredLocker);
    error UnauthorizedRegistrar(address caller);
    error InvalidLaunchId();
    error PositionAlreadyRegistered(uint256 positionId);
    error PositionUnknown(uint256 positionId);
    error LockerDoesNotOwnPosition(uint256 positionId, address actualOwner);
    error InvalidPositionConfiguration(uint256 positionId);
    error FeeCollectionMismatch(address token, uint256 reported, uint256 received);
    error RewardDepositMismatch(address token, uint256 expected, uint256 received);
    error ResidualBalance(address token, uint256 expected, uint256 actual);

    struct Lock {
        address pool;
        address launchToken;
        address creator;
        address gmEscrow;
        uint256 launchId;
        uint64 registeredAt;
    }

    ICanonicalV3PositionManagerV2 public immutable positionManagerContract;
    IERC20 public immutable wrappedNative;
    address public immutable doomRewards;
    address public immutable treasury;
    address public immutable registrarBinder;
    address public authorizedRegistrar;
    mapping(uint256 positionId => Lock lock) public locks;

    event RegistrarBound(address indexed registrar, address indexed binder);
    event PermanentPositionRegistered(
        uint256 indexed positionId,
        uint256 indexed launchId,
        address indexed pool,
        address launchToken,
        address creator,
        address gmEscrow,
        uint64 registeredAt
    );
    event PositionFeesCollected(
        uint256 indexed positionId,
        uint256 indexed launchId,
        address indexed caller,
        bool creatorEligible,
        uint256 launchTokenFeesToRewards,
        uint256 wethCollected,
        uint256 wethToCreator,
        uint256 wethToTreasury,
        uint256 wethToRewards
    );

    constructor(
        address positionManager_,
        address wrappedNative_,
        address doomRewards_,
        address treasury_,
        address registrarBinder_
    ) {
        if (
            positionManager_ == address(0) || wrappedNative_ == address(0) || doomRewards_ == address(0)
                || treasury_ == address(0) || registrarBinder_ == address(0)
        ) revert ZeroAddress();
        if (positionManager_.code.length == 0) revert DependencyHasNoCode(positionManager_);
        if (wrappedNative_.code.length == 0) revert DependencyHasNoCode(wrappedNative_);
        if (doomRewards_.code.length == 0) revert DependencyHasNoCode(doomRewards_);
        if (IDoomRewardsV2(doomRewards_).feeRewardToken() != wrappedNative_) {
            revert InvalidPositionConfiguration(0);
        }
        positionManagerContract = ICanonicalV3PositionManagerV2(positionManager_);
        wrappedNative = IERC20(wrappedNative_);
        doomRewards = doomRewards_;
        treasury = treasury_;
        registrarBinder = registrarBinder_;
    }

    function positionManager() external view returns (address) {
        return address(positionManagerContract);
    }

    function bindRegistrar(address registrar_) external {
        if (msg.sender != registrarBinder) revert UnauthorizedBinder(msg.sender);
        if (authorizedRegistrar != address(0)) revert RegistrarAlreadyBound(authorizedRegistrar);
        if (registrar_ == address(0) || registrar_.code.length == 0) revert DependencyHasNoCode(registrar_);
        address configured;
        try IGraduationRegistrarBinding(registrar_).positionLocker() returns (address locker) {
            configured = locker;
        } catch {
            revert InvalidRegistrarBinding(registrar_, address(0));
        }
        if (configured != address(this)) revert InvalidRegistrarBinding(registrar_, configured);
        authorizedRegistrar = registrar_;
        emit RegistrarBound(registrar_, msg.sender);
    }

    function registerPermanentLock(
        uint256 positionId,
        address pool,
        uint256 launchId,
        address launchToken,
        address gmEscrow,
        address creator
    ) external {
        if (msg.sender != authorizedRegistrar) revert UnauthorizedRegistrar(msg.sender);
        if (pool == address(0) || launchToken == address(0) || gmEscrow == address(0) || creator == address(0)) {
            revert ZeroAddress();
        }
        if (pool.code.length == 0) revert DependencyHasNoCode(pool);
        if (launchToken.code.length == 0) revert DependencyHasNoCode(launchToken);
        if (gmEscrow.code.length == 0) revert DependencyHasNoCode(gmEscrow);
        if (launchId == 0) revert InvalidLaunchId();
        if (locks[positionId].creator != address(0)) revert PositionAlreadyRegistered(positionId);
        address owner = _positionOwner(positionId);
        if (owner != address(this)) revert LockerDoesNotOwnPosition(positionId, owner);
        (address token0, address token1, uint24 fee, int24 lower, int24 upper) = _positionConfiguration(positionId);
        bool pair = (token0 == launchToken && token1 == address(wrappedNative))
            || (token1 == launchToken && token0 == address(wrappedNative));
        if (!pair || fee != POOL_FEE || lower != FULL_RANGE_TICK_LOWER || upper != FULL_RANGE_TICK_UPPER) {
            revert InvalidPositionConfiguration(positionId);
        }
        locks[positionId] = Lock(pool, launchToken, creator, gmEscrow, launchId, uint64(block.timestamp));
        emit PermanentPositionRegistered(
            positionId, launchId, pool, launchToken, creator, gmEscrow, uint64(block.timestamp)
        );
    }

    function isPermanentlyLocked(uint256 positionId) public view returns (bool) {
        return locks[positionId].creator != address(0) && _positionOwner(positionId) == address(this);
    }

    function lockState(uint256 positionId)
        external
        view
        returns (
            address pool,
            address launchToken,
            address creator,
            address gmEscrow,
            uint256 launchId,
            uint64 registeredAt,
            bool permanent,
            bool currentlyLocked
        )
    {
        Lock memory lock = locks[positionId];
        permanent = lock.creator != address(0);
        return (
            lock.pool,
            lock.launchToken,
            lock.creator,
            lock.gmEscrow,
            lock.launchId,
            lock.registeredAt,
            permanent,
            permanent && _positionOwner(positionId) == address(this)
        );
    }

    function creatorFeeEligible(uint256 positionId) public view returns (bool) {
        Lock memory lock = locks[positionId];
        if (lock.creator == address(0)) return false;
        uint8 state;
        try IGmFeeEligibilityV2(lock.gmEscrow).status() returns (uint8 value) {
            state = value;
        } catch {
            return false;
        }
        if (state == ESCROW_COMPLETED) return true;
        if (state == ESCROW_PENDING || state == ESCROW_DEFAULTED || state != ESCROW_ACTIVE) return false;
        try IGmFeeEligibilityV2(lock.gmEscrow).nextDeadline() returns (uint64 deadline) {
            // A missed onchain deadline redirects the creator share even before finalization.
            // forge-lint: disable-next-line(block-timestamp)
            return deadline != 0 && block.timestamp <= deadline;
        } catch {
            return false;
        }
    }

    function collectFees(uint256 positionId)
        external
        nonReentrant
        returns (uint256 launchFees, uint256 wethFees, uint256 creatorWeth, uint256 treasuryWeth, uint256 rewardsWeth)
    {
        Lock memory lock = locks[positionId];
        if (lock.creator == address(0)) revert PositionUnknown(positionId);
        address owner = _positionOwner(positionId);
        if (owner != address(this)) revert LockerDoesNotOwnPosition(positionId, owner);
        (address token0, address token1, uint24 fee, int24 lower, int24 upper) = _positionConfiguration(positionId);
        bool launchIs0 = token0 == lock.launchToken && token1 == address(wrappedNative);
        bool launchIs1 = token1 == lock.launchToken && token0 == address(wrappedNative);
        if (
            (!launchIs0 && !launchIs1) || fee != POOL_FEE || lower != FULL_RANGE_TICK_LOWER
                || upper != FULL_RANGE_TICK_UPPER
        ) {
            revert InvalidPositionConfiguration(positionId);
        }
        IERC20 launchToken = IERC20(lock.launchToken);
        uint256 launchBefore = launchToken.balanceOf(address(this));
        uint256 wethBefore = wrappedNative.balanceOf(address(this));
        (uint256 amount0, uint256 amount1) = positionManagerContract.collect(
            ICanonicalV3PositionManagerV2.CollectParams(positionId, address(this), type(uint128).max, type(uint128).max)
        );
        launchFees = launchIs0 ? amount0 : amount1;
        wethFees = launchIs0 ? amount1 : amount0;
        uint256 launchReceived = launchToken.balanceOf(address(this)) - launchBefore;
        uint256 wethReceived = wrappedNative.balanceOf(address(this)) - wethBefore;
        if (launchReceived != launchFees) revert FeeCollectionMismatch(lock.launchToken, launchFees, launchReceived);
        if (wethReceived != wethFees) revert FeeCollectionMismatch(address(wrappedNative), wethFees, wethReceived);

        bool eligible = creatorFeeEligible(positionId);
        treasuryWeth = Math.mulDiv(wethFees, TREASURY_WETH_FEE_BPS, BPS);
        if (eligible) creatorWeth = Math.mulDiv(wethFees, CREATOR_WETH_FEE_BPS, BPS);
        rewardsWeth = wethFees - creatorWeth - treasuryWeth;
        if (creatorWeth != 0) wrappedNative.safeTransfer(lock.creator, creatorWeth);
        if (treasuryWeth != 0) wrappedNative.safeTransfer(treasury, treasuryWeth);
        if (rewardsWeth != 0) _depositReward(address(wrappedNative), rewardsWeth, lock.launchId, positionId);
        if (launchFees != 0) _depositReward(lock.launchToken, launchFees, lock.launchId, positionId);
        uint256 launchAfter = launchToken.balanceOf(address(this));
        uint256 wethAfter = wrappedNative.balanceOf(address(this));
        if (launchAfter != launchBefore) revert ResidualBalance(lock.launchToken, launchBefore, launchAfter);
        if (wethAfter != wethBefore) revert ResidualBalance(address(wrappedNative), wethBefore, wethAfter);
        emit PositionFeesCollected(
            positionId,
            lock.launchId,
            msg.sender,
            eligible,
            launchFees,
            wethFees,
            creatorWeth,
            treasuryWeth,
            rewardsWeth
        );
    }

    function _depositReward(address asset, uint256 amount, uint256 launchId, uint256 positionId) internal {
        IERC20 rewardToken = IERC20(asset);
        uint256 beforeBalance = rewardToken.balanceOf(doomRewards);
        rewardToken.forceApprove(doomRewards, amount);
        IDoomRewardsV2(doomRewards).depositLpFeeRewards(asset, amount, launchId, positionId);
        rewardToken.forceApprove(doomRewards, 0);
        uint256 received = rewardToken.balanceOf(doomRewards) - beforeBalance;
        if (received != amount) revert RewardDepositMismatch(asset, amount, received);
    }

    function _positionConfiguration(uint256 positionId)
        internal
        view
        returns (address token0, address token1, uint24 fee, int24 lower, int24 upper)
    {
        (,, token0, token1, fee, lower, upper,,,,,) = positionManagerContract.positions(positionId);
    }

    function _positionOwner(uint256 positionId) internal view returns (address owner) {
        try positionManagerContract.ownerOf(positionId) returns (address currentOwner) {
            owner = currentOwner;
        } catch {}
    }
}
