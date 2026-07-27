// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ICanonicalV3PositionManager} from "./interfaces/ICanonicalV3PositionManager.sol";
import {IDoomRewards} from "./interfaces/IDoomRewards.sol";

interface ILiquidityRegistrarBinding {
    function positionLocker() external view returns (address);
}

interface IGmFeeEligibility {
    function status() external view returns (uint8);

    function nextDeadline() external view returns (uint64);
}

/// @title PositionLocker
/// @notice Ownerless permanent custody and immutable fee routing for Doom Launchpad V3 positions.
/// @dev There is deliberately no release, decrease-liquidity, arbitrary-call, approval, or rescue path.
contract PositionLocker is ERC721Holder, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant BPS_DENOMINATOR = 10_000;
    /// @dev The creator can never recover the liquidity they supplied, so the fee stream is their
    ///      only return on it. The treasury rate is the same whether or not the creator is still
    ///      eligible; after a default the creator's share falls to the reward vault.
    uint16 public constant CREATOR_WETH_FEE_BPS = 7_000;
    uint16 public constant TREASURY_WETH_FEE_BPS = 1_500;
    uint16 public constant REWARDS_WETH_FEE_BPS = 1_500;
    uint24 public constant POOL_FEE = 10_000;
    int24 public constant FULL_RANGE_TICK_LOWER = -887200;
    int24 public constant FULL_RANGE_TICK_UPPER = 887200;

    uint8 internal constant ESCROW_ACTIVE = 0;
    uint8 internal constant ESCROW_COMPLETED = 1;
    uint8 internal constant ESCROW_DEFAULTED = 2;

    error ZeroAddress();
    error DependencyHasNoCode(address dependency);
    error PositionAlreadyRegistered(uint256 positionId);
    error PositionUnknown(uint256 positionId);
    error LockerDoesNotOwnPosition(uint256 positionId, address actualOwner);
    error UnauthorizedRegistrarBinder(address caller);
    error RegistrarAlreadyBound(address registrar);
    error InvalidRegistrarBinding(address registrar, address configuredLocker);
    error UnauthorizedRegistrar(address caller);
    error InvalidPositionConfiguration(uint256 positionId);
    error InvalidLaunchId();
    error FeeCollectionMismatch(address token, uint256 reported, uint256 received);
    error ResidualCollectedBalance(address token, uint256 expected, uint256 actual);
    error RewardDepositMismatch(address token, uint256 expected, uint256 received);

    struct Lock {
        address pool;
        address launchToken;
        address creator;
        address gmEscrow;
        uint256 launchId;
        uint64 registeredAt;
    }

    ICanonicalV3PositionManager public immutable positionManagerContract;
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
        address positionManager,
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
        if (IDoomRewards(doomRewards_).feeRewardToken() != wrappedNative_) {
            revert InvalidPositionConfiguration(0);
        }

        positionManagerContract = ICanonicalV3PositionManager(positionManager_);
        wrappedNative = IERC20(wrappedNative_);
        doomRewards = doomRewards_;
        treasury = treasury_;
        registrarBinder = registrarBinder_;
    }

    function positionManager() external view returns (address) {
        return address(positionManagerContract);
    }

    /// @notice Irreversibly authorizes the reviewed liquidity manager as the only registrar.
    function bindRegistrar(address registrar) external {
        if (msg.sender != registrarBinder) revert UnauthorizedRegistrarBinder(msg.sender);
        if (authorizedRegistrar != address(0)) revert RegistrarAlreadyBound(authorizedRegistrar);
        if (registrar == address(0) || registrar.code.length == 0) revert DependencyHasNoCode(registrar);

        address configuredLocker = address(0);
        try ILiquidityRegistrarBinding(registrar).positionLocker() returns (address locker) {
            configuredLocker = locker;
        } catch {
            revert InvalidRegistrarBinding(registrar, address(0));
        }
        if (configuredLocker != address(this)) {
            revert InvalidRegistrarBinding(registrar, configuredLocker);
        }

        authorizedRegistrar = registrar;
        emit RegistrarBound(registrar, msg.sender);
    }

    function registerPermanentLock(
        uint256 positionId,
        address pool,
        address launchToken,
        address creator,
        address gmEscrow,
        uint256 launchId
    ) external {
        if (msg.sender != authorizedRegistrar) revert UnauthorizedRegistrar(msg.sender);
        if (pool == address(0) || launchToken == address(0) || creator == address(0) || gmEscrow == address(0)) {
            revert ZeroAddress();
        }
        if (pool.code.length == 0) revert DependencyHasNoCode(pool);
        if (launchToken.code.length == 0) revert DependencyHasNoCode(launchToken);
        if (gmEscrow.code.length == 0) revert DependencyHasNoCode(gmEscrow);
        if (launchId == 0) revert InvalidLaunchId();
        if (locks[positionId].creator != address(0)) revert PositionAlreadyRegistered(positionId);

        address owner = _positionOwner(positionId);
        if (owner != address(this)) revert LockerDoesNotOwnPosition(positionId, owner);

        (address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper) =
            _positionConfiguration(positionId);
        bool validPair = token0 == launchToken && token1 == address(wrappedNative) || token1 == launchToken
            && token0 == address(wrappedNative);
        if (!validPair || fee != POOL_FEE || tickLower != FULL_RANGE_TICK_LOWER || tickUpper != FULL_RANGE_TICK_UPPER) {
            revert InvalidPositionConfiguration(positionId);
        }

        locks[positionId] = Lock({
            pool: pool,
            launchToken: launchToken,
            creator: creator,
            gmEscrow: gmEscrow,
            launchId: launchId,
            registeredAt: uint64(block.timestamp)
        });

        emit PermanentPositionRegistered(
            positionId,
            launchId,
            pool,
            launchToken,
            creator,
            gmEscrow,
            address(positionManagerContract),
            uint64(block.timestamp)
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
        return (
            lock.pool,
            lock.launchToken,
            lock.creator,
            lock.gmEscrow,
            lock.launchId,
            lock.registeredAt,
            lock.creator != address(0),
            lock.creator != address(0) && _positionOwner(positionId) == address(this)
        );
    }

    /// @notice Collects all currently owed fees and routes them to immutable recipients.
    /// @dev A missed, finalizable GM deadline redirects the creator share even before
    ///      `GmEscrow.finalizeDefault()` is called.
    function collectFees(uint256 positionId)
        external
        nonReentrant
        returns (
            uint256 launchTokenFees,
            uint256 wethCollected,
            uint256 creatorWeth,
            uint256 treasuryWeth,
            uint256 rewardsWeth
        )
    {
        Lock memory lock = locks[positionId];
        if (lock.creator == address(0)) revert PositionUnknown(positionId);
        address owner = _positionOwner(positionId);
        if (owner != address(this)) revert LockerDoesNotOwnPosition(positionId, owner);

        (address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper) =
            _positionConfiguration(positionId);
        bool launchIsToken0 = token0 == lock.launchToken && token1 == address(wrappedNative);
        bool launchIsToken1 = token1 == lock.launchToken && token0 == address(wrappedNative);
        if (
            (!launchIsToken0 && !launchIsToken1) || fee != POOL_FEE || tickLower != FULL_RANGE_TICK_LOWER
                || tickUpper != FULL_RANGE_TICK_UPPER
        ) revert InvalidPositionConfiguration(positionId);

        IERC20 launchToken = IERC20(lock.launchToken);
        uint256 launchBalanceBefore = launchToken.balanceOf(address(this));
        uint256 wethBalanceBefore = wrappedNative.balanceOf(address(this));

        (uint256 amount0, uint256 amount1) = positionManagerContract.collect(
            ICanonicalV3PositionManager.CollectParams({
                tokenId: positionId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );
        launchTokenFees = launchIsToken0 ? amount0 : amount1;
        wethCollected = launchIsToken0 ? amount1 : amount0;

        uint256 launchReceived = launchToken.balanceOf(address(this)) - launchBalanceBefore;
        uint256 wethReceived = wrappedNative.balanceOf(address(this)) - wethBalanceBefore;
        if (launchReceived != launchTokenFees) {
            revert FeeCollectionMismatch(lock.launchToken, launchTokenFees, launchReceived);
        }
        if (wethReceived != wethCollected) {
            revert FeeCollectionMismatch(address(wrappedNative), wethCollected, wethReceived);
        }

        bool eligible = creatorFeeEligible(positionId);
        treasuryWeth = Math.mulDiv(wethCollected, TREASURY_WETH_FEE_BPS, BPS_DENOMINATOR);
        if (eligible) {
            creatorWeth = Math.mulDiv(wethCollected, CREATOR_WETH_FEE_BPS, BPS_DENOMINATOR);
        }
        rewardsWeth = wethCollected - creatorWeth - treasuryWeth;

        if (creatorWeth != 0) wrappedNative.safeTransfer(lock.creator, creatorWeth);
        if (treasuryWeth != 0) wrappedNative.safeTransfer(treasury, treasuryWeth);
        if (rewardsWeth != 0) {
            _depositLpReward(address(wrappedNative), rewardsWeth, lock.launchId, positionId);
        }
        if (launchTokenFees != 0) {
            _depositLpReward(lock.launchToken, launchTokenFees, lock.launchId, positionId);
        }

        uint256 launchBalanceAfter = launchToken.balanceOf(address(this));
        uint256 wethBalanceAfter = wrappedNative.balanceOf(address(this));
        if (launchBalanceAfter != launchBalanceBefore) {
            revert ResidualCollectedBalance(lock.launchToken, launchBalanceBefore, launchBalanceAfter);
        }
        if (wethBalanceAfter != wethBalanceBefore) {
            revert ResidualCollectedBalance(address(wrappedNative), wethBalanceBefore, wethBalanceAfter);
        }

        emit PositionFeesCollected(
            positionId,
            lock.launchId,
            msg.sender,
            eligible,
            launchTokenFees,
            wethCollected,
            creatorWeth,
            treasuryWeth,
            rewardsWeth
        );
    }

    function creatorFeeEligible(uint256 positionId) public view returns (bool) {
        Lock memory lock = locks[positionId];
        if (lock.creator == address(0)) return false;

        uint8 escrowStatus = type(uint8).max;
        try IGmFeeEligibility(lock.gmEscrow).status() returns (uint8 value) {
            escrowStatus = value;
        } catch {
            return false;
        }
        if (escrowStatus == ESCROW_COMPLETED) return true;
        if (escrowStatus == ESCROW_DEFAULTED || escrowStatus != ESCROW_ACTIVE) return false;

        try IGmFeeEligibility(lock.gmEscrow).nextDeadline() returns (uint64 deadline) {
            // A missed onchain deadline must redirect the creator share before finalization.
            // forge-lint: disable-next-line(block-timestamp)
            return deadline != 0 && block.timestamp <= deadline;
        } catch {
            return false;
        }
    }

    function _depositLpReward(address token, uint256 amount, uint256 launchId, uint256 positionId) internal {
        IERC20 rewardToken = IERC20(token);
        uint256 rewardsBalanceBefore = rewardToken.balanceOf(doomRewards);
        rewardToken.forceApprove(doomRewards, amount);
        IDoomRewards(doomRewards).depositLpFeeRewards(token, amount, launchId, positionId);
        rewardToken.forceApprove(doomRewards, 0);
        uint256 received = rewardToken.balanceOf(doomRewards) - rewardsBalanceBefore;
        if (received != amount) revert RewardDepositMismatch(token, amount, received);
    }

    function _positionConfiguration(uint256 positionId)
        internal
        view
        returns (address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper)
    {
        (,, token0, token1, fee, tickLower, tickUpper,,,,,) = positionManagerContract.positions(positionId);
    }

    function _positionOwner(uint256 positionId) internal view returns (address owner) {
        try positionManagerContract.ownerOf(positionId) returns (address currentOwner) {
            owner = currentOwner;
        } catch {}
    }
}
