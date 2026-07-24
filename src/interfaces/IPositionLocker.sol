// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IPositionLocker
/// @notice Verification and registration surface for permanent V3 positions.
interface IPositionLocker {
    function positionManager() external view returns (address);

    function authorizedRegistrar() external view returns (address);

    function wrappedNative() external view returns (address);

    function doomRewards() external view returns (address);

    function treasury() external view returns (address);

    function registerPermanentLock(
        uint256 positionId,
        address pool,
        address launchToken,
        address creator,
        address gmEscrow,
        uint256 launchId
    ) external;

    function isPermanentlyLocked(uint256 positionId) external view returns (bool);

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
        );
}
