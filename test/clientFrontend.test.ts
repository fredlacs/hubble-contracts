import { assert } from "chai";
import { TxCreate2Transfer, TxMassMigration, TxTransfer } from "../ts/tx";
import { ethers } from "@nomiclabs/buidler";
import { ClientFrontend } from "../types/ethers-contracts/ClientFrontend";
import { ClientFrontendFactory } from "../types/ethers-contracts";

describe("Client Frontend", async function() {
    let contract: ClientFrontend;
    before(async function() {
        const [signer] = await ethers.getSigners();
        contract = await new ClientFrontendFactory(signer).deploy();
    });

    it("Decodes Transfer", async function() {
        for (let i = 0; i < 100; i++) {
            const tx = TxTransfer.rand();
            const _tx = await contract.decodeTransfer(tx.encodeOffchain());
            assert.equal(_tx.fromIndex.toNumber(), tx.fromIndex);
            assert.equal(_tx.toIndex.toNumber(), tx.toIndex);
            assert.equal(_tx.amount.toString(), tx.amount.toString());
            assert.equal(_tx.fee.toString(), tx.fee.toString());
            assert.equal(_tx.nonce.toNumber(), tx.nonce);
        }
    });
    it("Decodes MassMigration", async function() {
        for (let i = 0; i < 100; i++) {
            const tx = TxMassMigration.rand();
            const _tx = await contract.decodeMassMigration(tx.encodeOffchain());
            assert.equal(_tx.fromIndex.toNumber(), tx.fromIndex);
            assert.equal(_tx.amount.toString(), tx.amount.toString());
            assert.equal(_tx.fee.toString(), tx.fee.toString());
            assert.equal(_tx.spokeID.toNumber(), tx.spokeID);
            assert.equal(_tx.nonce.toNumber(), tx.nonce);
        }
    });
    it("Decodes Create2Transfer", async function() {
        for (let i = 0; i < 100; i++) {
            const tx = TxCreate2Transfer.rand();
            const _tx = await contract.decodeCreate2Transfer(
                tx.encodeOffchain()
            );
            assert.equal(_tx.fromIndex.toNumber(), tx.fromIndex);
            assert.equal(_tx.toIndex.toNumber(), tx.toIndex);
            assert.equal(_tx.toAccID.toNumber(), tx.toAccID);
            assert.equal(_tx.amount.toString(), tx.amount.toString());
            assert.equal(_tx.fee.toString(), tx.fee.toString());
            assert.equal(_tx.nonce.toNumber(), tx.nonce);
        }
    });
});
