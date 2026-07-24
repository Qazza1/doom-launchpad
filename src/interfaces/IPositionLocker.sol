// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IPositionLocker
/// @notice Verification surface for locked V3-style position NFTs.
interface IPositionLocker {
    function positionManager() external view returns (address);

    function registerLock(uint256 positionId, address pool, address beneficiary, uint64 unlockTime) external;

    function isLocked(uint256 positionId) external view returns (bool);

    /// @notice Returns the immutable recorded lock terms and current lock state.
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
        );
}
