# Test Matrix

These tests are authored but were not executed in this sandbox because the Foundry/Solidity toolchain and dependency downloads were unavailable.

| Requirement | Test coverage |
|---|---|
| Fixed supply/no owner mint | `DoomToken.t.sol` |
| Untaxed exact transfers | `DoomToken.t.sol::testTransfersAreUntaxedAndExact` |
| Factory happy path | `DoomLaunchFactory.t.sol::testHappyPathLaunchCreatesExplicitAllocationsAndLockedPosition` |
| Supply/allocation/commitment/lock/price validation | factory input-validation tests in `DoomLaunchFactory.t.sol` |
| Insufficient native value and overflow | `testInsufficientNativeValueFails`, `testNativeValueOverflowFailsWithCustomError` |
| Maximum supply arithmetic | `testMaximumUintSupplyAllocationMathDoesNotOverflow` |
| Escrow completion | `GmEscrow.t.sol::testCreatorCompletesCommitment` |
| Early creator unlock blocked | `GmEscrow.t.sol::testCreatorCannotUnlockEarly` |
| Early default blocked | `GmEscrow.t.sol::testDefaultCannotHappenEarly` |
| Deadline boundary | `testGmAcceptedAtExactDeadlineAndDefaultStillBlocked`, `testDefaultBecomesAvailableOneSecondAfterDeadline` |
| Scheduled cadence does not drift | `testLateCheckInDoesNotShiftNextSchedule` |
| Late check-in rejected | `testCheckInAfterDeadlineFails` |
| No double completion/default | `testNoDoubleCompletion`, `testNoDoubleDefault` |
| Failed allocation reaches rewards | `testPermissionlessDefaultFundsRewards` |
| Failed deposit cannot silently succeed | `testRewardVaultCannotSilentlySkipDeposit` |
| LP withdrawal blocked before unlock | `PositionLocker.t.sol::testPositionCannotBeWithdrawnBeforeUnlock` |
| Permissionless post-unlock release | `testPermissionlessReleasePaysPrecommittedBeneficiary` |
| Merkle claim | `DoomRewards.t.sol::testMerkleClaimAndNoDoubleClaim` |
| Invalid proof/double claim | `testInvalidProofFails`, `testMerkleClaimAndNoDoubleClaim` |
| Reward deadline and reservation bounds | `testClaimAfterDeadlineFails`, `testCannotSweepBeforeDeadline`, `testCampaignCannotReserveMoreThanAvailable` |
| Reward accounting fuzz | `testFuzzClaimAccounting` |
| Unclaimed treatment | `testUnclaimedRewardsFollowExplicitTreatment` |
| Invalid V3 configuration | `DoomLaunchFactory.t.sol::testInvalidUniswapConfigurationFailsSafely` |
| Invalid fee/ticks | `testUnsupportedFeeTierFails`, `testBadTickAlignmentFails` |
| Spoofed locker metadata | `testSpoofedLockerTermsFailSafely` |
| Returned pool must be a contract | `testReturnedPoolMustContainCode` |
| Locker self-beneficiary rejected | `PositionLocker.t.sol::testLockerCannotBeItsOwnReleaseBeneficiary` |
| Fee/refund accounting | `testFeeAndRefundAccounting` |
| Native payout failure | `testTreasuryPayoutUsesSafeCallAndDoesNotSilentlyFail` |
| Reentrancy | `testReentrantManagerCannotReenterLaunch`, `testRewardVaultCannotReenterDefault` |
| Permissions | creator, campaign-manager, and treasury authorization tests |
| Allocation fuzz invariant | `testFuzzAllocationAccounting` (512 configured runs) |
| Stateful supply/accounting invariants | `SupplyAndAccounting.invariant.t.sol` |

## Required additions after V3 implementation

- Robinhood Chain fork tests for pool creation, token ordering, price initialization, every supported fee tier, NFT ownership, lock registration, native wrapping, refunds, dust, existing-pool handling, and malformed dependency addresses.
- Differential tick/price tests against the exact V3 deployment libraries.
- Concrete manager reentrancy/malicious-token tests.
- Gas and bytecode-size reports.
