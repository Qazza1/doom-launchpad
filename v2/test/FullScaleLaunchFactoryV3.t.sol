// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DoomFullScaleLaunchFactoryV3} from "../src/DoomFullScaleLaunchFactoryV3.sol";
import {DoomLaunchDeployerV2} from "../src/DoomLaunchDeployerV2.sol";
import {DoomBondingCurve} from "../src/DoomBondingCurve.sol";
import {PositionLockerV2} from "../src/PositionLockerV2.sol";
import {V3GraduationManagerV2} from "../src/V3GraduationManagerV2.sol";
import {MockWrappedNativeV2, MockDoomRewardsV2, MockGraduationManagerV2} from "./mocks/ProtocolMocks.sol";
import {MockCanonicalV3FactoryV2, MockCanonicalPositionManagerV2} from "./mocks/CanonicalV3Mocks.sol";

contract FullScaleLaunchFactoryV3Test is Test {
    uint256 internal constant SUPPLY = 1_000_000_000 ether;

    address internal creatorOne = makeAddr("fullscale-creator-one");
    address internal creatorTwo = makeAddr("fullscale-creator-two");
    address internal treasury = makeAddr("fullscale-treasury");
    address internal guardian = makeAddr("fullscale-guardian");

    MockWrappedNativeV2 internal weth;
    MockDoomRewardsV2 internal rewards;
    MockGraduationManagerV2 internal manager;
    DoomLaunchDeployerV2 internal deployer;
    DoomFullScaleLaunchFactoryV3 internal factory;

    function setUp() public {
        weth = new MockWrappedNativeV2();
        rewards = new MockDoomRewardsV2(address(weth));
        manager = new MockGraduationManagerV2();
        deployer = new DoomLaunchDeployerV2(address(this));
        factory = new DoomFullScaleLaunchFactoryV3(
            DoomFullScaleLaunchFactoryV3.FactoryConfig({
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
        returns (DoomFullScaleLaunchFactoryV3.LaunchParams memory)
    {
        return DoomFullScaleLaunchFactoryV3.LaunchParams(name, symbol, SUPPLY, "ipfs://metadata");
    }

    function testPermanentGenerationStartsPausedAtGlobalLaunchIdOneHundredOne() public view {
        assertTrue(factory.launchesPaused());
        assertTrue(factory.UNBOUNDED_LAUNCHES());
        assertEq(factory.FIRST_LAUNCH_ID(), 101);
        assertEq(factory.nextLaunchId(), 101);
        assertEq(factory.launchCount(), 0);
    }

    function testAnyEoaCanLaunchSequentiallyWithoutAnOperatorAllowlist() public {
        factory.resumeLaunches();

        vm.prank(creatorOne, creatorOne);
        (uint256 firstId,,,) = factory.launch{value: 0.001 ether}(_params("First Full Scale", "FULL"));

        vm.prank(creatorTwo, creatorTwo);
        (uint256 secondId,,,) = factory.launch{value: 0.001 ether}(_params("Second Full Scale", "SCALE"));

        assertEq(firstId, 101);
        assertEq(secondId, 102);
        assertEq(factory.nextLaunchId(), 103);
        assertEq(factory.launchCount(), 2);
        assertEq(factory.getLaunch(firstId).creator, creatorOne);
        assertEq(factory.getLaunch(secondId).creator, creatorTwo);
    }

    function testContractCallerCannotLaunch() public {
        factory.resumeLaunches();
        FullScaleLaunchCaller caller = new FullScaleLaunchCaller(factory);
        vm.deal(address(caller), 0.001 ether);
        vm.expectRevert(
            abi.encodeWithSelector(DoomFullScaleLaunchFactoryV3.ContractCreatorNotAllowed.selector, address(caller))
        );
        caller.launch{value: 0.001 ether}();
    }

    function testGuardianCanPauseButCannotResume() public {
        factory.resumeLaunches();
        vm.prank(guardian);
        factory.pauseLaunches();
        assertTrue(factory.launchesPaused());

        vm.expectRevert(abi.encodeWithSelector(DoomFullScaleLaunchFactoryV3.UnauthorizedOperator.selector, guardian));
        vm.prank(guardian);
        factory.resumeLaunches();
    }
}

contract FullScaleLaunchCaller {
    DoomFullScaleLaunchFactoryV3 internal immutable factory;

    constructor(DoomFullScaleLaunchFactoryV3 factory_) {
        factory = factory_;
    }

    function launch() external payable {
        factory.launch{value: msg.value}(
            DoomFullScaleLaunchFactoryV3.LaunchParams("Contract", "BOT", 1_000_000_000 ether, "ipfs://metadata")
        );
    }
}

contract FullScaleLaunchGraduationV3Test is Test {
    uint256 internal constant SUPPLY = 1_000_000_000 ether;

    address internal creator = makeAddr("fullscale-creator");
    address internal buyer = makeAddr("fullscale-buyer");
    address internal treasury = makeAddr("fullscale-treasury");
    address internal guardian = makeAddr("fullscale-guardian");

    MockWrappedNativeV2 internal weth;
    MockDoomRewardsV2 internal rewards;
    MockCanonicalV3FactoryV2 internal v3Factory;
    MockCanonicalPositionManagerV2 internal positionManager;
    PositionLockerV2 internal locker;
    V3GraduationManagerV2 internal manager;
    DoomLaunchDeployerV2 internal deployer;
    DoomFullScaleLaunchFactoryV3 internal factory;

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
        factory = new DoomFullScaleLaunchFactoryV3(
            DoomFullScaleLaunchFactoryV3.FactoryConfig({
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

    function testFullScaleLaunchGraduatesIntoLockedCanonicalPosition() public {
        assertTrue(factory.isLaunchConfigurationValid());
        vm.prank(creator, creator);
        (uint256 launchId,, address curveAddress,) = factory.launch{value: 0.001 ether}(
            DoomFullScaleLaunchFactoryV3.LaunchParams("Full Scale Graduate", "FINAL", SUPPLY, "ipfs://metadata")
        );
        DoomBondingCurve curve = DoomBondingCurve(payable(curveAddress));

        vm.prank(buyer);
        curve.buy{value: 1 ether}(0, block.timestamp);

        assertEq(launchId, 101);
        assertTrue(curve.graduated());
        assertTrue(locker.isPermanentlyLocked(curve.positionId()));
        assertEq(positionManager.ownerOf(curve.positionId()), address(locker));
    }
}
