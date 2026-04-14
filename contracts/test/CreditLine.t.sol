// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {HKDm} from "../src/HKDm.sol";
import {PoHRegistry} from "../src/PoHRegistry.sol";
import {CreditLine, IHKDmMintBurn} from "../src/CreditLine.sol";

contract CreditLineTest is Test {
    HKDm internal hkdm;
    PoHRegistry internal poh;
    CreditLine internal credit;

    address internal admin = address(0xA11CE);
    address internal treasury = address(0x7EEA);

    uint256 internal attestorPk = 0xA77E570;
    address internal attestor;
    uint256 internal scorerPk = 0x5C0E7;
    address internal scorer;

    address internal settlement = address(0x5E77);
    address internal alice = address(0xA1);

    bytes32 internal constant ATTESTATION_TYPEHASH = keccak256(
        "Attestation(address subject,uint8 kind,uint64 issuedAt,uint64 expiresAt,bytes32 nonce)"
    );
    bytes32 internal constant SCORE_TYPEHASH = keccak256(
        "Score(address borrower,uint8 tier,uint256 maxLine,uint16 aprBps,uint64 issuedAt,uint64 expiresAt,bytes32 nonce)"
    );

    function setUp() public {
        attestor = vm.addr(attestorPk);
        scorer = vm.addr(scorerPk);

        hkdm = new HKDm(admin);
        poh = new PoHRegistry(admin);
        credit = new CreditLine(admin, poh, IHKDmMintBurn(address(hkdm)), treasury);

        // cache roles
        bytes32 attestorRole = poh.ATTESTOR_ROLE();
        bytes32 scorerRole = credit.SCORER_ROLE();
        bytes32 settlementRole = credit.SETTLEMENT_ROLE();
        bytes32 minterRole = hkdm.MINTER_ROLE();
        bytes32 burnerRole = hkdm.BURNER_ROLE();

        vm.startPrank(admin);
        poh.grantRole(attestorRole, attestor);
        credit.grantRole(scorerRole, scorer);
        credit.grantRole(settlementRole, settlement);
        hkdm.grantRole(minterRole, address(credit));
        hkdm.grantRole(burnerRole, address(credit));
        vm.stopPrank();

        // Give alice a full PoH+business attestation
        _attestFull(alice, uint64(block.timestamp + 365 days), bytes32(uint256(0xA1)));
    }

    // -----------------------------------------------------------------------
    //                              helpers
    // -----------------------------------------------------------------------

    function _attestFull(address subject, uint64 expiresAt, bytes32 nonce) internal {
        bytes32 structHash = keccak256(
            abi.encode(ATTESTATION_TYPEHASH, subject, uint8(3), uint64(block.timestamp), expiresAt, nonce)
        );
        bytes32 digest = MessageHashUtils.toTypedDataHash(poh.DOMAIN_SEPARATOR(), structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attestorPk, digest);
        poh.recordAttestation(subject, 3, uint64(block.timestamp), expiresAt, nonce, abi.encodePacked(r, s, v));
    }

    function _signScore(
        address borrower,
        uint8 tier,
        uint256 maxLine,
        uint16 aprBps,
        uint64 issuedAt,
        uint64 expiresAt,
        bytes32 nonce
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(SCORE_TYPEHASH, borrower, tier, maxLine, aprBps, issuedAt, expiresAt, nonce)
        );
        bytes32 digest = MessageHashUtils.toTypedDataHash(credit.DOMAIN_SEPARATOR(), structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(scorerPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _applyScoreToAlice(uint256 maxLine, uint16 aprBps) internal {
        uint64 exp = uint64(block.timestamp + 30 days);
        bytes memory sig = _signScore(alice, 2, maxLine, aprBps, uint64(block.timestamp), exp, bytes32(uint256(1)));
        credit.applyScore(alice, 2, maxLine, aprBps, uint64(block.timestamp), exp, bytes32(uint256(1)), sig);
    }

    // -----------------------------------------------------------------------
    //                               tests
    // -----------------------------------------------------------------------

    function test_ApplyScore_Succeeds() public {
        _applyScoreToAlice(5_000 * 1e6, 850); // HK$5,000, 8.5% APR
        (uint8 tier, uint256 maxLine, uint16 apr,,) = credit.scores(alice);
        assertEq(tier, 2);
        assertEq(maxLine, 5_000 * 1e6);
        assertEq(apr, 850);
    }

    function test_Revert_ApplyScore_UnauthorizedScorer() public {
        uint64 exp = uint64(block.timestamp + 30 days);
        // sign with attestorPk instead of scorerPk — wrong role
        bytes32 structHash = keccak256(
            abi.encode(SCORE_TYPEHASH, alice, uint8(2), uint256(1_000e6), uint16(500), uint64(block.timestamp), exp, bytes32(uint256(2)))
        );
        bytes32 digest = MessageHashUtils.toTypedDataHash(credit.DOMAIN_SEPARATOR(), structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attestorPk, digest);
        vm.expectRevert(abi.encodeWithSelector(CreditLine.ScorerNotAuthorized.selector, attestor));
        credit.applyScore(alice, 2, 1_000e6, 500, uint64(block.timestamp), exp, bytes32(uint256(2)), abi.encodePacked(r, s, v));
    }

    function test_Revert_ApplyScore_AprTooHigh() public {
        uint64 exp = uint64(block.timestamp + 30 days);
        bytes memory sig = _signScore(alice, 2, 1_000e6, 6_000, uint64(block.timestamp), exp, bytes32(uint256(3)));
        vm.expectRevert(CreditLine.AprTooHigh.selector);
        credit.applyScore(alice, 2, 1_000e6, 6_000, uint64(block.timestamp), exp, bytes32(uint256(3)), sig);
    }

    function test_Revert_ApplyScore_InvalidTier() public {
        uint64 exp = uint64(block.timestamp + 30 days);
        bytes memory sig = _signScore(alice, 0, 1_000e6, 500, uint64(block.timestamp), exp, bytes32(uint256(4)));
        vm.expectRevert(CreditLine.InvalidTier.selector);
        credit.applyScore(alice, 0, 1_000e6, 500, uint64(block.timestamp), exp, bytes32(uint256(4)), sig);
    }

    function test_Borrow_Succeeds_MintsNetOfFee() public {
        _applyScoreToAlice(5_000e6, 850);
        vm.prank(alice);
        credit.borrow(1_000e6, 30 days);
        // 1.5% origination → fee 15e6 to treasury; borrower gets 985e6
        assertEq(hkdm.balanceOf(alice), 985e6);
        assertEq(hkdm.balanceOf(treasury), 15e6);
        (uint256 principal,, uint64 lastAccrual, uint64 dueAt) = credit.loans(alice);
        assertEq(principal, 1_000e6);
        assertEq(lastAccrual, block.timestamp);
        assertEq(dueAt, block.timestamp + 30 days);
    }

    function test_Revert_Borrow_NotVerified() public {
        address bob = address(0xB2);
        _applyScoreToAlice(5_000e6, 850); // score applied only to alice; bob unscored & unverified
        vm.prank(bob);
        vm.expectRevert(CreditLine.NotFullyVerified.selector);
        credit.borrow(100e6, 30 days);
    }

    function test_Revert_Borrow_NoScore() public {
        // alice verified but has no score
        vm.prank(alice);
        vm.expectRevert(CreditLine.ScoreMissingOrExpired.selector);
        credit.borrow(100e6, 30 days);
    }

    function test_Revert_Borrow_ExceedsLine() public {
        _applyScoreToAlice(500e6, 850);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CreditLine.ExceedsAvailableLine.selector, 501e6, 500e6));
        credit.borrow(501e6, 30 days);
    }

    function test_Revert_Borrow_DurationOutOfRange() public {
        _applyScoreToAlice(5_000e6, 850);
        vm.prank(alice);
        vm.expectRevert(CreditLine.DurationOutOfRange.selector);
        credit.borrow(100e6, 12 hours);
    }

    function test_InterestAccrues_Linearly() public {
        _applyScoreToAlice(10_000e6, 1_200); // 12% APR
        vm.prank(alice);
        credit.borrow(1_000e6, 30 days);

        vm.warp(block.timestamp + 365 days);
        // Expected interest ≈ 1_000e6 * 12% = 120e6
        uint256 outstanding = credit.outstandingDebt(alice);
        assertApproxEqAbs(outstanding, 1_120e6, 1e3);
    }

    function test_OnSaleReceived_RepaysInterestThenPrincipal() public {
        _applyScoreToAlice(10_000e6, 1_200);
        vm.prank(alice);
        credit.borrow(1_000e6, 30 days);

        // fast-forward to accrue interest
        vm.warp(block.timestamp + 30 days);

        // Alice approves CreditLine to pull HKDm for both transfer + burn legs
        // (interest goes to treasury via transferFrom; principal gets burnFrom)
        vm.prank(alice);
        hkdm.approve(address(credit), type(uint256).max);

        uint256 debtBefore = credit.outstandingDebt(alice);

        // Simulate a sale of HK$500
        vm.prank(settlement);
        credit.onSaleReceived(alice, 500e6);

        (uint256 principal, uint256 interest,,) = credit.loans(alice);
        assertLt(principal, 1_000e6);
        // At 12% APR * 30d ≈ ~9.86e6 interest, which should be fully cleared by 500e6 payment
        assertEq(interest, 0);
        // Debt should drop by ~500e6
        uint256 debtAfter = credit.outstandingDebt(alice);
        assertApproxEqAbs(debtBefore - debtAfter, 500e6, 1e5);
    }

    function test_Repay_Voluntary() public {
        _applyScoreToAlice(10_000e6, 1_200);
        vm.prank(alice);
        credit.borrow(1_000e6, 30 days);

        vm.prank(alice);
        hkdm.approve(address(credit), type(uint256).max);

        vm.prank(alice);
        credit.repay(200e6);

        (uint256 principal,,,) = credit.loans(alice);
        assertLt(principal, 1_000e6);
    }

    function test_Revert_Repay_NoDebt() public {
        _applyScoreToAlice(10_000e6, 1_200);
        vm.prank(alice);
        vm.expectRevert(CreditLine.NoOutstandingDebt.selector);
        credit.repay(1);
    }

    function test_OnSaleReceived_OnlySettlementRole() public {
        _applyScoreToAlice(10_000e6, 1_200);
        vm.prank(alice);
        credit.borrow(1_000e6, 30 days);

        vm.prank(alice);
        vm.expectRevert();
        credit.onSaleReceived(alice, 100e6);
    }

    function test_Pause_BlocksBorrow() public {
        _applyScoreToAlice(10_000e6, 1_200);
        vm.prank(admin);
        credit.pause();
        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        credit.borrow(100e6, 30 days);
    }

    function test_ScoreNonceReplay_Blocked() public {
        _applyScoreToAlice(5_000e6, 850);
        uint64 exp = uint64(block.timestamp + 30 days);
        bytes memory sig = _signScore(alice, 2, 5_000e6, 850, uint64(block.timestamp), exp, bytes32(uint256(1)));
        vm.expectRevert(CreditLine.ScoreNonceUsed.selector);
        credit.applyScore(alice, 2, 5_000e6, 850, uint64(block.timestamp), exp, bytes32(uint256(1)), sig);
    }

    function test_AvailableCredit_ReflectsOutstanding() public {
        _applyScoreToAlice(5_000e6, 850);
        assertEq(credit.availableCredit(alice), 5_000e6);
        vm.prank(alice);
        credit.borrow(1_000e6, 30 days);
        assertApproxEqAbs(credit.availableCredit(alice), 4_000e6, 1e3);
    }

    function test_AvailableCredit_ZeroIfUnverified() public {
        address bob = address(0xB2);
        // no attestation for bob
        uint64 exp = uint64(block.timestamp + 30 days);
        bytes memory sig = _signScore(bob, 2, 5_000e6, 850, uint64(block.timestamp), exp, bytes32(uint256(99)));
        credit.applyScore(bob, 2, 5_000e6, 850, uint64(block.timestamp), exp, bytes32(uint256(99)), sig);
        assertEq(credit.availableCredit(bob), 0);
    }

    function test_AdminCanUpdateTreasuryAndFee() public {
        address newT = address(0xDEAD);
        vm.prank(admin);
        credit.setTreasury(newT);
        assertEq(credit.treasury(), newT);

        vm.prank(admin);
        credit.setOriginationFeeBps(200);
        assertEq(credit.originationFeeBps(), 200);
    }

    function test_Revert_FeeTooHigh() public {
        vm.prank(admin);
        vm.expectRevert(CreditLine.OriginationFeeTooHigh.selector);
        credit.setOriginationFeeBps(1_001);
    }
}
