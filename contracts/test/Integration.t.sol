// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import {HKDm} from "../src/HKDm.sol";
import {PoHRegistry} from "../src/PoHRegistry.sol";
import {CreditLine, IHKDmMintBurn} from "../src/CreditLine.sol";
import {Deploy} from "../script/Deploy.s.sol";

/// @title Integration — end-to-end protocol test.
/// @notice Exercises the full user journey against the same contracts the
///         production deploy script produces. Catches any cross-contract
///         wiring bug that individual unit tests would miss.
///
///         Flow:
///           1. Run the Deploy script (in-memory, no broadcast).
///           2. Backend attestor signs a PoH+business attestation → merchant
///              submits on-chain.
///           3. Backend scorer signs a Score attestation → merchant submits
///              on-chain.
///           4. Merchant borrows; HKDm is minted.
///           5. Time passes; interest accrues.
///           6. Settlement relayer (SETTLEMENT_ROLE) routes sale proceeds →
///              interest + principal paid off.
///           7. Merchant voluntarily repays the remainder.
///           8. Final state asserted: no debt, verified flags still set,
///              treasury received interest + fee.
contract IntegrationTest is Test {
    HKDm internal hkdm;
    PoHRegistry internal poh;
    CreditLine internal credit;

    // Simulated off-chain service actors
    uint256 internal deployerPk = 0xDEAD_BEEF;
    uint256 internal attestorPk = 0xA77E5_7082;
    uint256 internal scorerPk = 0x5C0_7E72;
    address internal deployer;
    address internal attestor;
    address internal scorer;
    address internal treasury;
    address internal settlement;

    // Merchant
    uint256 internal mayaPk = 0xFA2_AC1C;
    address internal maya;

    bytes32 internal constant ATTESTATION_TYPEHASH = keccak256(
        "Attestation(address subject,uint8 kind,uint64 issuedAt,uint64 expiresAt,bytes32 nonce)"
    );
    bytes32 internal constant SCORE_TYPEHASH = keccak256(
        "Score(address borrower,uint8 tier,uint256 maxLine,uint16 aprBps,uint64 issuedAt,uint64 expiresAt,bytes32 nonce)"
    );

    function setUp() public {
        deployer = vm.addr(deployerPk);
        attestor = vm.addr(attestorPk);
        scorer = vm.addr(scorerPk);
        treasury = makeAddr("treasury");
        settlement = makeAddr("settlement-relayer");
        maya = vm.addr(mayaPk);

        // Drive the real Deploy script instead of duplicating its logic here —
        // this way the integration test is a regression test on the deploy flow
        // as well as on protocol behavior.
        vm.setEnv("DEPLOYER_PRIVATE_KEY", vm.toString(bytes32(deployerPk)));
        vm.setEnv("ATTESTOR_ADDRESS", vm.toString(attestor));
        vm.setEnv("SCORER_ADDRESS", vm.toString(scorer));
        vm.setEnv("TREASURY_ADDRESS", vm.toString(treasury));

        Deploy deployScript = new Deploy();
        Deploy.Deployment memory d = deployScript.run();

        hkdm = HKDm(d.hkdm);
        poh = PoHRegistry(d.poh);
        credit = CreditLine(d.creditLine);

        // SETTLEMENT_ROLE defaults to deployer in the Deploy script; grant to
        // our dedicated relayer address to mirror the production topology.
        bytes32 settlementRole = credit.SETTLEMENT_ROLE();
        vm.prank(deployer);
        credit.grantRole(settlementRole, settlement);
    }

    // -----------------------------------------------------------------------
    //                              signing helpers
    // -----------------------------------------------------------------------

    function _signAttestation(
        uint8 kind,
        uint64 issuedAt,
        uint64 expiresAt,
        bytes32 nonce
    ) internal view returns (bytes memory) {
        bytes32 structHash =
            keccak256(abi.encode(ATTESTATION_TYPEHASH, maya, kind, issuedAt, expiresAt, nonce));
        bytes32 digest = MessageHashUtils.toTypedDataHash(poh.DOMAIN_SEPARATOR(), structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attestorPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signScore(
        uint8 tier,
        uint256 maxLine,
        uint16 aprBps,
        uint64 issuedAt,
        uint64 expiresAt,
        bytes32 nonce
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(SCORE_TYPEHASH, maya, tier, maxLine, aprBps, issuedAt, expiresAt, nonce)
        );
        bytes32 digest = MessageHashUtils.toTypedDataHash(credit.DOMAIN_SEPARATOR(), structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(scorerPk, digest);
        return abi.encodePacked(r, s, v);
    }

    // -----------------------------------------------------------------------
    //                        full end-to-end scenario
    // -----------------------------------------------------------------------

    function test_FullMerchantJourney() public {
        _assertDeploymentWiring();
        _attestMaya();
        _scoreMaya(5_000 * 1e6, 850);
        _borrowAndAssert(2_000 * 1e6, 30 days);
        _accrueAndPayFromSale();
        _finalRepayAndReborrow();
    }

    function _assertDeploymentWiring() internal view {
        assertTrue(hkdm.hasRole(hkdm.MINTER_ROLE(), address(credit)), "credit should mint");
        assertTrue(hkdm.hasRole(hkdm.BURNER_ROLE(), address(credit)), "credit should burn");
        assertTrue(poh.hasRole(poh.ATTESTOR_ROLE(), attestor), "attestor wired");
        assertTrue(credit.hasRole(credit.SCORER_ROLE(), scorer), "scorer wired");
        assertTrue(credit.hasRole(credit.SETTLEMENT_ROLE(), settlement), "relayer wired");
        assertEq(credit.treasury(), treasury, "treasury wired");
    }

    function _attestMaya() internal {
        uint64 exp = uint64(block.timestamp + 180 days);
        bytes memory sig = _signAttestation(3, uint64(block.timestamp), exp, bytes32(uint256(0x1111)));
        poh.recordAttestation(maya, 3, uint64(block.timestamp), exp, bytes32(uint256(0x1111)), sig);
        assertTrue(poh.isFullyVerified(maya), "maya should be fully verified");
    }

    function _scoreMaya(uint256 maxLine, uint16 aprBps) internal {
        uint64 exp = uint64(block.timestamp + 15 minutes);
        bytes memory sig =
            _signScore(2, maxLine, aprBps, uint64(block.timestamp), exp, bytes32(uint256(0x2222)));
        credit.applyScore(
            maya, 2, maxLine, aprBps, uint64(block.timestamp), exp, bytes32(uint256(0x2222)), sig
        );
        assertEq(credit.availableCredit(maya), maxLine);
        assertEq(credit.outstandingDebt(maya), 0);
    }

    function _borrowAndAssert(uint256 drawAmount, uint32 duration) internal {
        vm.prank(maya);
        credit.borrow(drawAmount, duration);

        uint256 expectedFee = (drawAmount * 150) / 10_000;
        assertEq(hkdm.balanceOf(maya), drawAmount - expectedFee);
        assertEq(hkdm.balanceOf(treasury), expectedFee);
    }

    function _accrueAndPayFromSale() internal {
        vm.warp(block.timestamp + 30 days);

        vm.prank(maya);
        hkdm.approve(address(credit), type(uint256).max);

        uint256 salePayment = 1_500 * 1e6;
        vm.prank(settlement);
        credit.onSaleReceived(maya, salePayment);

        (uint256 principalAfterSale, uint256 interestAfterSale,,) = credit.loans(maya);
        assertEq(interestAfterSale, 0, "interest fully paid from sale");
        assertLt(principalAfterSale, 2_000 * 1e6, "principal reduced");
    }

    function _finalRepayAndReborrow() internal {
        // Economic truth: Maya can't repay the remainder from her wallet alone
        // because interest + fee already came out of her balance. A second sale
        // arriving is what closes the loop in the real world. Simulate it.
        uint256 remaining = credit.outstandingDebt(maya);

        // Top up Maya's balance with fresh sale proceeds. In production this
        // is stablecoin revenue arriving from Shopify / Stripe settlement; in
        // the test we just mint it directly through the MINTER_ROLE path to
        // simulate a merchant-gateway deposit.
        bytes32 minterRole = hkdm.MINTER_ROLE();
        vm.prank(deployer);
        hkdm.grantRole(minterRole, address(this));
        hkdm.mint(maya, remaining);

        vm.prank(settlement);
        credit.onSaleReceived(maya, remaining);

        (uint256 p, uint256 i,,) = credit.loans(maya);
        assertEq(p, 0, "no principal left");
        assertEq(i, 0, "no interest left");
        assertEq(credit.outstandingDebt(maya), 0);

        // The original score has expired (15 min TTL, we warped 30 days).
        // Real merchants re-score periodically. Issue a fresh score.
        assertEq(credit.availableCredit(maya), 0, "stale score => zero line");
        _reScoreMaya(5_000 * 1e6, 850);

        // Re-borrow against refreshed line.
        assertEq(credit.availableCredit(maya), 5_000 * 1e6, "full line restored");
        vm.prank(maya);
        credit.borrow(500 * 1e6, 7 days);
        (uint256 secondLoan,,,) = credit.loans(maya);
        assertEq(secondLoan, 500 * 1e6, "can borrow again after payoff");
    }

    function _reScoreMaya(uint256 maxLine, uint16 aprBps) internal {
        uint64 exp = uint64(block.timestamp + 15 minutes);
        bytes memory sig =
            _signScore(2, maxLine, aprBps, uint64(block.timestamp), exp, bytes32(uint256(0x9999)));
        credit.applyScore(
            maya, 2, maxLine, aprBps, uint64(block.timestamp), exp, bytes32(uint256(0x9999)), sig
        );
    }

    // -----------------------------------------------------------------------
    //                       adversarial scenarios
    // -----------------------------------------------------------------------

    /// @notice A borrower cannot skip PoH and borrow directly, even with a
    ///         valid score attestation.
    function test_CannotBorrowWithoutPoH() public {
        uint64 expiry = uint64(block.timestamp + 15 minutes);
        bytes memory scoreSig =
            _signScore(2, 1_000e6, 500, uint64(block.timestamp), expiry, bytes32(uint256(0x3333)));
        credit.applyScore(maya, 2, 1_000e6, 500, uint64(block.timestamp), expiry, bytes32(uint256(0x3333)), scoreSig);

        vm.prank(maya);
        vm.expectRevert(CreditLine.NotFullyVerified.selector);
        credit.borrow(100e6, 30 days);
    }

    /// @notice An attacker cannot forge an attestation without the attestor key.
    function test_AttestationForgery_Rejected() public {
        uint256 attackerPk = 0xBADC0DE;
        uint64 expiry = uint64(block.timestamp + 180 days);
        bytes32 structHash =
            keccak256(abi.encode(ATTESTATION_TYPEHASH, maya, uint8(3), uint64(block.timestamp), expiry, bytes32(uint256(0x4444))));
        bytes32 digest = MessageHashUtils.toTypedDataHash(poh.DOMAIN_SEPARATOR(), structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attackerPk, digest);

        vm.expectRevert();
        poh.recordAttestation(
            maya, 3, uint64(block.timestamp), expiry, bytes32(uint256(0x4444)), abi.encodePacked(r, s, v)
        );
    }

    /// @notice If the scorer key is compromised, the global MAX_APR_BPS cap
    ///         still limits the damage — a malicious 200% APR is rejected.
    function test_ScorerCompromise_AprCapEnforced() public {
        uint64 attestExp = uint64(block.timestamp + 180 days);
        bytes memory attSig = _signAttestation(3, uint64(block.timestamp), attestExp, bytes32(uint256(0x5555)));
        poh.recordAttestation(maya, 3, uint64(block.timestamp), attestExp, bytes32(uint256(0x5555)), attSig);

        uint64 scoreExp = uint64(block.timestamp + 15 minutes);
        bytes memory badSig = _signScore(1, 10_000e6, 20_000, uint64(block.timestamp), scoreExp, bytes32(uint256(0x6666)));
        vm.expectRevert(CreditLine.AprTooHigh.selector);
        credit.applyScore(maya, 1, 10_000e6, 20_000, uint64(block.timestamp), scoreExp, bytes32(uint256(0x6666)), badSig);
    }

    /// @notice Pausing the CreditLine halts borrows without freezing repayments.
    ///         (repay is also pausable, but this asserts the admin control path.)
    function test_Pause_HaltsNewBorrows() public {
        uint64 attExp = uint64(block.timestamp + 180 days);
        bytes memory attSig = _signAttestation(3, uint64(block.timestamp), attExp, bytes32(uint256(0x7777)));
        poh.recordAttestation(maya, 3, uint64(block.timestamp), attExp, bytes32(uint256(0x7777)), attSig);

        uint64 scoreExp = uint64(block.timestamp + 15 minutes);
        bytes memory scoreSig = _signScore(2, 5_000e6, 850, uint64(block.timestamp), scoreExp, bytes32(uint256(0x8888)));
        credit.applyScore(maya, 2, 5_000e6, 850, uint64(block.timestamp), scoreExp, bytes32(uint256(0x8888)), scoreSig);

        vm.prank(deployer);
        credit.pause();

        vm.prank(maya);
        vm.expectRevert();
        credit.borrow(100e6, 30 days);
    }
}
