// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title PositionLocker
/// @notice Ownerless time-lock for V3-style liquidity position NFTs.
/// @dev There is no admin or treasury withdrawal function. Release is permissionless after
///      the immutable per-position unlock time and always pays the precommitted beneficiary.
contract PositionLocker is ERC721Holder, ReentrancyGuard {
    error ZeroAddress();
    error InvalidBeneficiary(address beneficiary);
    error PositionManagerHasNoCode(address positionManager);
    error PositionAlreadyRegistered(uint256 positionId);
    error LockerDoesNotOwnPosition(uint256 positionId, address actualOwner);
    error InvalidUnlockTime(uint64 unlockTime, uint256 currentTime);
    error PositionUnknown(uint256 positionId);
    error PositionAlreadyReleased(uint256 positionId);
    error PositionStillLocked(uint256 positionId, uint64 unlockTime, uint256 currentTime);

    struct Lock {
        address pool;
        address beneficiary;
        uint64 registeredAt;
        uint64 unlockTime;
        bool released;
    }

    IERC721 public immutable positionManagerContract;
    mapping(uint256 positionId => Lock lock) public locks;

    event PositionLocked(
        uint256 indexed positionId,
        address indexed pool,
        address indexed beneficiary,
        address positionManager,
        uint64 registeredAt,
        uint64 unlockTime
    );
    event PositionReleased(
        uint256 indexed positionId, address indexed pool, address indexed beneficiary, uint64 releasedAt
    );

    constructor(address positionManager_) {
        if (positionManager_ == address(0)) revert ZeroAddress();
        if (positionManager_.code.length == 0) revert PositionManagerHasNoCode(positionManager_);
        positionManagerContract = IERC721(positionManager_);
    }

    function positionManager() external view returns (address) {
        return address(positionManagerContract);
    }

    /// @notice Registers a position already transferred to this locker.
    /// @dev Permissionless registration is safe because ownership is verified and a legitimate
    ///      manager can transfer and register atomically in one transaction.
    function registerLock(uint256 positionId, address pool, address beneficiary, uint64 unlockTime) external {
        if (pool == address(0) || beneficiary == address(0)) revert ZeroAddress();
        if (beneficiary == address(this)) revert InvalidBeneficiary(beneficiary);
        if (locks[positionId].beneficiary != address(0)) revert PositionAlreadyRegistered(positionId);
        if (unlockTime <= block.timestamp) revert InvalidUnlockTime(unlockTime, block.timestamp);

        address owner = positionManagerContract.ownerOf(positionId);
        if (owner != address(this)) revert LockerDoesNotOwnPosition(positionId, owner);

        locks[positionId] = Lock({
            pool: pool,
            beneficiary: beneficiary,
            registeredAt: uint64(block.timestamp),
            unlockTime: unlockTime,
            released: false
        });

        emit PositionLocked(
            positionId, pool, beneficiary, address(positionManagerContract), uint64(block.timestamp), unlockTime
        );
    }

    function isLocked(uint256 positionId) public view returns (bool) {
        Lock memory lock = locks[positionId];
        return lock.beneficiary != address(0) && !lock.released && block.timestamp < lock.unlockTime
            && _lockerOwnsPosition(positionId);
    }

    /// @notice Returns recorded terms so factories, indexers, and users can verify the lock directly.
    function lockState(uint256 positionId)
        external
        view
        returns (
            address pool,
            address beneficiary,
            uint64 registeredAt,
            uint64 unlockTime,
            bool released,
            bool currentlyLocked
        )
    {
        Lock memory lock = locks[positionId];
        return (
            lock.pool,
            lock.beneficiary,
            lock.registeredAt,
            lock.unlockTime,
            lock.released,
            lock.beneficiary != address(0) && !lock.released && block.timestamp < lock.unlockTime
                && _lockerOwnsPosition(positionId)
        );
    }

    function release(uint256 positionId) external nonReentrant {
        Lock storage lock = locks[positionId];
        if (lock.beneficiary == address(0)) revert PositionUnknown(positionId);
        if (lock.released) revert PositionAlreadyReleased(positionId);
        if (block.timestamp < lock.unlockTime) {
            revert PositionStillLocked(positionId, lock.unlockTime, block.timestamp);
        }

        lock.released = true;
        positionManagerContract.safeTransferFrom(address(this), lock.beneficiary, positionId);

        emit PositionReleased(positionId, lock.pool, lock.beneficiary, uint64(block.timestamp));
    }

    function _lockerOwnsPosition(uint256 positionId) internal view returns (bool) {
        try positionManagerContract.ownerOf(positionId) returns (address owner) {
            return owner == address(this);
        } catch {
            return false;
        }
    }
}
