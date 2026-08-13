// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {DoomTokenV2} from "./DoomTokenV2.sol";
import {DoomBondingCurve} from "./DoomBondingCurve.sol";

interface IDeployerFactoryBindingV2 {
    function curveDeployer() external view returns (address);
}

/// @notice One-time-bound creation-code carrier used only by DoomLaunchFactoryV2.
contract DoomLaunchDeployerV2 {
    using SafeERC20 for IERC20;

    error ZeroAddress();
    error UnauthorizedBinder(address caller);
    error UnauthorizedFactory(address caller);
    error FactoryAlreadyBound(address factory);
    error DependencyHasNoCode(address dependency);
    error InvalidFactoryBinding(address factory, address configuredDeployer);
    error AllocationMismatch(uint256 expected, uint256 actual);

    address public immutable factoryBinder;
    address public authorizedFactory;

    event FactoryBound(address indexed factory, address indexed binder);
    event LaunchContractsDeployed(
        uint256 indexed launchId, address indexed token, address indexed curve, address escrow, address creator
    );

    constructor(address factoryBinder_) {
        if (factoryBinder_ == address(0)) revert ZeroAddress();
        factoryBinder = factoryBinder_;
    }

    function bindFactory(address factory_) external {
        if (msg.sender != factoryBinder) revert UnauthorizedBinder(msg.sender);
        if (authorizedFactory != address(0)) revert FactoryAlreadyBound(authorizedFactory);
        if (factory_ == address(0) || factory_.code.length == 0) revert DependencyHasNoCode(factory_);
        address configured;
        try IDeployerFactoryBindingV2(factory_).curveDeployer() returns (address deployer) {
            configured = deployer;
        } catch {
            revert InvalidFactoryBinding(factory_, address(0));
        }
        if (configured != address(this)) revert InvalidFactoryBinding(factory_, configured);
        authorizedFactory = factory_;
        emit FactoryBound(factory_, msg.sender);
    }

    function deployLaunch(
        uint256 launchId,
        string calldata name,
        string calldata symbol,
        uint256 totalSupply,
        address creator,
        address treasury,
        address doomRewards,
        address wrappedNative,
        address graduationManager,
        bytes32 tokenSalt
    ) external returns (address tokenAddress, address curveAddress, address escrowAddress) {
        if (msg.sender != authorizedFactory) revert UnauthorizedFactory(msg.sender);
        DoomTokenV2 token = new DoomTokenV2{salt: tokenSalt}(name, symbol, totalSupply, address(this));
        tokenAddress = address(token);
        DoomBondingCurve curve = new DoomBondingCurve(
            launchId, tokenAddress, creator, treasury, doomRewards, wrappedNative, graduationManager, totalSupply
        );
        curveAddress = address(curve);
        escrowAddress = address(curve.escrow());
        token.bindLaunch(curveAddress, escrowAddress, graduationManager);
        uint256 escrowAmount = totalSupply * 6_000 / 10_000;
        IERC20(tokenAddress).safeTransfer(escrowAddress, escrowAmount);
        IERC20(tokenAddress).safeTransfer(curveAddress, totalSupply - escrowAmount);
        uint256 funded = IERC20(tokenAddress).balanceOf(escrowAddress) + IERC20(tokenAddress).balanceOf(curveAddress);
        if (funded != totalSupply) revert AllocationMismatch(totalSupply, funded);
        emit LaunchContractsDeployed(launchId, tokenAddress, curveAddress, escrowAddress, creator);
    }
}
