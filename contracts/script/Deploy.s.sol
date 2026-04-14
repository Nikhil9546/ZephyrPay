// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {HKDm} from "../src/HKDm.sol";
import {PoHRegistry} from "../src/PoHRegistry.sol";
import {CreditLine, IHKDmMintBurn} from "../src/CreditLine.sol";

/// @title Deploy — one-shot deployment of the ZephyrPay protocol.
/// @notice Env variables required:
///         - DEPLOYER_PRIVATE_KEY
///         - ATTESTOR_ADDRESS   (off-chain ZK attestor signing key addr)
///         - SCORER_ADDRESS     (off-chain AI scorer signing key addr)
///         - TREASURY_ADDRESS   (optional; defaults to deployer)
contract Deploy is Script {
    struct Deployment {
        address hkdm;
        address poh;
        address creditLine;
        address admin;
        address attestor;
        address scorer;
        address treasury;
        uint256 chainId;
        uint256 deployedAt;
    }

    function run() external returns (Deployment memory d) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);

        address attestor = vm.envAddress("ATTESTOR_ADDRESS");
        address scorer = vm.envAddress("SCORER_ADDRESS");
        address treasury = vm.envOr("TREASURY_ADDRESS", deployer);

        require(attestor != address(0), "ATTESTOR_ADDRESS unset");
        require(scorer != address(0), "SCORER_ADDRESS unset");

        vm.startBroadcast(pk);

        HKDm hkdm = new HKDm(deployer);
        PoHRegistry poh = new PoHRegistry(deployer);
        CreditLine credit = new CreditLine(deployer, poh, IHKDmMintBurn(address(hkdm)), treasury);

        // wire roles
        poh.grantRole(poh.ATTESTOR_ROLE(), attestor);
        credit.grantRole(credit.SCORER_ROLE(), scorer);
        // Settlement role can be rotated later. For now, grant to deployer so ops
        // can relay simulated settlements; in prod this is a dedicated relayer addr.
        credit.grantRole(credit.SETTLEMENT_ROLE(), deployer);

        // CreditLine needs MINTER_ROLE + BURNER_ROLE on HKDm
        hkdm.grantRole(hkdm.MINTER_ROLE(), address(credit));
        hkdm.grantRole(hkdm.BURNER_ROLE(), address(credit));

        vm.stopBroadcast();

        d = Deployment({
            hkdm: address(hkdm),
            poh: address(poh),
            creditLine: address(credit),
            admin: deployer,
            attestor: attestor,
            scorer: scorer,
            treasury: treasury,
            chainId: block.chainid,
            deployedAt: block.timestamp
        });

        _writeDeploymentJson(d);
        _log(d);
    }

    function _writeDeploymentJson(Deployment memory d) internal {
        string memory path =
            string.concat("deployments/", vm.toString(d.chainId), ".json");
        string memory json = string.concat(
            "{\n",
            '  "chainId": ', vm.toString(d.chainId), ',\n',
            '  "deployedAt": ', vm.toString(d.deployedAt), ',\n',
            '  "admin": "', vm.toString(d.admin), '",\n',
            '  "attestor": "', vm.toString(d.attestor), '",\n',
            '  "scorer": "', vm.toString(d.scorer), '",\n',
            '  "treasury": "', vm.toString(d.treasury), '",\n',
            '  "contracts": {\n',
            '    "HKDm": "', vm.toString(d.hkdm), '",\n',
            '    "PoHRegistry": "', vm.toString(d.poh), '",\n',
            '    "CreditLine": "', vm.toString(d.creditLine), '"\n',
            '  }\n',
            "}\n"
        );
        vm.writeFile(path, json);
    }

    function _log(Deployment memory d) internal pure {
        console.log("=== ZephyrPay deployed ===");
        console.log("HKDm       :", d.hkdm);
        console.log("PoHRegistry:", d.poh);
        console.log("CreditLine :", d.creditLine);
        console.log("Admin      :", d.admin);
        console.log("Attestor   :", d.attestor);
        console.log("Scorer     :", d.scorer);
        console.log("Treasury   :", d.treasury);
    }
}
