// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IGraduationManagerV2 {
    function initializeLaunchPool(address curve) external returns (address pool);

    function createAndLockPosition(
        uint256 launchId,
        address token,
        address escrow,
        address creator,
        uint256 tokenAmount
    ) external payable returns (address pool, uint256 positionId, uint256 tokenUsed, uint256 nativeUsed);
}
