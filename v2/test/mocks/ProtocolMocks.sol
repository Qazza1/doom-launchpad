// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MockWrappedNativeV2 is ERC20 {
    constructor() ERC20("Wrapped Native", "WNATIVE") {}

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        (bool sent,) = payable(msg.sender).call{value: amount}("");
        require(sent);
    }

    receive() external payable {
        _mint(msg.sender, msg.value);
    }
}

contract MockDoomRewardsV2 {
    using SafeERC20 for IERC20;
    address public immutable feeRewardToken;
    mapping(address => uint256) public failedDeposits;
    mapping(address => uint256) public feeDeposits;
    mapping(address => uint256) public liquidityRemainders;
    mapping(address => uint256) public lpFeeDeposits;

    constructor(address rewardToken) {
        feeRewardToken = rewardToken;
    }

    function depositFailedAllocation(address token, uint256 amount, uint256) external {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        failedDeposits[token] += amount;
    }

    function depositFeeRewards(address token, uint256 amount, uint256) external {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        feeDeposits[token] += amount;
    }

    function depositLiquidityRemainder(address token, uint256 amount, uint256) external {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        liquidityRemainders[token] += amount;
    }

    function depositLpFeeRewards(address token, uint256 amount, uint256, uint256) external {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        lpFeeDeposits[token] += amount;
    }
}

contract MockGraduationManagerV2 {
    using SafeERC20 for IERC20;
    bool public healthy = true;
    uint256 public nextPositionId = 1;
    uint256 public lastNative;
    uint256 public lastTokens;
    mapping(address => address) public launchPoolByCurve;

    function setHealthy(bool value) external {
        healthy = value;
    }

    function isNetworkConfigurationValid() external view returns (bool) {
        return healthy;
    }

    function initializeLaunchPool(address curve) external returns (address pool) {
        launchPoolByCurve[curve] = address(this);
        return address(this);
    }

    function createAndLockPosition(uint256, address token, address, address, uint256 tokenAmount)
        external
        payable
        returns (address pool, uint256 positionId, uint256 tokenUsed, uint256 nativeUsed)
    {
        IERC20(token).safeTransferFrom(msg.sender, address(this), tokenAmount);
        lastTokens = tokenAmount;
        lastNative = msg.value;
        return (address(this), nextPositionId++, tokenAmount, msg.value);
    }
}
