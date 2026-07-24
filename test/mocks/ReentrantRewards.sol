// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IDoomRewards} from "../../src/interfaces/IDoomRewards.sol";

contract ReentrantRewards is IDoomRewards {
    using SafeERC20 for IERC20;

    address public escrow;
    bool public reentryAttempted;
    bool public reentrySucceeded;

    function feeRewardToken() external pure override returns (address) {
        return address(0);
    }

    function setEscrow(address escrow_) external {
        escrow = escrow_;
    }

    function depositFailedAllocation(address token, uint256 amount, uint256) external override {
        reentryAttempted = true;
        (reentrySucceeded,) = escrow.call(abi.encodeWithSignature("finalizeDefault()"));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
    }

    function depositFeeRewards(address, uint256, uint256) external pure override {}

    function depositLiquidityRemainder(address, uint256, uint256) external pure override {}

    function depositLpFeeRewards(address, uint256, uint256, uint256) external pure override {}
}

contract NonPullingRewards is IDoomRewards {
    function feeRewardToken() external pure override returns (address) {
        return address(0);
    }

    function depositFailedAllocation(address, uint256, uint256) external pure override {}

    function depositFeeRewards(address, uint256, uint256) external pure override {}

    function depositLiquidityRemainder(address, uint256, uint256) external pure override {}

    function depositLpFeeRewards(address, uint256, uint256, uint256) external pure override {}
}
