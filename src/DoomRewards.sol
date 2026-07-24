// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title DoomRewards
/// @notice Isolated vault for failed creator allocations and NFT-holder fee rewards.
/// @dev Eligibility snapshots and per-NFT allocations are committed by Merkle root. The configured
///      excluded holder can never claim, even if mistakenly included in a root.
contract DoomRewards is ReentrancyGuard {
    using SafeERC20 for IERC20;

    error ZeroAddress();
    error ZeroAmount();
    error DependencyHasNoCode(address dependency);
    error InvalidMerkleRoot();
    error InvalidFeeRewardToken(address expected, address supplied);
    error ClaimWindowTooShort(uint256 minimumDeadline, uint256 suppliedDeadline);
    error InsufficientAvailableRewards(address token, uint256 available, uint256 requested);
    error UnauthorizedCampaignManager(address caller);
    error UnknownCampaign(uint256 campaignId);
    error CampaignExpired(uint256 campaignId, uint256 deadline);
    error CampaignStillActive(uint256 campaignId, uint256 deadline);
    error CampaignAlreadyRecycled(uint256 campaignId);
    error AlreadyClaimed(uint256 campaignId, address account);
    error ExcludedRewardAccount(address account);
    error InvalidProof(uint256 campaignId, address account, uint256 amount);
    error ClaimExceedsRemaining(uint256 campaignId, uint256 remaining, uint256 requested);
    error UnsupportedTokenTransferBehavior(address token, uint256 expected, uint256 received);

    struct Campaign {
        address token;
        bytes32 merkleRoot;
        uint256 totalAllocation;
        uint256 claimedAmount;
        uint64 claimDeadline;
        bool recycled;
    }

    address public immutable campaignManager;
    address public immutable nftCollection;
    address public immutable excludedHolder;
    address public immutable feeRewardToken;
    uint64 public immutable minimumClaimWindow;

    uint256 public nextCampaignId = 1;
    mapping(address token => uint256 amount) public availableRewards;
    mapping(address token => uint256 amount) public reservedRewards;
    mapping(uint256 campaignId => Campaign campaign) public campaigns;
    mapping(uint256 campaignId => mapping(address account => bool claimed)) public hasClaimed;

    event FailedAllocationDeposited(
        uint256 indexed launchId, address indexed token, address indexed source, uint256 amount, uint256 availableAfter
    );
    event FeeRewardsDeposited(
        uint256 indexed launchId, address indexed token, address indexed source, uint256 amount, uint256 availableAfter
    );
    event LiquidityRemainderDeposited(
        uint256 indexed launchId, address indexed token, address indexed source, uint256 amount, uint256 availableAfter
    );
    event CampaignCreated(
        uint256 indexed campaignId,
        address indexed token,
        bytes32 indexed merkleRoot,
        uint256 allocation,
        uint64 claimDeadline
    );
    event RewardClaimed(uint256 indexed campaignId, address indexed token, address indexed account, uint256 amount);
    event UnclaimedRewardsRecycled(
        uint256 indexed campaignId, address indexed token, uint256 amount, uint256 availableAfter
    );

    modifier onlyCampaignManager() {
        if (msg.sender != campaignManager) revert UnauthorizedCampaignManager(msg.sender);
        _;
    }

    constructor(
        address campaignManager_,
        address nftCollection_,
        address excludedHolder_,
        address feeRewardToken_,
        uint64 minimumClaimWindow_
    ) {
        if (
            campaignManager_ == address(0) || nftCollection_ == address(0) || excludedHolder_ == address(0)
                || feeRewardToken_ == address(0)
        ) revert ZeroAddress();
        if (nftCollection_.code.length == 0) revert DependencyHasNoCode(nftCollection_);
        if (feeRewardToken_.code.length == 0) revert DependencyHasNoCode(feeRewardToken_);
        if (minimumClaimWindow_ == 0) revert ClaimWindowTooShort(1, 0);

        campaignManager = campaignManager_;
        nftCollection = nftCollection_;
        excludedHolder = excludedHolder_;
        feeRewardToken = feeRewardToken_;
        minimumClaimWindow = minimumClaimWindow_;
    }

    /// @notice Deposits a failed GM allocation into isolated reward inventory.
    function depositFailedAllocation(address token, uint256 amount, uint256 launchId) external nonReentrant {
        uint256 availableAfter = _pullReward(token, amount);
        emit FailedAllocationDeposited(launchId, token, msg.sender, amount, availableAfter);
    }

    /// @notice Deposits the wrapped-native NFT share of a launch fee.
    function depositFeeRewards(address token, uint256 amount, uint256 launchId) external nonReentrant {
        if (token != feeRewardToken) revert InvalidFeeRewardToken(feeRewardToken, token);
        uint256 availableAfter = _pullReward(token, amount);
        emit FeeRewardsDeposited(launchId, token, msg.sender, amount, availableAfter);
    }

    /// @notice Deposits bounded token dust that Uniswap V3 could not consume into community rewards.
    function depositLiquidityRemainder(address token, uint256 amount, uint256 launchId) external nonReentrant {
        uint256 availableAfter = _pullReward(token, amount);
        emit LiquidityRemainderDeposited(launchId, token, msg.sender, amount, availableAfter);
    }

    /// @notice Reserves deposited inventory for an NFT-holder Merkle campaign.
    function createCampaign(address token, bytes32 merkleRoot, uint256 allocation, uint64 claimDeadline)
        external
        onlyCampaignManager
        returns (uint256 campaignId)
    {
        if (token == address(0)) revert ZeroAddress();
        if (merkleRoot == bytes32(0)) revert InvalidMerkleRoot();
        if (allocation == 0) revert ZeroAmount();

        uint256 minimumDeadline = block.timestamp + minimumClaimWindow;
        if (claimDeadline < minimumDeadline) {
            revert ClaimWindowTooShort(minimumDeadline, claimDeadline);
        }

        uint256 available = availableRewards[token];
        if (available < allocation) {
            revert InsufficientAvailableRewards(token, available, allocation);
        }

        availableRewards[token] = available - allocation;
        reservedRewards[token] += allocation;

        campaignId = nextCampaignId++;
        campaigns[campaignId] = Campaign({
            token: token,
            merkleRoot: merkleRoot,
            totalAllocation: allocation,
            claimedAmount: 0,
            claimDeadline: claimDeadline,
            recycled: false
        });

        emit CampaignCreated(campaignId, token, merkleRoot, allocation, claimDeadline);
    }

    /// @notice Claims an allocation for `account`; relayers are allowed.
    function claim(uint256 campaignId, address account, uint256 amount, bytes32[] calldata proof)
        external
        nonReentrant
    {
        Campaign storage campaign = campaigns[campaignId];
        if (campaign.token == address(0)) revert UnknownCampaign(campaignId);
        if (block.timestamp > campaign.claimDeadline) {
            revert CampaignExpired(campaignId, campaign.claimDeadline);
        }
        if (hasClaimed[campaignId][account]) revert AlreadyClaimed(campaignId, account);
        if (account == address(0)) revert ZeroAddress();
        if (account == excludedHolder) revert ExcludedRewardAccount(account);
        if (amount == 0) revert ZeroAmount();

        uint256 remaining = campaign.totalAllocation - campaign.claimedAmount;
        if (amount > remaining) {
            revert ClaimExceedsRemaining(campaignId, remaining, amount);
        }

        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(account, amount))));
        if (!MerkleProof.verifyCalldata(proof, campaign.merkleRoot, leaf)) {
            revert InvalidProof(campaignId, account, amount);
        }

        hasClaimed[campaignId][account] = true;
        campaign.claimedAmount += amount;
        reservedRewards[campaign.token] -= amount;

        IERC20(campaign.token).safeTransfer(account, amount);
        emit RewardClaimed(campaignId, campaign.token, account, amount);
    }

    /// @notice Returns expired, unclaimed inventory to this vault's available balance.
    function recycleUnclaimed(uint256 campaignId) external nonReentrant {
        Campaign storage campaign = campaigns[campaignId];
        if (campaign.token == address(0)) revert UnknownCampaign(campaignId);
        if (block.timestamp <= campaign.claimDeadline) {
            revert CampaignStillActive(campaignId, campaign.claimDeadline);
        }
        if (campaign.recycled) revert CampaignAlreadyRecycled(campaignId);

        campaign.recycled = true;
        uint256 remaining = campaign.totalAllocation - campaign.claimedAmount;
        reservedRewards[campaign.token] -= remaining;
        uint256 availableAfter = availableRewards[campaign.token] + remaining;
        availableRewards[campaign.token] = availableAfter;

        emit UnclaimedRewardsRecycled(campaignId, campaign.token, remaining, availableAfter);
    }

    function _pullReward(address token, uint256 amount) internal returns (uint256 availableAfter) {
        if (token == address(0)) revert ZeroAddress();
        if (token.code.length == 0) revert DependencyHasNoCode(token);
        if (amount == 0) revert ZeroAmount();

        IERC20 rewardToken = IERC20(token);
        uint256 balanceBefore = rewardToken.balanceOf(address(this));
        rewardToken.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = rewardToken.balanceOf(address(this)) - balanceBefore;
        if (received != amount) revert UnsupportedTokenTransferBehavior(token, amount, received);

        availableAfter = availableRewards[token] + amount;
        availableRewards[token] = availableAfter;
    }
}
