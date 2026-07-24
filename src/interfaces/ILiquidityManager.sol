// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ILiquidityManager
/// @notice Integration boundary for a verified Uniswap V3-compatible deployment.
interface ILiquidityManager {
    struct CreateLiquidityParams {
        address token;
        uint256 tokenAmount;
        uint256 nativeAmount;
        address creator;
        address lpBeneficiary;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint160 sqrtPriceX96;
        uint64 unlockTime;
    }

    function createAndLockLiquidity(CreateLiquidityParams calldata params)
        external
        payable
        returns (address pool, uint256 positionId, uint256 tokenUsed, uint256 nativeUsed);

    function positionLocker() external view returns (address);

    /// @notice Returns true only when all configured external dependencies have code,
    ///         match the expected deployment, and support the requested integration.
    function isNetworkConfigurationValid() external view returns (bool);

    /// @notice Hash of the concrete network dependency configuration for indexer/audit use.
    function configurationHash() external view returns (bytes32);
}
