// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {PoHRegistry} from "./PoHRegistry.sol";

interface IHKDmMintBurn is IERC20 {
    function mint(address to, uint256 amount) external;
    function burnFrom(address from, uint256 amount) external;
}

/// @title CreditLine — ZephyrPay receivables-backed SME credit line
/// @notice Lets a verified SME borrow HKDm against an AI-attested credit score,
///         then auto-repays as receivables hit an on-chain sink.
/// @dev    Flow:
///         1. Borrower completes PoH + business attestations (PoHRegistry).
///         2. Backend scorer computes tier/APR/maxLine, signs an EIP-712 `Score`.
///         3. Borrower (or anyone) calls `applyScore(...)` to commit the score.
///         4. Borrower calls `borrow(amount, duration)` → mints HKDm to borrower.
///         5. Receivables arrive via `onSaleReceived(borrower, amount)` called by
///            a trusted SETTLEMENT_ROLE — typically a settlement relayer or a
///            merchant-gateway plugin that forwards stablecoin sale proceeds.
///         6. Principal repayment burns HKDm (through allowance from borrower);
///            accrued interest is swept to treasury.
///         Interest is simple, computed linearly on elapsed seconds since draw.
contract CreditLine is EIP712, AccessControl, Pausable, ReentrancyGuard {
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

    // -----------------------------------------------------------------------
    //                                 Roles
    // -----------------------------------------------------------------------

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant SCORER_ROLE = keccak256("SCORER_ROLE");
    bytes32 public constant SETTLEMENT_ROLE = keccak256("SETTLEMENT_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // -----------------------------------------------------------------------
    //                                EIP-712
    // -----------------------------------------------------------------------

    bytes32 public constant SCORE_TYPEHASH = keccak256(
        "Score(address borrower,uint8 tier,uint256 maxLine,uint16 aprBps,uint64 issuedAt,uint64 expiresAt,bytes32 nonce)"
    );

    // -----------------------------------------------------------------------
    //                                Storage
    // -----------------------------------------------------------------------

    struct Score {
        uint8 tier;         // 1=A, 2=B, 3=C, 4=D, 5=E (lower = safer)
        uint256 maxLine;    // HKDm base units (6 dp)
        uint16 aprBps;      // annualized APR in basis points (1% = 100)
        uint64 issuedAt;
        uint64 expiresAt;
    }

    struct Loan {
        uint256 principal;     // outstanding principal in HKDm
        uint256 interestAccrued; // interest already accrued and not yet repaid
        uint64 lastAccrualAt;   // last timestamp we updated interestAccrued
        uint64 dueAt;           // maturity
    }

    PoHRegistry public immutable poh;
    IHKDmMintBurn public immutable hkdm;
    address public treasury;

    /// @dev Maximum APR we allow a scorer to set, to cap oracle abuse.
    uint16 public constant MAX_APR_BPS = 5000; // 50% annualized
    /// @dev Minimum and maximum loan durations (seconds).
    uint32 public constant MIN_DURATION = 1 days;
    uint32 public constant MAX_DURATION = 180 days;
    /// @dev Seconds per year for interest math (365 days).
    uint256 public constant SECONDS_PER_YEAR = 365 days;
    /// @dev Basis-point denominator.
    uint256 public constant BPS = 10_000;
    /// @dev Origination fee (protocol revenue) in bps, applied on draw.
    uint16 public originationFeeBps = 150; // 1.5%

    mapping(address => Score) public scores;
    mapping(address => Loan) public loans;
    /// @notice Per-scorer replay protection for signed scores.
    mapping(address => mapping(bytes32 => bool)) public consumedScoreNonces;

    // -----------------------------------------------------------------------
    //                                Errors
    // -----------------------------------------------------------------------

    error ZeroAddress();
    error NotFullyVerified();
    error ScoreMissingOrExpired();
    error ScorerNotAuthorized(address scorer);
    error ScoreExpired();
    error ScoreIssuedInFuture();
    error ScoreNonceUsed();
    error InvalidTier();
    error AprTooHigh();
    error AmountZero();
    error DurationOutOfRange();
    error ExceedsAvailableLine(uint256 requested, uint256 available);
    error NoOutstandingDebt();
    error InsufficientAllowance();
    error LoanStillOpen();
    error OriginationFeeTooHigh();

    // -----------------------------------------------------------------------
    //                                Events
    // -----------------------------------------------------------------------

    event ScoreApplied(
        address indexed borrower,
        uint8 tier,
        uint256 maxLine,
        uint16 aprBps,
        uint64 expiresAt,
        address scorer
    );
    event Borrowed(
        address indexed borrower,
        uint256 principal,
        uint256 originationFee,
        uint64 dueAt
    );
    event Repaid(
        address indexed borrower,
        uint256 principalRepaid,
        uint256 interestPaid,
        uint256 remainingPrincipal
    );
    event SaleRouted(address indexed borrower, uint256 amount, uint256 appliedToDebt);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event OriginationFeeUpdated(uint16 oldBps, uint16 newBps);

    // -----------------------------------------------------------------------
    //                              Constructor
    // -----------------------------------------------------------------------

    constructor(address admin, PoHRegistry _poh, IHKDmMintBurn _hkdm, address _treasury)
        EIP712("ZephyrPay CreditLine", "1")
    {
        if (admin == address(0) || address(_poh) == address(0) || address(_hkdm) == address(0) || _treasury == address(0)) {
            revert ZeroAddress();
        }
        poh = _poh;
        hkdm = _hkdm;
        treasury = _treasury;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    // -----------------------------------------------------------------------
    //                               Admin ops
    // -----------------------------------------------------------------------

    function setTreasury(address newTreasury) external onlyRole(ADMIN_ROLE) {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    function setOriginationFeeBps(uint16 newBps) external onlyRole(ADMIN_ROLE) {
        if (newBps > 1_000) revert OriginationFeeTooHigh(); // cap 10%
        emit OriginationFeeUpdated(originationFeeBps, newBps);
        originationFeeBps = newBps;
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // -----------------------------------------------------------------------
    //                            Score ingestion
    // -----------------------------------------------------------------------

    /// @notice Apply an off-chain scorer attestation to the borrower's record.
    ///         Anyone may submit; the signature pins the borrower.
    function applyScore(
        address borrower,
        uint8 tier,
        uint256 maxLine,
        uint16 aprBps,
        uint64 issuedAt,
        uint64 expiresAt,
        bytes32 nonce,
        bytes calldata signature
    ) external {
        if (borrower == address(0)) revert ZeroAddress();
        if (tier == 0 || tier > 5) revert InvalidTier();
        if (aprBps > MAX_APR_BPS) revert AprTooHigh();
        if (issuedAt > block.timestamp) revert ScoreIssuedInFuture();
        if (expiresAt <= block.timestamp) revert ScoreExpired();

        bytes32 structHash = keccak256(
            abi.encode(SCORE_TYPEHASH, borrower, tier, maxLine, aprBps, issuedAt, expiresAt, nonce)
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address scorer = digest.recover(signature);
        if (!hasRole(SCORER_ROLE, scorer)) revert ScorerNotAuthorized(scorer);

        if (consumedScoreNonces[scorer][nonce]) revert ScoreNonceUsed();
        consumedScoreNonces[scorer][nonce] = true;

        scores[borrower] = Score({
            tier: tier,
            maxLine: maxLine,
            aprBps: aprBps,
            issuedAt: issuedAt,
            expiresAt: expiresAt
        });

        emit ScoreApplied(borrower, tier, maxLine, aprBps, expiresAt, scorer);
    }

    // -----------------------------------------------------------------------
    //                                Borrowing
    // -----------------------------------------------------------------------

    /// @notice Draw against the available credit line. Mints HKDm to the borrower
    ///         (net of origination fee, which goes to treasury).
    /// @param amount    Principal to draw (HKDm base units).
    /// @param duration  Loan duration in seconds; must be within [MIN, MAX].
    function borrow(uint256 amount, uint32 duration)
        external
        whenNotPaused
        nonReentrant
    {
        if (amount == 0) revert AmountZero();
        if (duration < MIN_DURATION || duration > MAX_DURATION) revert DurationOutOfRange();
        if (!poh.isFullyVerified(msg.sender)) revert NotFullyVerified();

        Score memory s = scores[msg.sender];
        if (s.expiresAt <= block.timestamp) revert ScoreMissingOrExpired();

        _accrue(msg.sender);
        Loan storage loan = loans[msg.sender];

        uint256 outstanding = loan.principal + loan.interestAccrued;
        uint256 available = s.maxLine > outstanding ? s.maxLine - outstanding : 0;
        if (amount > available) revert ExceedsAvailableLine(amount, available);

        uint256 fee = (amount * originationFeeBps) / BPS;
        uint256 netToBorrower = amount - fee;

        loan.principal += amount;
        loan.lastAccrualAt = uint64(block.timestamp);
        uint64 newDue = uint64(block.timestamp + duration);
        if (newDue > loan.dueAt) loan.dueAt = newDue;

        // Mint net amount to borrower; fee to treasury.
        hkdm.mint(msg.sender, netToBorrower);
        if (fee > 0) hkdm.mint(treasury, fee);

        emit Borrowed(msg.sender, amount, fee, loan.dueAt);
    }

    // -----------------------------------------------------------------------
    //                                Repayment
    // -----------------------------------------------------------------------

    /// @notice Called by SETTLEMENT_ROLE when a receivable is credited to the
    ///         borrower's sales stream. Pulls `amount` HKDm from the borrower
    ///         (requires prior approval) and applies it to outstanding debt.
    ///         If more is received than owed, the excess stays with the borrower
    ///         (the settlement relayer should not forward more than the debt).
    function onSaleReceived(address borrower, uint256 amount)
        external
        whenNotPaused
        nonReentrant
        onlyRole(SETTLEMENT_ROLE)
    {
        if (borrower == address(0)) revert ZeroAddress();
        if (amount == 0) revert AmountZero();

        _accrue(borrower);
        Loan storage loan = loans[borrower];
        uint256 outstanding = loan.principal + loan.interestAccrued;
        if (outstanding == 0) revert NoOutstandingDebt();

        uint256 applied = amount > outstanding ? outstanding : amount;

        // Split applied amount into interest first, then principal.
        uint256 interestPayment = applied > loan.interestAccrued ? loan.interestAccrued : applied;
        uint256 principalPayment = applied - interestPayment;

        // Interest portion is transferred to treasury (not burned).
        if (interestPayment > 0) {
            IERC20(address(hkdm)).safeTransferFrom(borrower, treasury, interestPayment);
            loan.interestAccrued -= interestPayment;
        }
        // Principal portion is burned (reduces outstanding stablecoin supply
        // backing the loan). Requires borrower to have approved this contract
        // as a burner-allowance source; CreditLine itself must hold BURNER_ROLE.
        if (principalPayment > 0) {
            hkdm.burnFrom(borrower, principalPayment);
            loan.principal -= principalPayment;
        }

        emit SaleRouted(borrower, amount, applied);
        emit Repaid(borrower, principalPayment, interestPayment, loan.principal);
    }

    /// @notice Borrower-initiated voluntary repayment.
    function repay(uint256 amount) external whenNotPaused nonReentrant {
        if (amount == 0) revert AmountZero();
        _accrue(msg.sender);
        Loan storage loan = loans[msg.sender];
        uint256 outstanding = loan.principal + loan.interestAccrued;
        if (outstanding == 0) revert NoOutstandingDebt();

        uint256 applied = amount > outstanding ? outstanding : amount;
        uint256 interestPayment = applied > loan.interestAccrued ? loan.interestAccrued : applied;
        uint256 principalPayment = applied - interestPayment;

        if (interestPayment > 0) {
            IERC20(address(hkdm)).safeTransferFrom(msg.sender, treasury, interestPayment);
            loan.interestAccrued -= interestPayment;
        }
        if (principalPayment > 0) {
            hkdm.burnFrom(msg.sender, principalPayment);
            loan.principal -= principalPayment;
        }

        emit Repaid(msg.sender, principalPayment, interestPayment, loan.principal);
    }

    // -----------------------------------------------------------------------
    //                                Readers
    // -----------------------------------------------------------------------

    /// @notice Outstanding debt for a borrower including unaccrued interest
    ///         projected to `block.timestamp`.
    function outstandingDebt(address borrower) external view returns (uint256) {
        Loan memory loan = loans[borrower];
        uint16 apr = scores[borrower].aprBps;
        uint256 pending = _pendingInterest(loan, apr);
        return loan.principal + loan.interestAccrued + pending;
    }

    function availableCredit(address borrower) external view returns (uint256) {
        Score memory s = scores[borrower];
        if (s.expiresAt <= block.timestamp) return 0;
        if (!poh.isFullyVerified(borrower)) return 0;

        Loan memory loan = loans[borrower];
        uint16 apr = s.aprBps;
        uint256 pending = _pendingInterest(loan, apr);
        uint256 outstanding = loan.principal + loan.interestAccrued + pending;
        return s.maxLine > outstanding ? s.maxLine - outstanding : 0;
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // -----------------------------------------------------------------------
    //                              Internals
    // -----------------------------------------------------------------------

    function _accrue(address borrower) internal {
        Loan storage loan = loans[borrower];
        if (loan.principal == 0 || loan.lastAccrualAt == block.timestamp) return;
        uint16 apr = scores[borrower].aprBps;
        uint256 pending = _pendingInterest(loan, apr);
        if (pending > 0) {
            loan.interestAccrued += pending;
        }
        loan.lastAccrualAt = uint64(block.timestamp);
    }

    function _pendingInterest(Loan memory loan, uint16 aprBps) internal view returns (uint256) {
        if (loan.principal == 0 || loan.lastAccrualAt == 0) return 0;
        uint256 elapsed = block.timestamp - loan.lastAccrualAt;
        if (elapsed == 0) return 0;
        // simple interest: principal * apr * elapsed / (BPS * SECONDS_PER_YEAR)
        return (loan.principal * aprBps * elapsed) / (BPS * SECONDS_PER_YEAR);
    }
}
