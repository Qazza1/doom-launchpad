// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IDoomRewards} from "./interfaces/IDoomRewards.sol";

/// @title GmEscrow
/// @notice Per-launch creator allocation escrow with scheduled GM check-ins.
contract GmEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        Active,
        Completed,
        Defaulted
    }

    error ZeroAddress();
    error ZeroAmount();
    error InvalidCommitmentConfiguration();
    error DependencyHasNoCode(address dependency);
    error OnlyCreator(address caller);
    error CommitmentResolved(Status status);
    error EscrowNotFunded(uint256 expected, uint256 actual);
    error CheckInTooEarly(uint256 nextCheckInAt, uint256 currentTime);
    error CheckInWindowMissed(uint256 deadline, uint256 currentTime);
    error DefaultTooEarly(uint256 deadline, uint256 currentTime);
    error RewardDepositMismatch(uint256 expected, uint256 sourceDelta, uint256 rewardsDelta);
    error InvalidCheckInOrdinal(uint32 ordinal, uint32 required);

    uint256 public immutable launchId;
    IERC20 public immutable token;
    address public immutable creator;
    IDoomRewards public immutable doomRewards;
    uint256 public immutable committedAmount;
    uint64 public immutable startTime;
    uint32 public immutable requiredCheckIns;
    uint32 public immutable cadenceSeconds;
    uint32 public immutable gracePeriodSeconds;

    uint32 public completedCheckIns;
    /// @notice Tokens already released to the creator across completed check-ins.
    uint256 public releasedAmount;
    Status public status;

    event CommitmentCreated(
        uint256 indexed launchId,
        address indexed token,
        address indexed creator,
        uint256 committedAmount,
        uint64 startTime,
        uint32 requiredCheckIns,
        uint32 cadenceSeconds,
        uint32 gracePeriodSeconds
    );
    event GmRecorded(
        uint256 indexed launchId,
        address indexed token,
        address indexed creator,
        uint32 completedCheckIns,
        uint64 recordedAt,
        uint64 nextCheckInAt,
        uint64 nextDeadline
    );
    event EscrowReleased(
        uint256 indexed launchId,
        address indexed token,
        address indexed creator,
        uint32 checkIn,
        uint256 amount,
        uint256 releasedTotal,
        uint256 remaining
    );
    event CommitmentCompleted(
        uint256 indexed launchId,
        address indexed token,
        address indexed creator,
        uint256 releasedAmount,
        uint64 completedAt
    );
    event CommitmentDefaulted(
        uint256 indexed launchId,
        address indexed token,
        address indexed creator,
        uint256 rewardAmount,
        address doomRewards,
        uint64 defaultedAt
    );

    modifier onlyCreator() {
        if (msg.sender != creator) revert OnlyCreator(msg.sender);
        _;
    }

    constructor(
        uint256 launchId_,
        address token_,
        address creator_,
        address doomRewards_,
        uint256 committedAmount_,
        uint32 requiredCheckIns_,
        uint32 cadenceSeconds_,
        uint32 gracePeriodSeconds_
    ) {
        if (token_ == address(0) || creator_ == address(0) || doomRewards_ == address(0)) {
            revert ZeroAddress();
        }
        if (token_.code.length == 0) revert DependencyHasNoCode(token_);
        if (doomRewards_.code.length == 0) revert DependencyHasNoCode(doomRewards_);
        if (committedAmount_ == 0) revert ZeroAmount();
        if (
            requiredCheckIns_ == 0 || cadenceSeconds_ == 0 || gracePeriodSeconds_ == 0
                || gracePeriodSeconds_ >= cadenceSeconds_
        ) revert InvalidCommitmentConfiguration();
        uint256 finalDeadline =
            block.timestamp + uint256(requiredCheckIns_) * uint256(cadenceSeconds_) + uint256(gracePeriodSeconds_);
        if (finalDeadline > type(uint64).max) revert InvalidCommitmentConfiguration();

        launchId = launchId_;
        token = IERC20(token_);
        creator = creator_;
        doomRewards = IDoomRewards(doomRewards_);
        committedAmount = committedAmount_;
        startTime = uint64(block.timestamp);
        requiredCheckIns = requiredCheckIns_;
        cadenceSeconds = cadenceSeconds_;
        gracePeriodSeconds = gracePeriodSeconds_;

        emit CommitmentCreated(
            launchId_,
            token_,
            creator_,
            committedAmount_,
            uint64(block.timestamp),
            requiredCheckIns_,
            cadenceSeconds_,
            gracePeriodSeconds_
        );
    }

    /// @notice Scheduled time at which the next GM becomes recordable.
    function nextCheckInAt() public view returns (uint64) {
        if (status != Status.Active) return 0;
        (uint64 due,) = scheduleFor(completedCheckIns + 1);
        return due;
    }

    /// @notice Final timestamp accepted for the next GM.
    function nextDeadline() public view returns (uint64) {
        if (status != Status.Active) return 0;
        (, uint64 deadline) = scheduleFor(completedCheckIns + 1);
        return deadline;
    }

    /// @notice Returns the immutable due time and deadline for a configured check-in ordinal.
    function scheduleFor(uint32 ordinal) public view returns (uint64 due, uint64 deadline) {
        if (ordinal == 0 || ordinal > requiredCheckIns) {
            revert InvalidCheckInOrdinal(ordinal, requiredCheckIns);
        }
        due = uint64(uint256(startTime) + uint256(ordinal) * uint256(cadenceSeconds));
        deadline = uint64(uint256(due) + uint256(gracePeriodSeconds));
    }

    function remainingCheckIns() external view returns (uint32) {
        return status == Status.Active ? requiredCheckIns - completedCheckIns : 0;
    }

    /// @notice Escrowed tokens still held for the creator, and the amount a default would redirect.
    function remainingAmount() public view returns (uint256) {
        return committedAmount - releasedAmount;
    }

    /// @notice Tokens the given check-in ordinal releases.
    /// @dev The final ordinal releases whatever remains, so integer division cannot strand dust.
    function releaseFor(uint32 ordinal) public view returns (uint256) {
        if (ordinal == 0 || ordinal > requiredCheckIns) {
            revert InvalidCheckInOrdinal(ordinal, requiredCheckIns);
        }
        if (ordinal == requiredCheckIns) {
            return committedAmount - (committedAmount / requiredCheckIns) * (requiredCheckIns - 1);
        }
        return committedAmount / requiredCheckIns;
    }

    /// @notice Records one scheduled GM and releases that check-in's share of the escrow.
    function recordGm() external onlyCreator nonReentrant {
        if (status != Status.Active) revert CommitmentResolved(status);
        _requireFunded();

        uint256 due = nextCheckInAt();
        uint256 deadline = due + gracePeriodSeconds;
        // Chain time defines the public commitment window by design.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < due) revert CheckInTooEarly(due, block.timestamp);
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > deadline) revert CheckInWindowMissed(deadline, block.timestamp);

        uint32 checkIns = completedCheckIns + 1;
        completedCheckIns = checkIns;

        uint64 followingDue = 0;
        uint64 followingDeadline = 0;
        if (checkIns == requiredCheckIns) {
            status = Status.Completed;
        } else {
            followingDue = nextCheckInAt();
            followingDeadline = nextDeadline();
        }

        emit GmRecorded(
            launchId, address(token), creator, checkIns, uint64(block.timestamp), followingDue, followingDeadline
        );

        // Each check-in releases its own share, so the creator's holding grows as the commitment is
        // honoured instead of arriving as one cliff the market has to absorb on the final day.
        uint256 release = releaseFor(checkIns);
        uint256 releasedTotal = releasedAmount + release;
        releasedAmount = releasedTotal;
        token.safeTransfer(creator, release);
        emit EscrowReleased(
            launchId, address(token), creator, checkIns, release, releasedTotal, committedAmount - releasedTotal
        );

        if (checkIns == requiredCheckIns) {
            emit CommitmentCompleted(launchId, address(token), creator, releasedTotal, uint64(block.timestamp));
        }
    }

    /// @notice Permissionlessly finalizes a missed commitment after its grace period.
    function finalizeDefault() external nonReentrant {
        if (status != Status.Active) revert CommitmentResolved(status);
        _requireFunded();

        uint256 deadline = nextDeadline();
        // Default becomes valid only after the onchain deadline.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp <= deadline) revert DefaultTooEarly(deadline, block.timestamp);

        status = Status.Defaulted;

        // Only the unreleased remainder is redirected. Check-ins already honoured are not clawed back.
        uint256 forfeited = remainingAmount();

        uint256 sourceBalanceBefore = token.balanceOf(address(this));
        uint256 rewardsBalanceBefore = token.balanceOf(address(doomRewards));
        token.forceApprove(address(doomRewards), forfeited);
        doomRewards.depositFailedAllocation(address(token), forfeited, launchId);
        token.forceApprove(address(doomRewards), 0);

        uint256 sourceBalanceAfter = token.balanceOf(address(this));
        uint256 rewardsBalanceAfter = token.balanceOf(address(doomRewards));
        if (sourceBalanceAfter > sourceBalanceBefore || rewardsBalanceAfter < rewardsBalanceBefore) {
            revert RewardDepositMismatch(forfeited, 0, 0);
        }
        uint256 sourceDelta = sourceBalanceBefore - sourceBalanceAfter;
        uint256 rewardsDelta = rewardsBalanceAfter - rewardsBalanceBefore;
        if (sourceDelta != forfeited || rewardsDelta != forfeited) {
            revert RewardDepositMismatch(forfeited, sourceDelta, rewardsDelta);
        }

        emit CommitmentDefaulted(
            launchId, address(token), creator, forfeited, address(doomRewards), uint64(block.timestamp)
        );
    }

    function _requireFunded() internal view {
        uint256 required = remainingAmount();
        uint256 balance = token.balanceOf(address(this));
        if (balance < required) revert EscrowNotFunded(required, balance);
    }
}
