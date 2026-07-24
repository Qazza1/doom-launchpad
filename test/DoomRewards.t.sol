// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DoomToken} from "../src/DoomToken.sol";
import {DoomRewards} from "../src/DoomRewards.sol";
import {MockWrappedNative, MockNftCollection} from "./mocks/MockWrappedNative.sol";

contract DoomRewardsTest is Test {
    DoomToken internal token;
    DoomRewards internal rewards;
    MockWrappedNative internal weth;
    MockNftCollection internal nft;
    address internal manager = makeAddr("manager");
    address internal treasury = makeAddr("treasury");
    address internal holder = makeAddr("nftHolder");
    uint256 internal constant REWARD = 100 ether;

    function setUp() external {
        token = new DoomToken("Doom", "DOOM", 1_000_000 ether, address(this));
        weth = new MockWrappedNative();
        nft = new MockNftCollection();
        rewards = new DoomRewards(manager, address(nft), treasury, address(weth), 7 days);
        token.approve(address(rewards), 1_000 ether);
        rewards.depositFailedAllocation(address(token), 1_000 ether, 7);
    }

    function _leaf(uint256 campaignId, address account, uint256 amount) internal view returns (bytes32) {
        return rewards.rewardLeaf(campaignId, account, amount);
    }

    function _hashPair(bytes32 left, bytes32 right) internal pure returns (bytes32) {
        return left < right ? keccak256(abi.encodePacked(left, right)) : keccak256(abi.encodePacked(right, left));
    }

    function _createCampaign(address account, uint256 amount) internal returns (uint256) {
        uint256 campaignId = rewards.nextCampaignId();
        bytes32 root = _leaf(campaignId, account, amount);
        vm.prank(manager);
        return rewards.createCampaign(address(token), root, 1_000 ether, uint64(block.timestamp + 7 days));
    }

    function testMerkleClaimAndNoDoubleClaim() external {
        uint256 campaignId = _createCampaign(holder, REWARD);
        bytes32[] memory proof = new bytes32[](0);

        rewards.claim(campaignId, holder, REWARD, proof);
        assertEq(token.balanceOf(holder), REWARD);

        vm.expectPartialRevert(DoomRewards.AlreadyClaimed.selector);
        rewards.claim(campaignId, holder, REWARD, proof);
    }

    function testOpenZeppelinStandardMerkleTreeTwoLeafRoundTrip() external {
        address secondHolder = makeAddr("secondNftHolder");
        uint256 holderAmount = 666 ether;
        uint256 secondAmount = 333 ether;
        uint256 campaignId = rewards.nextCampaignId();
        bytes32 holderLeaf = _leaf(campaignId, holder, holderAmount);
        bytes32 secondLeaf = _leaf(campaignId, secondHolder, secondAmount);
        bytes32 root = _hashPair(holderLeaf, secondLeaf);

        vm.prank(manager);
        rewards.createCampaign(address(token), root, holderAmount + secondAmount, uint64(block.timestamp + 7 days));

        bytes32[] memory holderProof = new bytes32[](1);
        holderProof[0] = secondLeaf;
        rewards.claim(campaignId, holder, holderAmount, holderProof);

        bytes32[] memory secondProof = new bytes32[](1);
        secondProof[0] = holderLeaf;
        rewards.claim(campaignId, secondHolder, secondAmount, secondProof);

        assertEq(token.balanceOf(holder), holderAmount);
        assertEq(token.balanceOf(secondHolder), secondAmount);
        assertEq(rewards.reservedRewards(address(token)), 0);
        assertEq(rewards.availableRewards(address(token)), 1 ether);
    }

    function testExcludedTreasuryCannotClaimEvenIfIncludedInRoot() external {
        uint256 campaignId = _createCampaign(treasury, REWARD);
        bytes32[] memory proof = new bytes32[](0);

        vm.expectRevert(abi.encodeWithSelector(DoomRewards.ExcludedRewardAccount.selector, treasury));
        rewards.claim(campaignId, treasury, REWARD, proof);
    }

    function testInvalidProofFails() external {
        uint256 campaignId = _createCampaign(holder, REWARD);
        bytes32[] memory proof = new bytes32[](0);

        vm.expectPartialRevert(DoomRewards.InvalidProof.selector);
        rewards.claim(campaignId, makeAddr("wrong"), REWARD, proof);
    }

    function testOnlyCampaignManagerCanCreateCampaign() external {
        bytes32 root = _leaf(rewards.nextCampaignId(), holder, REWARD);
        vm.expectPartialRevert(DoomRewards.UnauthorizedCampaignManager.selector);
        rewards.createCampaign(address(token), root, 1_000 ether, uint64(block.timestamp + 7 days));
    }

    function testCampaignCannotReserveMoreThanAvailable() external {
        bytes32 root = _leaf(rewards.nextCampaignId(), holder, REWARD);
        vm.prank(manager);
        vm.expectPartialRevert(DoomRewards.InsufficientAvailableRewards.selector);
        rewards.createCampaign(address(token), root, 1_001 ether, uint64(block.timestamp + 7 days));
    }

    function testClaimAfterDeadlineFails() external {
        uint256 campaignId = _createCampaign(holder, REWARD);
        vm.warp(block.timestamp + 7 days + 1);

        bytes32[] memory proof = new bytes32[](0);
        vm.expectPartialRevert(DoomRewards.CampaignExpired.selector);
        rewards.claim(campaignId, holder, REWARD, proof);
    }

    function testCannotRecycleBeforeDeadline() external {
        uint256 campaignId = _createCampaign(holder, REWARD);

        vm.expectPartialRevert(DoomRewards.CampaignStillActive.selector);
        rewards.recycleUnclaimed(campaignId);
    }

    function testFuzzClaimAccounting(uint96 rawAmount) external {
        uint256 amount = bound(uint256(rawAmount), 1, 1_000 ether);
        uint256 campaignId = _createCampaign(holder, amount);

        bytes32[] memory proof = new bytes32[](0);
        rewards.claim(campaignId, holder, amount, proof);

        assertEq(token.balanceOf(address(rewards)), rewards.reservedRewards(address(token)));
        assertEq(rewards.availableRewards(address(token)), 0);
        assertEq(rewards.reservedRewards(address(token)), 1_000 ether - amount);
    }

    function testUnclaimedRewardsRecycleInsideVault() external {
        uint256 campaignId = _createCampaign(holder, REWARD);
        vm.warp(block.timestamp + 7 days + 1);
        rewards.recycleUnclaimed(campaignId);

        assertEq(token.balanceOf(address(rewards)), 1_000 ether);
        assertEq(rewards.reservedRewards(address(token)), 0);
        assertEq(rewards.availableRewards(address(token)), 1_000 ether);

        vm.expectPartialRevert(DoomRewards.CampaignAlreadyRecycled.selector);
        rewards.recycleUnclaimed(campaignId);
    }

    function testFeeRewardsMustUseConfiguredWrappedNative() external {
        vm.deal(address(this), 5 ether);
        weth.deposit{value: 5 ether}();
        weth.approve(address(rewards), 5 ether);
        rewards.depositFeeRewards(address(weth), 5 ether, 9);

        assertEq(rewards.availableRewards(address(weth)), 5 ether);
        assertEq(weth.balanceOf(address(rewards)), 5 ether);

        vm.expectPartialRevert(DoomRewards.InvalidFeeRewardToken.selector);
        rewards.depositFeeRewards(address(token), 1 ether, 10);
    }
}
