// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IDoomRewardsV2} from "./interfaces/IDoomRewardsV2.sol";
import {IWrappedNativeV2} from "./interfaces/IWrappedNativeV2.sol";
import {ILaunchDeployerV2} from "./interfaces/ILaunchDeployerV2.sol";

interface IPublicGraduationManagerHealthV2 {
    function isNetworkConfigurationValid() external view returns (bool);
    function initializeLaunchPool(address curve) external returns (address pool);
}

/// @title DoomPublicLaunchFactoryV2
/// @notice Permissionless EOA launch factory for public launches 2 through 100.
/// @dev Launch ID 1 remains reserved for the immutable Genesis Beta factory.
contract DoomPublicLaunchFactoryV2 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant LAUNCH_FEE = 0.001 ether;
    uint256 public constant FIRST_LAUNCH_ID = 2;
    uint256 public constant FINAL_LAUNCH_ID = 100;
    uint256 public constant MAX_LAUNCHES = FINAL_LAUNCH_ID - FIRST_LAUNCH_ID + 1;
    uint256 public constant MIN_TOTAL_SUPPLY = 1_000_000 ether;
    uint256 public constant MAX_TOTAL_SUPPLY = 1_000_000_000_000_000 ether;
    uint256 public constant BPS = 10_000;
    uint256 public constant ESCROW_TOKEN_BPS = 6_000;
    uint256 public constant CURVE_AND_LP_TOKEN_BPS = 4_000;

    error ZeroAddress();
    error DependencyHasNoCode(address dependency);
    error UnauthorizedOperator(address caller);
    error UnauthorizedTreasury(address caller);
    error UnauthorizedPauseCaller(address caller);
    error ContractCreatorNotAllowed(address creator);
    error LaunchesArePaused();
    error LaunchesAlreadyPaused();
    error LaunchesAlreadyActive();
    error LaunchLimitReached(uint256 finalLaunchId);
    error InvalidLaunchFee(uint256 expected, uint256 supplied);
    error InvalidNameLength(uint256 length);
    error InvalidSymbolLength(uint256 length);
    error InvalidMetadataLength(uint256 length);
    error InvalidSupply();
    error SupplyOutsideBounds(uint256 minimum, uint256 maximum, uint256 supplied);
    error FractionalSupplyNotAllowed(uint256 supplied);
    error InvalidRewardsToken(address expected, address actual);
    error InvalidLiquidityConfiguration();
    error AllocationMismatch(uint256 expected, uint256 actual);
    error WrappedRewardDepositMismatch(uint256 expected, uint256 actual);
    error InsufficientAccruedFees(uint256 available, uint256 requested);
    error NativeTransferFailed(address recipient, uint256 amount);

    struct FactoryConfig {
        address operator;
        address emergencyGuardian;
        address treasury;
        address doomRewards;
        address wrappedNative;
        address graduationManager;
        address curveDeployer;
    }

    struct LaunchParams {
        string name;
        string symbol;
        uint256 totalSupply;
        string metadataURI;
    }

    struct LaunchRecord {
        address token;
        address creator;
        address curve;
        address escrow;
        address initializedPool;
        uint256 totalSupply;
        uint256 curveAndLpAmount;
        uint256 escrowAmount;
        uint64 createdAt;
        string metadataURI;
    }

    address public immutable operator;
    address public immutable emergencyGuardian;
    address public immutable treasury;
    address public immutable doomRewards;
    IWrappedNativeV2 public immutable wrappedNative;
    address public immutable graduationManager;
    address public immutable curveDeployer;

    uint256 public nextLaunchId = FIRST_LAUNCH_ID;
    uint256 public accruedTreasuryFees;
    bool public launchesPaused = true;
    mapping(address curve => bool registered) public isCurve;
    mapping(address token => uint256 launchId) public launchIdByToken;
    mapping(uint256 launchId => LaunchRecord launch) private _launches;

    event LaunchPauseChanged(bool paused, address indexed caller);
    event LaunchCreated(
        uint256 indexed launchId,
        address indexed token,
        address indexed creator,
        address curve,
        address escrow,
        address initializedPool,
        uint256 totalSupply,
        string metadataURI
    );
    event LaunchFeeProcessed(uint256 indexed launchId, uint256 treasuryAmount, uint256 rewardsAmount);
    event TreasuryFeesWithdrawn(address indexed treasury, uint256 amount, uint256 remaining);

    modifier onlyOperator() {
        if (msg.sender != operator) revert UnauthorizedOperator(msg.sender);
        _;
    }

    constructor(FactoryConfig memory config_) {
        if (
            config_.operator == address(0) || config_.emergencyGuardian == address(0) || config_.treasury == address(0)
                || config_.doomRewards == address(0) || config_.wrappedNative == address(0)
                || config_.graduationManager == address(0) || config_.curveDeployer == address(0)
        ) revert ZeroAddress();
        if (config_.doomRewards.code.length == 0) revert DependencyHasNoCode(config_.doomRewards);
        if (config_.wrappedNative.code.length == 0) revert DependencyHasNoCode(config_.wrappedNative);
        if (config_.graduationManager.code.length == 0) revert DependencyHasNoCode(config_.graduationManager);
        if (config_.curveDeployer.code.length == 0) revert DependencyHasNoCode(config_.curveDeployer);
        address rewardToken = IDoomRewardsV2(config_.doomRewards).feeRewardToken();
        if (rewardToken != config_.wrappedNative) revert InvalidRewardsToken(config_.wrappedNative, rewardToken);
        operator = config_.operator;
        emergencyGuardian = config_.emergencyGuardian;
        treasury = config_.treasury;
        doomRewards = config_.doomRewards;
        wrappedNative = IWrappedNativeV2(config_.wrappedNative);
        graduationManager = config_.graduationManager;
        curveDeployer = config_.curveDeployer;
        emit LaunchPauseChanged(true, address(this));
    }

    function pauseLaunches() external {
        if (msg.sender != operator && msg.sender != emergencyGuardian) revert UnauthorizedPauseCaller(msg.sender);
        if (launchesPaused) revert LaunchesAlreadyPaused();
        launchesPaused = true;
        emit LaunchPauseChanged(true, msg.sender);
    }

    function resumeLaunches() external onlyOperator {
        if (!launchesPaused) revert LaunchesAlreadyActive();
        launchesPaused = false;
        emit LaunchPauseChanged(false, msg.sender);
    }

    function launch(LaunchParams calldata params)
        external
        payable
        nonReentrant
        returns (uint256 launchId, address tokenAddress, address curveAddress, address escrowAddress)
    {
        if (launchesPaused) revert LaunchesArePaused();
        if (msg.sender != tx.origin || msg.sender.code.length != 0) revert ContractCreatorNotAllowed(msg.sender);
        if (nextLaunchId > FINAL_LAUNCH_ID) revert LaunchLimitReached(FINAL_LAUNCH_ID);
        if (msg.value != LAUNCH_FEE) revert InvalidLaunchFee(LAUNCH_FEE, msg.value);
        _validate(params);
        if (!isLaunchConfigurationValid()) revert InvalidLiquidityConfiguration();

        launchId = nextLaunchId++;
        bytes32 tokenSalt = keccak256(
            abi.encode(
                block.prevrandao,
                block.number,
                block.timestamp,
                address(this),
                msg.sender,
                launchId,
                params.totalSupply,
                keccak256(bytes(params.name)),
                keccak256(bytes(params.symbol)),
                keccak256(bytes(params.metadataURI))
            )
        );
        (tokenAddress, curveAddress, escrowAddress) = ILaunchDeployerV2(curveDeployer)
            .deployLaunch(
                launchId,
                params.name,
                params.symbol,
                params.totalSupply,
                msg.sender,
                treasury,
                doomRewards,
                address(wrappedNative),
                graduationManager,
                tokenSalt
            );
        uint256 escrowAmount = params.totalSupply * ESCROW_TOKEN_BPS / BPS;
        uint256 curveAmount = params.totalSupply - escrowAmount;
        uint256 funded = IERC20(tokenAddress).balanceOf(escrowAddress) + IERC20(tokenAddress).balanceOf(curveAddress);
        if (funded != params.totalSupply) revert AllocationMismatch(params.totalSupply, funded);
        isCurve[curveAddress] = true;
        address initializedPool = IPublicGraduationManagerHealthV2(graduationManager).initializeLaunchPool(curveAddress);
        if (initializedPool == address(0) || initializedPool.code.length == 0) {
            revert DependencyHasNoCode(initializedPool);
        }
        launchIdByToken[tokenAddress] = launchId;
        _launches[launchId] = LaunchRecord({
            token: tokenAddress,
            creator: msg.sender,
            curve: curveAddress,
            escrow: escrowAddress,
            initializedPool: initializedPool,
            totalSupply: params.totalSupply,
            curveAndLpAmount: curveAmount,
            escrowAmount: escrowAmount,
            createdAt: uint64(block.timestamp),
            metadataURI: params.metadataURI
        });
        _processLaunchFee(launchId);
        emit LaunchCreated(
            launchId,
            tokenAddress,
            msg.sender,
            curveAddress,
            escrowAddress,
            initializedPool,
            params.totalSupply,
            params.metadataURI
        );
    }

    function getLaunch(uint256 launchId) external view returns (LaunchRecord memory) {
        return _launches[launchId];
    }

    function launchCount() external view returns (uint256) {
        return nextLaunchId - FIRST_LAUNCH_ID;
    }

    function isLaunchConfigurationValid() public view returns (bool) {
        try ILaunchDeployerV2(curveDeployer).authorizedFactory() returns (address configuredFactory) {
            if (configuredFactory != address(this)) return false;
        } catch {
            return false;
        }
        try IPublicGraduationManagerHealthV2(graduationManager).isNetworkConfigurationValid() returns (bool valid) {
            return valid;
        } catch {
            return false;
        }
    }

    function withdrawAccruedTreasuryFees(uint256 amount) external nonReentrant {
        if (msg.sender != treasury) revert UnauthorizedTreasury(msg.sender);
        if (amount > accruedTreasuryFees) revert InsufficientAccruedFees(accruedTreasuryFees, amount);
        accruedTreasuryFees -= amount;
        (bool sent,) = payable(treasury).call{value: amount}("");
        if (!sent) revert NativeTransferFailed(treasury, amount);
        emit TreasuryFeesWithdrawn(treasury, amount, accruedTreasuryFees);
    }

    function _processLaunchFee(uint256 launchId) internal {
        uint256 rewardsAmount = LAUNCH_FEE / 2;
        uint256 treasuryAmount = LAUNCH_FEE - rewardsAmount;
        accruedTreasuryFees += treasuryAmount;
        uint256 beforeBalance = IERC20(address(wrappedNative)).balanceOf(doomRewards);
        wrappedNative.deposit{value: rewardsAmount}();
        IERC20(address(wrappedNative)).forceApprove(doomRewards, rewardsAmount);
        IDoomRewardsV2(doomRewards).depositFeeRewards(address(wrappedNative), rewardsAmount, launchId);
        IERC20(address(wrappedNative)).forceApprove(doomRewards, 0);
        uint256 received = IERC20(address(wrappedNative)).balanceOf(doomRewards) - beforeBalance;
        if (received != rewardsAmount) revert WrappedRewardDepositMismatch(rewardsAmount, received);
        emit LaunchFeeProcessed(launchId, treasuryAmount, rewardsAmount);
    }

    function _validate(LaunchParams calldata params) internal pure {
        uint256 nameLength = bytes(params.name).length;
        uint256 symbolLength = bytes(params.symbol).length;
        uint256 metadataLength = bytes(params.metadataURI).length;
        if (nameLength == 0 || nameLength > 64) revert InvalidNameLength(nameLength);
        if (symbolLength == 0 || symbolLength > 12) revert InvalidSymbolLength(symbolLength);
        if (metadataLength == 0 || metadataLength > 512) revert InvalidMetadataLength(metadataLength);
        if (params.totalSupply == 0) revert InvalidSupply();
        if (params.totalSupply < MIN_TOTAL_SUPPLY || params.totalSupply > MAX_TOTAL_SUPPLY) {
            revert SupplyOutsideBounds(MIN_TOTAL_SUPPLY, MAX_TOTAL_SUPPLY, params.totalSupply);
        }
        if (params.totalSupply % 1 ether != 0) revert FractionalSupplyNotAllowed(params.totalSupply);
    }
}
