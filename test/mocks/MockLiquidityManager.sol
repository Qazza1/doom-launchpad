// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ILiquidityManager} from "../../src/interfaces/ILiquidityManager.sol";
import {IPositionLocker} from "../../src/interfaces/IPositionLocker.sol";
import {PositionLocker} from "../../src/PositionLocker.sol";
import {MockPositionManager} from "./MockPositionManager.sol";

contract MockPool {}

contract MockLiquidityManager is ILiquidityManager {
    using SafeERC20 for IERC20;

    MockPositionManager public immutable npm;
    address public immutable override positionLocker;
    address public pool;
    bool public valid = true;
    bytes32 public override configurationHash = keccak256("mock-v3-config");
    uint256 public nativeReceived;
    uint256 public tokensReceived;
    uint256 public lastPositionId;
    address public recordedPoolOverride;
    uint32 public tokenUsePpm = 1_000_000;
    uint32 public nativeUsePpm = 1_000_000;

    address public reentryTarget;
    bytes public reentryCalldata;
    bool public reentryAttempted;
    bool public reentrySucceeded;

    constructor(address npm_, address locker_) {
        npm = MockPositionManager(npm_);
        positionLocker = locker_;
        pool = address(new MockPool());
    }

    function setValid(bool value) external {
        valid = value;
    }

    function setPool(address value) external {
        pool = value;
    }

    function setRecordedPoolOverride(address value) external {
        recordedPoolOverride = value;
    }

    function setUsagePpm(uint32 tokenPpm, uint32 nativePpm) external {
        tokenUsePpm = tokenPpm;
        nativeUsePpm = nativePpm;
    }

    function setReentry(address target, bytes calldata data) external {
        reentryTarget = target;
        reentryCalldata = data;
    }

    function createAndLockLiquidity(CreateLiquidityParams calldata params)
        external
        payable
        override
        returns (address, uint256 positionId, uint256 tokenUsed, uint256 nativeUsed)
    {
        if (reentryTarget != address(0)) {
            reentryAttempted = true;
            (reentrySucceeded,) = reentryTarget.call(reentryCalldata);
        }

        tokenUsed = params.tokenAmount * tokenUsePpm / 1_000_000;
        nativeUsed = params.nativeAmount * nativeUsePpm / 1_000_000;
        IERC20(params.token).safeTransferFrom(msg.sender, address(this), tokenUsed);
        tokensReceived += tokenUsed;
        nativeReceived += nativeUsed;

        uint256 nativeRefund = msg.value - nativeUsed;
        if (nativeRefund != 0) {
            (bool refunded,) = payable(msg.sender).call{value: nativeRefund}("");
            require(refunded, "refund failed");
        }

        address wrappedNative = address(PositionLocker(positionLocker).wrappedNative());
        (address token0, address token1) =
            params.token < wrappedNative ? (params.token, wrappedNative) : (wrappedNative, params.token);
        positionId = npm.mintConfigured(address(this), token0, token1, params.fee, params.tickLower, params.tickUpper);
        npm.safeTransferFrom(address(this), positionLocker, positionId);
        IPositionLocker(positionLocker)
            .registerPermanentLock(
                positionId,
                recordedPoolOverride == address(0) ? pool : recordedPoolOverride,
                params.token,
                params.creator,
                params.gmEscrow,
                params.launchId
            );
        lastPositionId = positionId;
        return (pool, positionId, tokenUsed, nativeUsed);
    }

    function isNetworkConfigurationValid() external view override returns (bool) {
        return valid && IPositionLocker(positionLocker).authorizedRegistrar() == address(this);
    }
}
