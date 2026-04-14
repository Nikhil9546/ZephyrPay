// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {HKDm} from "../src/HKDm.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

contract HKDmTest is Test {
    HKDm internal token;

    address internal admin = address(0xA11CE);
    address internal minter = address(0xBEEF);
    address internal burner = address(0xCAFE);
    address internal alice = address(0xA1);
    address internal bob = address(0xB2);

    function setUp() public {
        token = new HKDm(admin);
        vm.startPrank(admin);
        token.grantRole(token.MINTER_ROLE(), minter);
        token.grantRole(token.BURNER_ROLE(), burner);
        vm.stopPrank();
    }

    // ---------- metadata ----------

    function test_Metadata() public view {
        assertEq(token.name(), "ZephyrPay HKD");
        assertEq(token.symbol(), "HKDm");
        assertEq(token.decimals(), 6);
        assertEq(token.totalSupply(), 0);
    }

    // ---------- mint ----------

    function test_Mint_AuthorizedMinter() public {
        vm.prank(minter);
        token.mint(alice, 1_000_000); // HK$1.00
        assertEq(token.balanceOf(alice), 1_000_000);
        assertEq(token.totalSupply(), 1_000_000);
    }

    function test_Revert_Mint_ByNonMinter() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                alice,
                token.MINTER_ROLE()
            )
        );
        vm.prank(alice);
        token.mint(alice, 1);
    }

    function test_Revert_Mint_ZeroAddress() public {
        vm.expectRevert(HKDm.ZeroAddress.selector);
        vm.prank(minter);
        token.mint(address(0), 1);
    }

    function test_Revert_Mint_ZeroAmount() public {
        vm.expectRevert(HKDm.ZeroAmount.selector);
        vm.prank(minter);
        token.mint(alice, 0);
    }

    // ---------- burn ----------

    function test_BurnFrom_WithAllowance() public {
        vm.prank(minter);
        token.mint(alice, 500_000);

        vm.prank(alice);
        token.approve(burner, 200_000);

        vm.prank(burner);
        token.burnFrom(alice, 200_000);

        assertEq(token.balanceOf(alice), 300_000);
        assertEq(token.totalSupply(), 300_000);
        assertEq(token.allowance(alice, burner), 0);
    }

    function test_Revert_BurnFrom_WithoutAllowance() public {
        vm.prank(minter);
        token.mint(alice, 500_000);
        vm.prank(burner);
        vm.expectRevert();
        token.burnFrom(alice, 1);
    }

    function test_Revert_BurnFrom_ByNonBurner() public {
        vm.prank(minter);
        token.mint(alice, 500_000);
        vm.prank(alice);
        token.approve(bob, 100);
        vm.expectRevert();
        vm.prank(bob);
        token.burnFrom(alice, 100);
    }

    // ---------- pause ----------

    function test_Pause_BlocksTransfers() public {
        vm.prank(minter);
        token.mint(alice, 1_000);

        vm.prank(admin);
        token.pause();

        vm.expectRevert(Pausable.EnforcedPause.selector);
        vm.prank(alice);
        token.transfer(bob, 1);

        vm.prank(admin);
        token.unpause();

        vm.prank(alice);
        assertTrue(token.transfer(bob, 1));
        assertEq(token.balanceOf(bob), 1);
    }

    function test_Revert_Pause_ByNonPauser() public {
        vm.expectRevert();
        vm.prank(alice);
        token.pause();
    }

    // ---------- permit ----------

    function test_Permit_Works() public {
        uint256 ownerPk = 0xA11CE;
        address owner = vm.addr(ownerPk);

        vm.prank(minter);
        token.mint(owner, 10_000);

        uint256 nonce = token.nonces(owner);
        uint256 deadline = block.timestamp + 1 hours;

        bytes32 PERMIT_TYPEHASH =
            keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, owner, bob, 5_000, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerPk, digest);

        token.permit(owner, bob, 5_000, deadline, v, r, s);
        assertEq(token.allowance(owner, bob), 5_000);
    }

    // ---------- fuzz ----------

    function testFuzz_Mint(uint256 amount) public {
        amount = bound(amount, 1, type(uint128).max);
        vm.prank(minter);
        token.mint(alice, amount);
        assertEq(token.balanceOf(alice), amount);
        assertEq(token.totalSupply(), amount);
    }
}
