// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ILaunchDeployerV2 {
    function authorizedFactory() external view returns (address);
    function bindFactory(address factory_) external;
    function deployLaunch(
        uint256 launchId,
        string calldata name,
        string calldata symbol,
        uint256 totalSupply,
        address creator,
        address treasury,
        address doomRewards,
        address wrappedNative,
        address graduationManager
    ) external returns (address token, address curve, address escrow);
}
