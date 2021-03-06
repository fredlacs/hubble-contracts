import { TestTxFactory } from "../types/ethers-contracts/TestTxFactory";
import * as mcl from "../ts/mcl";
import { TestTx } from "../types/ethers-contracts/TestTx";
import {
    TxTransfer,
    serialize,
    TxMassMigration,
    TxCreate2Transfer
} from "../ts/tx";
import { assert } from "chai";
import { ethers } from "@nomiclabs/buidler";
import { COMMIT_SIZE } from "../ts/constants";
import { txCreate2TransferFactory, UserStateFactory } from "../ts/factory";

describe("Tx Serialization", async () => {
    let c: TestTx;
    before(async function() {
        const [signer, ...rest] = await ethers.getSigners();
        c = await new TestTxFactory(signer).deploy();
    });
    it("parse transfer transaction", async function() {
        const txs = TxTransfer.buildList(COMMIT_SIZE);
        const serialized = serialize(txs);
        assert.equal((await c.transferSize(serialized)).toNumber(), txs.length);
        assert.isFalse(await c.transferHasExcessData(serialized));
        for (let i in txs) {
            const { fromIndex, toIndex, amount, fee } = await c.transferDecode(
                serialized,
                i
            );
            assert.equal(fromIndex.toString(), txs[i].fromIndex.toString());
            assert.equal(toIndex.toString(), txs[i].toIndex.toString());
            assert.equal(amount.toString(), txs[i].amount.toString());
            assert.equal(fee.toString(), txs[i].fee.toString());
            const message = await c.transferMessageOf(
                serialized,
                i,
                txs[i].nonce
            );
            assert.equal(message, txs[i].message());
        }
    });
    it("parse create2transfer transaction", async function() {
        await mcl.init();
        let states = UserStateFactory.buildList(COMMIT_SIZE);
        let newStates = UserStateFactory.buildList(
            32,
            states.length,
            states.length
        );
        const txs = txCreate2TransferFactory(states, newStates, COMMIT_SIZE);

        const serialized = serialize(txs);
        assert.equal(
            (await c.create2transferSize(serialized)).toNumber(),
            txs.length
        );

        assert.isFalse(await c.create2transferHasExcessData(serialized));

        for (let i in txs) {
            const {
                fromIndex,
                toIndex,
                toAccID,
                amount,
                fee
            } = await c.create2TransferDecode(serialized, i);

            assert.equal(
                fromIndex.toString(),
                txs[i].fromIndex.toString(),
                "from index not equal"
            );
            assert.equal(
                toIndex.toString(),
                txs[i].toIndex.toString(),
                "to index not equal"
            );
            assert.equal(
                toAccID.toString(),
                txs[i].toAccID.toString(),
                "to acc ID not equal"
            );

            assert.equal(
                amount.toString(),
                txs[i].amount.toString(),
                "amount not equal"
            );

            assert.equal(
                fee.toString(),
                txs[i].fee.toString(),
                "fee not equal"
            );

            const message = await c.create2TransferMessageOf(
                serialized,
                i,
                txs[i].nonce,
                txs[i].fromPubkey,
                txs[i].toPubkey
            );
            assert.equal(message, txs[i].message());
        }
    });
    it("serialize transfer transaction", async function() {
        const txs = TxTransfer.buildList(COMMIT_SIZE);
        assert.equal(await c.transferSerialize(txs), serialize(txs));
    });
    it("serialize create2transfer transaction", async function() {
        const txs = TxCreate2Transfer.buildList(COMMIT_SIZE);
        assert.equal(await c.create2transferSerialize(txs), serialize(txs));
    });

    it("massMigration", async function() {
        const txs = TxMassMigration.buildList(COMMIT_SIZE);
        const serialized = serialize(txs);
        const size = await c.massMigrationSize(serialized);
        assert.equal(size.toNumber(), txs.length);
        for (let i in txs) {
            const { fromIndex, amount, fee } = await c.massMigrationDecode(
                serialized,
                i
            );
            assert.equal(fromIndex.toString(), txs[i].fromIndex.toString());
            assert.equal(amount.toString(), txs[i].amount.toString());
            assert.equal(fee.toString(), txs[i].fee.toString());
            const message = await c.testMassMigrationMessageOf(
                txs[i],
                txs[i].nonce,
                txs[i].spokeID
            );
            assert.equal(
                message,
                txs[i].message(),
                "message should be the same"
            );
        }
    });
});
