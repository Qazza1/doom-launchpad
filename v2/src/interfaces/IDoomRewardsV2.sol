// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IDoomRewardsV2 {
    function feeRewardToken() external view returns (address);
    function depositFailedAllocation(address token, uint256 amount, uint256 launchId) external;
    function depositFeeRewards(address token, uint256 amount, uint256 launchId) external;
    function depositLiquidityRemainder(address token, uint256 amount, uint256 launchId) external;
    function depositLpFeeRewards(address token, uint256 amount, uint256 launchId, uint256 positionId) external;
}
