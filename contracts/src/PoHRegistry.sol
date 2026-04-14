// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title PoHRegistry — ZephyrPay Proof-of-Humanity & Proof-of-Business registry
/// @notice Records ZK-attested humanity and/or business attestations for a subject
///         address. Attestations are EIP-712-signed by an authorized attestor
///         (Self.xyz, Humanity Protocol, or ZephyrPay's own KYB bridge attestor) and
///         verified on-chain here. The signed payload pins subject, kind, a nonce
///         (to prevent replay), and an expiry (to bound attestation lifetime).
/// @dev    This contract does not store raw ZK proofs — it stores the *outcome* of
///         attestor verification. The attestor is expected to have verified the
///         underlying ZK proof before signing. Multiple attestors can be registered
///         so we can delegate to different ZK identity providers.
contract PoHRegistry is EIP712, AccessControl {
    using ECDSA for bytes32;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant ATTESTOR_ROLE = keccak256("ATTESTOR_ROLE");

    /// @dev EIP-712 typehash for an attestation.
    ///      kind: 1 = humanity, 2 = business, 3 = humanity+business bundle.
    bytes32 public constant ATTESTATION_TYPEHASH = keccak256(
        "Attestation(address subject,uint8 kind,uint64 issuedAt,uint64 expiresAt,bytes32 nonce)"
    );

    uint8 public constant KIND_HUMANITY = 1;
    uint8 public constant KIND_BUSINESS = 2;
    uint8 public constant KIND_HUMANITY_AND_BUSINESS = 3;

    struct Record {
        uint64 issuedAt;
        uint64 expiresAt;
        address attestor;
    }

    /// @notice subject => kind => record. Kind is exact — business is kept separate
    ///         from humanity. A humanity+business bundle updates both kinds.
    mapping(address => mapping(uint8 => Record)) private _records;

    /// @notice Tracks consumed attestation nonces per attestor to prevent replay.
    mapping(address => mapping(bytes32 => bool)) public consumedNonces;

    error InvalidKind();
    error AttestationExpired();
    error IssuedInFuture();
    error AttestorNotAuthorized(address attestor);
    error NonceAlreadyUsed();
    error SubjectMismatch();
    error ZeroAddress();

    event AttestationRecorded(
        address indexed subject,
        uint8 indexed kind,
        address indexed attestor,
        uint64 issuedAt,
        uint64 expiresAt
    );

    event AttestationRevoked(address indexed subject, uint8 indexed kind, address indexed admin);

    constructor(address admin) EIP712("ZephyrPay PoHRegistry", "1") {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
    }

    // -----------------------------------------------------------------------
    //                               Core logic
    // -----------------------------------------------------------------------

    /// @notice Submit an attestor-signed attestation and record it on-chain.
    /// @dev    Anyone may submit; the signature pins the subject so an unrelated
    ///         caller cannot forge an attestation for themselves.
    function recordAttestation(
        address subject,
        uint8 kind,
        uint64 issuedAt,
        uint64 expiresAt,
        bytes32 nonce,
        bytes calldata signature
    ) external {
        if (subject == address(0)) revert ZeroAddress();
        if (
            kind != KIND_HUMANITY
                && kind != KIND_BUSINESS
                && kind != KIND_HUMANITY_AND_BUSINESS
        ) {
            revert InvalidKind();
        }
        if (issuedAt > block.timestamp) revert IssuedInFuture();
        if (expiresAt <= block.timestamp) revert AttestationExpired();

        bytes32 structHash = keccak256(
            abi.encode(ATTESTATION_TYPEHASH, subject, kind, issuedAt, expiresAt, nonce)
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address attestor = digest.recover(signature);

        if (!hasRole(ATTESTOR_ROLE, attestor)) revert AttestorNotAuthorized(attestor);
        if (consumedNonces[attestor][nonce]) revert NonceAlreadyUsed();
        consumedNonces[attestor][nonce] = true;

        if (kind == KIND_HUMANITY_AND_BUSINESS) {
            _storeRecord(subject, KIND_HUMANITY, issuedAt, expiresAt, attestor);
            _storeRecord(subject, KIND_BUSINESS, issuedAt, expiresAt, attestor);
        } else {
            _storeRecord(subject, kind, issuedAt, expiresAt, attestor);
        }
    }

    /// @notice Admin revocation — used when off-chain KYC is rescinded.
    function revoke(address subject, uint8 kind) external onlyRole(ADMIN_ROLE) {
        delete _records[subject][kind];
        emit AttestationRevoked(subject, kind, msg.sender);
    }

    // -----------------------------------------------------------------------
    //                                Readers
    // -----------------------------------------------------------------------

    /// @notice True iff `subject` has a non-expired attestation of `kind`.
    function isVerified(address subject, uint8 kind) public view returns (bool) {
        Record memory r = _records[subject][kind];
        return r.expiresAt > block.timestamp;
    }

    /// @notice Convenience: both humanity and business required.
    function isFullyVerified(address subject) external view returns (bool) {
        return isVerified(subject, KIND_HUMANITY) && isVerified(subject, KIND_BUSINESS);
    }

    function getRecord(address subject, uint8 kind) external view returns (Record memory) {
        return _records[subject][kind];
    }

    /// @dev Expose the EIP-712 domain separator so off-chain signers can build digests.
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // -----------------------------------------------------------------------
    //                               Internals
    // -----------------------------------------------------------------------

    function _storeRecord(
        address subject,
        uint8 kind,
        uint64 issuedAt,
        uint64 expiresAt,
        address attestor
    ) private {
        _records[subject][kind] =
            Record({issuedAt: issuedAt, expiresAt: expiresAt, attestor: attestor});
        emit AttestationRecorded(subject, kind, attestor, issuedAt, expiresAt);
    }
}
