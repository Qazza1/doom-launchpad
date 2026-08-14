// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DoomPublicLaunchFactoryV2} from "../src/DoomPublicLaunchFactoryV2.sol";
import {DoomLaunchDeployerV2} from "../src/DoomLaunchDeployerV2.sol";
import {DoomBondingCurve} from "../src/DoomBondingCurve.sol";
import {PositionLockerV2} from "../src/PositionLockerV2.sol";
import {V3GraduationManagerV2} from "../src/V3GraduationManagerV2.sol";
import {MockWrappedNativeV2, MockDoomRewardsV2, MockGraduationManagerV2} from "./mocks/ProtocolMocks.sol";
import {MockCanonicalV3FactoryV2, MockCanonicalPositionManagerV2} from "./mocks/CanonicalV3Mocks.sol";

contract PublicLaunchFactoryV2Test is Test {
    uint256 internal constant SUPPLY = 1_000_000_000 ether;

    address internal creatorOne = makeAddr("creator-one");
    address internal creatorTwo = makeAddr("creator-two");
    address internal treasury = makeAddr("treasury");
    address internal guardian = makeAddr("guardian");

    MockWrappedNativeV2 internal weth;
    MockDoomRewardsV2 internal rewards;
    MockGraduationManagerV2 internal manager;
    DoomLaunchDeployerV2 internal deployer;
    DoomPublicLaunchFactoryV2 internal factory;

    function setUp() public {
        weth = new MockWrappedNativeV2();
        rewards = new MockDoomRewardsV2(address(weth));
        manager = new MockGraduationManagerV2();
        deployer = new DoomLaunchDeployerV2(address(this));
        factory = new DoomPublicLaunchFactoryV2(
            DoomPublicLaunchFactoryV2.FactoryConfig({
                operator: address(this),
                emergencyGuardian: guardian,
                treasury: treasury,
                doomRewards: address(rewards),
                wrappedNative: address(weth),
                graduationManager: address(manager),
                curveDeployer: address(deployer)
            })
        );
        deployer.bindFactory(address(factory));
        vm.deal(creatorOne, 1 ether);
        vm.deal(creatorTwo, 1 ether);
    }

    function _params(string memory name, string memory symbol)
        internal
        pure
        returns (DoomPublicLaunchFactoryV2.LaunchParams memory)
    {
        return DoomPublicLaunchFactoryV2.LaunchParams(name, symbol, SUPPLY, "ipfs://metadata");
    }

    function testStartsPausedAtGlobalLaunchIdTwo() public view {
        assertTrue(factory.launchesPaused());
        assertEq(factory.FIRST_LAUNCH_ID(), 2);
        assertEq(factory.FINAL_LAUNCH_ID(), 100);
        assertEq(factory.MAX_LAUNCHES(), 99);
        assertEq(factory.nextLaunchId(), 2);
        assertEq(factory.launchCount(), 0);
    }

    function testAnyEoaCanLaunchWithoutOperatorPermission() public {
        factory.resumeLaunches();

        vm.prank(creatorOne, creatorOne);
        (uint256 firstId,,,) = factory.launch{value: 0.001 ether}(_params("First Public", "FIRST"));

        vm.prank(creatorTwo, creatorTwo);
        (uint256 secondId,,,) = factory.launch{value: 0.001 ether}(_params("Second Public", "SECOND"));

        assertEq(firstId, 2);
        assertEq(secondId, 3);
        assertEq(factory.launchCount(), 2);
        assertEq(factory.getLaunch(firstId).creator, creatorOne);
        assertEq(factory.getLaunch(secondId).creator, creatorTwo);
    }

    function testContractCallerCannotLaunch() public {
        factory.resumeLaunches();
        PublicLaunchCaller caller = new PublicLaunchCaller(factory);
        vm.deal(address(caller), 0.001 ether);
        vm.expectRevert(
            abi.encodeWithSelector(DoomPublicLaunchFactoryV2.ContractCreatorNotAllowed.selector, address(caller))
        );
        caller.launch{value: 0.001 ether}();
    }

    function testGuardianCanPauseButCannotResume() public {
        factory.resumeLaunches();
        vm.prank(guardian);
        factory.pauseLaunches();
        assertTrue(factory.launchesPaused());

        vm.expectRevert(abi.encodeWithSelector(DoomPublicLaunchFactoryV2.UnauthorizedOperator.selector, guardian));
        vm.prank(guardian);
        factory.resumeLaunches();
    }

    function testFinalLaunchIdIsOneHundred() public {
        factory.resumeLaunches();
        for (uint256 expectedId = 2; expectedId <= 100; ++expectedId) {
            // The bounded test identifier is far below uint160.max.
            // forge-lint: disable-next-line(unsafe-typecast)
            address creator = address(uint160(10_000 + expectedId));
            vm.deal(creator, 0.001 ether);
            vm.prank(creator, creator);
            (uint256 launchId,,,) = factory.launch{value: 0.001 ether}(_params("Public", "PUB"));
            assertEq(launchId, expectedId);
        }
        assertEq(factory.launchCount(), 99);
        assertEq(factory.nextLaunchId(), 101);

        vm.expectRevert(abi.encodeWithSelector(DoomPublicLaunchFactoryV2.LaunchLimitReached.selector, 100));
        vm.prank(creatorOne, creatorOne);
        factory.launch{value: 0.001 ether}(_params("Too Late", "LATE"));
    }
}

