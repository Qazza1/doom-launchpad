// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IDoomRewards
/// @notice Minimal reward-vault interface used by per-launch GM escrows.
interface IDoomRewards {
    function feeRewardToken() external view returns (address);

    /// @notice Pulls a failed creator allocation from the caller into the reward vault.
    /// @dev The caller must approve `amount` first. This is a community incentive deposit,
    ///      not buyer protection.
    function depositFailedAllocation(address token, uint256 amount, uint256 launchId) external;

    /// @notice Pulls wrapped-native launch-fee rewards from the caller into the vault.
    function depositFeeRewards(address token, uint256 amount, uint256 launchId) external;

    /// @notice Pulls unused V3 token dust into the community reward vault.
    function depositLiquidityRemainder(address token, uint256 amount, uint256 launchId) external;

    /// @notice Pulls collected permanent-position fees into the community reward vault.
    function depositLpFeeRewards(address token, uint256 amount, uint256 launchId, uint256 positionId) external;
}
