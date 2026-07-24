// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IUniswapV3Factory} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import {DoomLaunchFactory} from "../../src/DoomLaunchFactory.sol";
import {DoomRewards} from "../../src/DoomRewards.sol";
import {PositionLocker} from "../../src/PositionLocker.sol";
import {V3LiquidityManager} from "../../src/V3LiquidityManager.sol";

contract V3RobinhoodForkTest is Test {
    uint256 internal constant CHAIN_ID = 4663;
    address internal constant NFT = 0xB1b37dca046d0e70D9F5de673202D69c7DEF9be6;
    address internal constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address internal constant V3_FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address internal constant NPM = 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3;

    function testRobinhoodCanonicalV3LaunchAndLock() external {
        if (!vm.envOr("RUN_ROBINHOOD_FORK_TESTS", false)) {
            vm.skip(true, "set RUN_ROBINHOOD_FORK_TESTS=true to run the live dependency fork test");
        }
        vm.createSelectFork("robinhood_mainnet");
        assertEq(block.chainid, CHAIN_ID);

        address creator = makeAddr("forkCreator");
        address treasury = makeAddr("forkTreasury");
        address campaignManager = makeAddr("forkCampaignManager");
        address guardian = makeAddr("forkGuardian");

        DoomRewards rewards = new DoomRewards(campaignManager, NFT, treasury, WETH, 7 days);
        PositionLocker locker = new PositionLocker(NPM, WETH, address(rewards), treasury, address(this));
        V3LiquidityManager manager =
            new V3LiquidityManager(CHAIN_ID, address(this), V3_FACTORY, NPM, WETH, address(locker));
        locker.bindRegistrar(address(manager));

        DoomLaunchFactory.FactoryConfig memory config = DoomLaunchFactory.FactoryConfig({
            operator: address(this),
            emergencyGuardian: guardian,
            approvedCreator: creator,
            treasury: treasury,
            doomRewards: address(rewards),
            wrappedNative: WETH,
            liquidityManager: address(manager),
            positionLocker: address(locker),
            maxLaunches: 3,
            maxNativeLiquidityPerLaunch: 0.01 ether,
            maxNativeLiquidityGlobal: 0.03 ether
        });
        DoomLaunchFactory launchFactory = new DoomLaunchFactory(config);
        manager.bindFactory(address(launchFactory));
        launchFactory.resumeLaunches();
        assertTrue(manager.isNetworkConfigurationValid());

        DoomLaunchFactory.LaunchParams memory params = DoomLaunchFactory.LaunchParams({
            name: "Doom Fork Canary", symbol: "DFC", totalSupply: 1_000_000_000 ether, nativeLiquidityAmount: 0.01 ether
        });
        vm.deal(creator, 1 ether);
        vm.prank(creator);
        (uint256 launchId, address token, address pool, uint256 positionId,) =
            launchFactory.launch{value: 0.0103 ether}(params);

        DoomLaunchFactory.LaunchRecord memory record = launchFactory.getLaunch(launchId);
        assertEq(pool, IUniswapV3Factory(V3_FACTORY).getPool(token, WETH, 10_000));
        assertEq(IERC721(NPM).ownerOf(positionId), address(locker));
        assertTrue(locker.isPermanentlyLocked(positionId));
        assertTrue(record.liquidityPermanent);
        assertGe(record.liquidityTokenAmountUsed, record.liquidityTokenAmountAllocated * 999_999 / 1_000_000);
        assertGe(record.nativeLiquidityAmountUsed, 0.01 ether * 999_999 / 1_000_000);
        assertEq(address(manager).balance, 0);
        assertEq(record.creationFee, record.nativeLiquidityAmountUsed * 300 / 10_000);
        assertGt(rewards.availableRewards(WETH), 0);

        (uint256 launchTokenFees, uint256 wethFees, uint256 creatorWeth, uint256 treasuryWeth, uint256 rewardsWeth) =
            locker.collectFees(positionId);
        assertEq(launchTokenFees, 0);
        assertEq(wethFees, 0);
        assertEq(creatorWeth + treasuryWeth + rewardsWeth, 0);
        assertEq(IERC721(NPM).ownerOf(positionId), address(locker));
    }
}
