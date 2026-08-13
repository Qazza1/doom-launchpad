// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IDoomRewardsV2} from "./interfaces/IDoomRewardsV2.sol";

/// @notice A creator-token escrow whose GM schedule begins only after V3 graduation succeeds.
contract GmEscrowV2 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        Pending,
        Active,
        Completed,
        Defaulted
    }

    error ZeroAddress();
    error ZeroAmount();
    error InvalidConfiguration();
    error DependencyHasNoCode(address dependency);
    error OnlyActivator(address caller);
    error OnlyCreator(address caller);
    error InvalidStatus(Status status);
    error EscrowNotFunded(uint256 expected, uint256 actual);
    error CheckInTooEarly(uint256 due, uint256 currentTime);
    error CheckInWindowMissed(uint256 deadline, uint256 currentTime);
    error DefaultTooEarly(uint256 deadline, uint256 currentTime);
    error InvalidCheckInOrdinal(uint32 ordinal, uint32 required);
    error RewardDepositMismatch(uint256 expected, uint256 sourceDelta, uint256 rewardsDelta);

    uint256 public immutable launchId;
    IERC20 public immutable token;
    address public immutable creator;
    address public immutable activator;
    IDoomRewardsV2 public immutable doomRewards;
    uint256 public immutable committedAmount;
    uint32 public immutable requiredCheckIns;
    uint32 public immutable cadenceSeconds;
    uint32 public immutable gracePeriodSeconds;

    uint64 public startTime;
    uint32 public completedCheckIns;
    uint256 public releasedAmount;
    Status public status;

    event EscrowCreated(uint256 indexed launchId, address indexed token, address indexed creator, address activator);
    event EscrowActivated(uint256 indexed launchId, uint64 startTime);
    event GmRecorded(uint256 indexed launchId, uint32 indexed ordinal, uint256 amount, uint64 recordedAt);
    event CommitmentCompleted(uint256 indexed launchId, uint256 releasedAmount, uint64 completedAt);
    event CommitmentDefaulted(uint256 indexed launchId, uint256 rewardAmount, uint64 defaultedAt);

    constructor(
        uint256 launchId_,
        address token_,
        address creator_,
        address activator_,
        address doomRewards_,
        uint256 committedAmount_,
        uint32 requiredCheckIns_,
        uint32 cadenceSeconds_,
        uint32 gracePeriodSeconds_
    ) {
        if (token_ == address(0) || creator_ == address(0) || activator_ == address(0) || doomRewards_ == address(0)) {
            revert ZeroAddress();
        }
        if (token_.code.length == 0) revert DependencyHasNoCode(token_);
        if (doomRewards_.code.length == 0) revert DependencyHasNoCode(doomRewards_);
        if (committedAmount_ == 0) revert ZeroAmount();
        if (
            requiredCheckIns_ == 0 || cadenceSeconds_ == 0 || gracePeriodSeconds_ == 0
                || gracePeriodSeconds_ >= cadenceSeconds_
        ) {
            revert InvalidConfiguration();
        }
        launchId = launchId_;
        token = IERC20(token_);
        creator = creator_;
        activator = activator_;
        doomRewards = IDoomRewardsV2(doomRewards_);
        committedAmount = committedAmount_;
        requiredCheckIns = requiredCheckIns_;
        cadenceSeconds = cadenceSeconds_;
        gracePeriodSeconds = gracePeriodSeconds_;
        emit EscrowCreated(launchId_, token_, creator_, activator_);
    }

    function activate() external {
        if (msg.sender != activator) revert OnlyActivator(msg.sender);
        if (status != Status.Pending) revert InvalidStatus(status);
        _requireFunded();
        uint256 finalDeadline = block.timestamp + uint256(requiredCheckIns) * cadenceSeconds + gracePeriodSeconds;
        if (finalDeadline > type(uint64).max) revert InvalidConfiguration();
        startTime = uint64(block.timestamp);
        status = Status.Active;
        emit EscrowActivated(launchId, startTime);
    }

    function scheduleFor(uint32 ordinal) public view returns (uint64 due, uint64 deadline) {
        if (ordinal == 0 || ordinal > requiredCheckIns) revert InvalidCheckInOrdinal(ordinal, requiredCheckIns);
        if (status == Status.Pending) return (0, 0);
        due = uint64(uint256(startTime) + uint256(ordinal) * cadenceSeconds);
        deadline = uint64(uint256(due) + gracePeriodSeconds);
    }

    function nextCheckInAt() public view returns (uint64) {
        if (status != Status.Active) return 0;
        (uint64 due,) = scheduleFor(completedCheckIns + 1);
        return due;
    }

    function nextDeadline() public view returns (uint64) {
        if (status != Status.Active) return 0;
        (, uint64 deadline) = scheduleFor(completedCheckIns + 1);
        return deadline;
    }

    function remainingAmount() public view returns (uint256) {
        return committedAmount - releasedAmount;
    }

    function releaseFor(uint32 ordinal) public view returns (uint256) {
        if (ordinal == 0 || ordinal > requiredCheckIns) revert InvalidCheckInOrdinal(ordinal, requiredCheckIns);
        if (ordinal == requiredCheckIns) {
            uint256 baseRelease = committedAmount / requiredCheckIns;
            return committedAmount - baseRelease * (requiredCheckIns - 1);
        }
        return committedAmount / requiredCheckIns;
    }

    function recordGm() external nonReentrant {
        if (msg.sender != creator) revert OnlyCreator(msg.sender);
        if (status != Status.Active) revert InvalidStatus(status);
        _requireFunded();
        uint256 due = nextCheckInAt();
        uint256 deadline = nextDeadline();
        // Chain time intentionally defines the public commitment window.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < due) revert CheckInTooEarly(due, block.timestamp);
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > deadline) revert CheckInWindowMissed(deadline, block.timestamp);

        uint32 ordinal = ++completedCheckIns;
        uint256 amount = releaseFor(ordinal);
        releasedAmount += amount;
        if (ordinal == requiredCheckIns) status = Status.Completed;
        token.safeTransfer(creator, amount);
        emit GmRecorded(launchId, ordinal, amount, uint64(block.timestamp));
        if (status == Status.Completed) emit CommitmentCompleted(launchId, releasedAmount, uint64(block.timestamp));
    }

    function finalizeDefault() external nonReentrant {
        if (status != Status.Active) revert InvalidStatus(status);
        _requireFunded();
        uint256 deadline = nextDeadline();
        // Default becomes valid only after the immutable onchain deadline.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp <= deadline) revert DefaultTooEarly(deadline, block.timestamp);
        status = Status.Defaulted;
        uint256 amount = remainingAmount();
        uint256 sourceBefore = token.balanceOf(address(this));
        uint256 rewardsBefore = token.balanceOf(address(doomRewards));
        token.forceApprove(address(doomRewards), amount);
        doomRewards.depositFailedAllocation(address(token), amount, launchId);
        token.forceApprove(address(doomRewards), 0);
        uint256 sourceDelta = sourceBefore - token.balanceOf(address(this));
        uint256 rewardsDelta = token.balanceOf(address(doomRewards)) - rewardsBefore;
        if (sourceDelta != amount || rewardsDelta != amount) {
            revert RewardDepositMismatch(amount, sourceDelta, rewardsDelta);
        }
        emit CommitmentDefaulted(launchId, amount, uint64(block.timestamp));
    }

    function _requireFunded() internal view {
        uint256 required = remainingAmount();
        uint256 balance = token.balanceOf(address(this));
        if (balance < required) revert EscrowNotFunded(required, balance);
    }
}
