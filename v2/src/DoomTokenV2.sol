// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Fixed-supply launch token restricted to launchpad paths until V3 graduation succeeds.
contract DoomTokenV2 is ERC20 {
    error ZeroInitialHolder();
    error ZeroSupply();
    error UnauthorizedBinder(address caller);
    error LaunchAlreadyBound();
    error InvalidLaunchDependency(address dependency);
    error TransfersRestricted(address from, address to);
    error UnauthorizedUnlock(address caller);
    error TransfersAlreadyUnrestricted();

    uint256 public immutable INITIAL_SUPPLY;
    address public immutable bootstrapDistributor;
    address public curve;
    address public escrow;
    address public graduationManager;
    bool public launchBound;
    bool public transfersUnrestricted;

    event LaunchBound(address indexed curve, address indexed escrow, address indexed graduationManager);
    event TransfersPermanentlyUnrestricted(address indexed curve);

    constructor(string memory name_, string memory symbol_, uint256 totalSupply_, address initialHolder_)
        ERC20(name_, symbol_)
    {
        if (initialHolder_ == address(0)) revert ZeroInitialHolder();
        if (totalSupply_ == 0) revert ZeroSupply();
        INITIAL_SUPPLY = totalSupply_;
        bootstrapDistributor = initialHolder_;
        _mint(initialHolder_, totalSupply_);
    }

    /// @notice Binds the only allowed pre-graduation transfer paths exactly once.
    function bindLaunch(address curve_, address escrow_, address graduationManager_) external {
        if (msg.sender != bootstrapDistributor) revert UnauthorizedBinder(msg.sender);
        if (launchBound) revert LaunchAlreadyBound();
        if (curve_ == address(0) || curve_.code.length == 0) revert InvalidLaunchDependency(curve_);
        if (escrow_ == address(0) || escrow_.code.length == 0) revert InvalidLaunchDependency(escrow_);
        if (graduationManager_ == address(0) || graduationManager_.code.length == 0) {
            revert InvalidLaunchDependency(graduationManager_);
        }
        curve = curve_;
        escrow = escrow_;
        graduationManager = graduationManager_;
        launchBound = true;
        emit LaunchBound(curve_, escrow_, graduationManager_);
    }

    /// @notice Irreversibly enables ordinary ERC-20 transfers after successful V3 graduation.
    function unlockTransfers() external {
        if (msg.sender != curve) revert UnauthorizedUnlock(msg.sender);
        if (transfersUnrestricted) revert TransfersAlreadyUnrestricted();
        transfersUnrestricted = true;
        emit TransfersPermanentlyUnrestricted(msg.sender);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (!transfersUnrestricted && from != address(0) && to != address(0)) {
            bool bootstrapFunding =
                msg.sender == bootstrapDistributor && from == bootstrapDistributor && (to == curve || to == escrow);
            bool curvePath = msg.sender == curve && (from == curve || to == curve);
            bool managerPull = msg.sender == graduationManager && from == curve && to == graduationManager;
            bool graduationPath = from == graduationManager;
            if (!launchBound || (!bootstrapFunding && !curvePath && !managerPull && !graduationPath)) {
                revert TransfersRestricted(from, to);
            }
        }
        super._update(from, to, value);
    }
}
