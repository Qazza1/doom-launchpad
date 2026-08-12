// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IDoomLaunchFactoryV2 {
    function isCurve(address candidate) external view returns (bool);
    function graduationManager() external view returns (address);
}
