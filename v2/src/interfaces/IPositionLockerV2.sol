// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IPositionLockerV2 {
    function positionManager() external view returns (address);
    function authorizedRegistrar() external view returns (address);
    function bindRegistrar(address registrar_) external;
    function registerPermanentLock(
        uint256 positionId,
        address pool,
        uint256 launchId,
        address token,
        address escrow,
        address creator
    ) external;
}
