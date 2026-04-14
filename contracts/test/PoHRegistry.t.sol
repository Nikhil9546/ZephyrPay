// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoHRegistry} from "../src/PoHRegistry.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract PoHRegistryTest is Test {
    PoHRegistry internal registry;

    address internal admin = address(0xA11CE);
    uint256 internal attestorPk = 0xA77E570;
    address internal attestor;
    uint256 internal otherPk = 0xBADF00D;
    address internal other;

    address internal alice = address(0xA1);

    bytes32 internal constant ATTESTATION_TYPEHASH = keccak256(
        "Attestation(address subject,uint8 kind,uint64 issuedAt,uint64 expiresAt,bytes32 nonce)"
    );

    function setUp() public {
        attestor = vm.addr(attestorPk);
        other = vm.addr(otherPk);
        registry = new PoHRegistry(admin);
        bytes32 attestorRole = registry.ATTESTOR_ROLE();
        vm.prank(admin);
        registry.grantRole(attestorRole, attestor);
    }

    function _sign(
        uint256 pk,
        address subject,
        uint8 kind,
        uint64 issuedAt,
        uint64 expiresAt,
        bytes32 nonce
    ) internal view returns (bytes memory sig) {
        bytes32 structHash =
            keccak256(abi.encode(ATTESTATION_TYPEHASH, subject, kind, issuedAt, expiresAt, nonce));
        bytes32 digest = MessageHashUtils.toTypedDataHash(registry.DOMAIN_SEPARATOR(), structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        sig = abi.encodePacked(r, s, v);
    }

    // ---------- happy path ----------

    function test_Record_Humanity() public {
        uint64 exp = uint64(block.timestamp + 365 days);
        bytes memory sig = _sign(attestorPk, alice, 1, uint64(block.timestamp), exp, bytes32(uint256(1)));
        registry.recordAttestation(alice, 1, uint64(block.timestamp), exp, bytes32(uint256(1)), sig);
        assertTrue(registry.isVerified(alice, 1));
        assertFalse(registry.isVerified(alice, 2));
        assertFalse(registry.isFullyVerified(alice));
    }

    function test_Record_HumanityAndBusiness_Bundle() public {
        uint64 exp = uint64(block.timestamp + 365 days);
        bytes memory sig = _sign(attestorPk, alice, 3, uint64(block.timestamp), exp, bytes32(uint256(9)));
        registry.recordAttestation(alice, 3, uint64(block.timestamp), exp, bytes32(uint256(9)), sig);
        assertTrue(registry.isVerified(alice, 1));
        assertTrue(registry.isVerified(alice, 2));
        assertTrue(registry.isFullyVerified(alice));
    }

    // ---------- signature / authority ----------

    function test_Revert_AttestorNotAuthorized() public {
        uint64 exp = uint64(block.timestamp + 1 days);
        bytes memory sig = _sign(otherPk, alice, 1, uint64(block.timestamp), exp, bytes32(uint256(2)));
        vm.expectRevert(abi.encodeWithSelector(PoHRegistry.AttestorNotAuthorized.selector, other));
        registry.recordAttestation(alice, 1, uint64(block.timestamp), exp, bytes32(uint256(2)), sig);
    }

    function test_Revert_BadSignature_RecoversWrongAddress() public {
        uint64 exp = uint64(block.timestamp + 1 days);
        bytes memory sig = _sign(attestorPk, alice, 1, uint64(block.timestamp), exp, bytes32(uint256(2)));
        // Swap subject — signature now recovers a different (random) address
        address mallory = address(0xBAD);
        vm.expectRevert();
        registry.recordAttestation(mallory, 1, uint64(block.timestamp), exp, bytes32(uint256(2)), sig);
    }

    // ---------- replay protection ----------

    function test_Revert_NonceReplay() public {
        uint64 exp = uint64(block.timestamp + 1 days);
        bytes32 nonce = bytes32(uint256(42));
        bytes memory sig = _sign(attestorPk, alice, 1, uint64(block.timestamp), exp, nonce);
        registry.recordAttestation(alice, 1, uint64(block.timestamp), exp, nonce, sig);
        vm.expectRevert(PoHRegistry.NonceAlreadyUsed.selector);
        registry.recordAttestation(alice, 1, uint64(block.timestamp), exp, nonce, sig);
    }

    // ---------- validity windows ----------

    function test_Revert_Expired() public {
        uint64 exp = uint64(block.timestamp - 1);
        bytes memory sig = _sign(attestorPk, alice, 1, 0, exp, bytes32(uint256(3)));
        vm.expectRevert(PoHRegistry.AttestationExpired.selector);
        registry.recordAttestation(alice, 1, 0, exp, bytes32(uint256(3)), sig);
    }

    function test_Revert_IssuedInFuture() public {
        uint64 issued = uint64(block.timestamp + 100);
        uint64 exp = uint64(block.timestamp + 1 days);
        bytes memory sig = _sign(attestorPk, alice, 1, issued, exp, bytes32(uint256(4)));
        vm.expectRevert(PoHRegistry.IssuedInFuture.selector);
        registry.recordAttestation(alice, 1, issued, exp, bytes32(uint256(4)), sig);
    }

    function test_Revert_InvalidKind() public {
        uint64 exp = uint64(block.timestamp + 1 days);
        bytes memory sig = _sign(attestorPk, alice, 7, uint64(block.timestamp), exp, bytes32(uint256(5)));
        vm.expectRevert(PoHRegistry.InvalidKind.selector);
        registry.recordAttestation(alice, 7, uint64(block.timestamp), exp, bytes32(uint256(5)), sig);
    }

    function test_ExpiresNaturally() public {
        uint64 exp = uint64(block.timestamp + 100);
        bytes memory sig = _sign(attestorPk, alice, 1, uint64(block.timestamp), exp, bytes32(uint256(6)));
        registry.recordAttestation(alice, 1, uint64(block.timestamp), exp, bytes32(uint256(6)), sig);
        assertTrue(registry.isVerified(alice, 1));
        vm.warp(block.timestamp + 101);
        assertFalse(registry.isVerified(alice, 1));
    }

    // ---------- revocation ----------

    function test_Admin_CanRevoke() public {
        uint64 exp = uint64(block.timestamp + 365 days);
        bytes memory sig = _sign(attestorPk, alice, 1, uint64(block.timestamp), exp, bytes32(uint256(7)));
        registry.recordAttestation(alice, 1, uint64(block.timestamp), exp, bytes32(uint256(7)), sig);
        assertTrue(registry.isVerified(alice, 1));
        vm.prank(admin);
        registry.revoke(alice, 1);
        assertFalse(registry.isVerified(alice, 1));
    }

    function test_Revert_Revoke_ByNonAdmin() public {
        vm.expectRevert();
        vm.prank(alice);
        registry.revoke(alice, 1);
    }
}