contract PublicLaunchCaller {
    DoomPublicLaunchFactoryV2 internal immutable factory;

    constructor(DoomPublicLaunchFactoryV2 factory_) {
        factory = factory_;
    }

    function launch() external payable {
        factory.launch{value: msg.value}(
            DoomPublicLaunchFactoryV2.LaunchParams("Contract", "BOT", 1_000_000_000 ether, "ipfs://metadata")
        );
    }
}

contract PublicLaunchGraduationV2Test is Test {
    uint256 internal constant SUPPLY = 1_000_000_000 ether;

    address internal creator = makeAddr("public-creator");
    address internal buyer = makeAddr("public-buyer");
    address internal treasury = makeAddr("public-treasury");
    address internal guardian = makeAddr("public-guardian");

    MockWrappedNativeV2 internal weth;
    MockDoomRewardsV2 internal rewards;
    MockCanonicalV3FactoryV2 internal v3Factory;
    MockCanonicalPositionManagerV2 internal positionManager;
    PositionLockerV2 internal locker;
    V3GraduationManagerV2 internal manager;
    DoomLaunchDeployerV2 internal deployer;
    DoomPublicLaunchFactoryV2 internal factory;

    function setUp() public {
        weth = new MockWrappedNativeV2();
        rewards = new MockDoomRewardsV2(address(weth));
        v3Factory = new MockCanonicalV3FactoryV2();
        positionManager = new MockCanonicalPositionManagerV2(address(v3Factory), address(weth));
        locker =
            new PositionLockerV2(address(positionManager), address(weth), address(rewards), treasury, address(this));
        manager = new V3GraduationManagerV2(
            block.chainid, address(this), address(v3Factory), address(positionManager), address(weth), address(locker)
        );
        deployer = new DoomLaunchDeployerV2(address(this));
        factory = new DoomPublicLaunchFactoryV2(
            DoomPublicLaunchFactoryV2.FactoryConfig({
                operator: address(this),
                emergencyGuardian: guardian,
                treasury: treasury,
                doomRewards: address(rewards),
                wrappedNative: address(weth),
                graduationManager: address(manager),
                curveDeployer: address(deployer)
            })
        );
        locker.bindRegistrar(address(manager));
        deployer.bindFactory(address(factory));
        manager.bindFactory(address(factory));
        factory.resumeLaunches();
        vm.deal(creator, 1 ether);
        vm.deal(buyer, 1 ether);
    }

    function testPermissionlessLaunchGraduatesIntoLockedCanonicalPosition() public {
        assertTrue(factory.isLaunchConfigurationValid());
        vm.prank(creator, creator);
        (uint256 launchId,, address curveAddress,) = factory.launch{value: 0.001 ether}(
            DoomPublicLaunchFactoryV2.LaunchParams("Public Graduate", "GRAD", SUPPLY, "ipfs://metadata")
        );
        DoomBondingCurve curve = DoomBondingCurve(payable(curveAddress));

        vm.prank(buyer);
        curve.buy{value: 1 ether}(0, block.timestamp);

        assertEq(launchId, 2);
        assertTrue(curve.graduated());
        assertTrue(locker.isPermanentlyLocked(curve.positionId()));
        assertEq(positionManager.ownerOf(curve.positionId()), address(locker));
    }
}
