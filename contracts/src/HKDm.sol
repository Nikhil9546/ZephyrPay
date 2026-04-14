// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Pausable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title HKDm — ZephyrPay Regulated HKD Stablecoin (pre-HKDAP bridge)
/// @notice A role-gated, pausable, permit-enabled ERC-20 denominated in HKD cents (6 decimals).
///         This contract is a transitional implementation used while HKDAP / HSBC HKD
///         on-chain availability is pending on HashKey Chain. The external surface
///         (mint / burn / transfer / permit / pause) matches what we expect from a
///         real HK-regulated stablecoin, so downstream protocols (CreditLine) do not
///         need to change when HKDAP ships. A dedicated `BridgeMigrator` contract
///         will rotate the token address behind the same IERC20 interface.
/// @dev    Roles:
///         - DEFAULT_ADMIN_ROLE: grants/revokes other roles; held by a multisig in production.
///         - MINTER_ROLE:        authorized issuers (e.g., CreditLine, bank bridges).
///         - BURNER_ROLE:        authorized redeemers (e.g., repayment sinks).
///         - PAUSER_ROLE:        circuit-breaker role.
contract HKDm is ERC20, ERC20Permit, ERC20Pausable, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    uint8 private constant _DECIMALS = 6;

    error ZeroAddress();
    error ZeroAmount();

    event HKDmMinted(address indexed to, uint256 amount, address indexed minter);
    event HKDmBurned(address indexed from, uint256 amount, address indexed burner);

    /// @param admin Multisig or timelock that controls role assignments.
    constructor(address admin)
        ERC20("ZephyrPay HKD", "HKDm")
        ERC20Permit("ZephyrPay HKD")
    {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    /// @inheritdoc ERC20
    function decimals() public pure override returns (uint8) {
        return _DECIMALS;
    }

    /// @notice Mint new HKDm. Restricted to MINTER_ROLE.
    /// @param to     Recipient.
    /// @param amount Amount in base units (6 decimals).
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        _mint(to, amount);
        emit HKDmMinted(to, amount, msg.sender);
    }

    /// @notice Burn from an approved address. Restricted to BURNER_ROLE; requires
    ///         prior allowance from `from` to `msg.sender`. This design lets the
    ///         CreditLine repayment path pull tokens without giving it
    ///         arbitrary burn power.
    function burnFrom(address from, uint256 amount) external onlyRole(BURNER_ROLE) {
        if (from == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        _spendAllowance(from, msg.sender, amount);
        _burn(from, amount);
        emit HKDmBurned(from, amount, msg.sender);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /// @dev Required override: resolve multiple-inheritance _update between ERC20 and ERC20Pausable.
    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Pausable)
    {
        super._update(from, to, value);
    }
}
