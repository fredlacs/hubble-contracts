import { LoggerFactory } from "../types/ethers-contracts/LoggerFactory";
import { TestTransferFactory } from "../types/ethers-contracts/TestTransferFactory";
import { TestTransfer } from "../types/ethers-contracts/TestTransfer";
import { BlsAccountRegistryFactory } from "../types/ethers-contracts/BlsAccountRegistryFactory";

import { TxTransfer, serialize } from "../ts/tx";
import * as mcl from "../ts/mcl";
import { StateTree } from "../ts/stateTree";
import { AccountRegistry } from "../ts/accountTree";
import { Account } from "../ts/stateAccount";
import { assert } from "chai";
import { ethers } from "@nomiclabs/buidler";
import { randHex } from "../ts/utils";
import { ErrorCode } from "../ts/interfaces";

const DOMAIN_HEX = randHex(32);
const DOMAIN = Uint8Array.from(Buffer.from(DOMAIN_HEX.slice(2), "hex"));
const BAD_DOMAIN = Uint8Array.from(Buffer.from(randHex(32).slice(2), "hex"));
let ACCOUNT_SIZE = 32;
let COMMIT_SIZE = 32;
let STATE_TREE_DEPTH = 32;

describe("Rollup Transfer Commitment", () => {
    let rollup: TestTransfer;
    let registry: AccountRegistry;
    let stateTree: StateTree;
    const accounts: Account[] = [];
    const tokenID = 1;
    const initialBalance = 1000;
    const initialNonce = 9;

    before(async function() {
        await mcl.init();
        mcl.setDomainHex(DOMAIN_HEX);
        const [signer, ...rest] = await ethers.getSigners();
        const logger = await new LoggerFactory(signer).deploy();
        const registryContract = await new BlsAccountRegistryFactory(
            signer
        ).deploy(logger.address);

        registry = await AccountRegistry.new(registryContract);
        for (let i = 0; i < ACCOUNT_SIZE; i++) {
            const accountID = i;
            const stateID = i;
            const account = Account.new(
                accountID,
                tokenID,
                initialBalance,
                initialNonce + i
            );
            account.setStateID(stateID);
            account.newKeyPair();
            accounts.push(account);
            await registry.register(account.encodePubkey());
        }
    });

    beforeEach(async function() {
        const [signer, ...rest] = await ethers.getSigners();
        rollup = await new TestTransferFactory(signer).deploy();
        stateTree = StateTree.new(STATE_TREE_DEPTH);
        for (let i = 0; i < ACCOUNT_SIZE; i++) {
            stateTree.createAccount(accounts[i]);
        }
    });

    it("transfer commitment: signature check", async function() {
        const txs: TxTransfer[] = [];
        const amount = 20;
        const fee = 1;
        let aggSignature = mcl.newG1();
        let s0 = stateTree.root;
        let signers = [];
        const pubkeys = [];
        const pubkeyWitnesses = [];
        for (let i = 0; i < COMMIT_SIZE; i++) {
            const senderIndex = i;
            const reciverIndex = (i + 5) % ACCOUNT_SIZE;
            const sender = accounts[senderIndex];
            const receiver = accounts[reciverIndex];
            const tx = new TxTransfer(
                sender.stateID,
                receiver.stateID,
                amount,
                fee,
                sender.nonce
            );
            txs.push(tx);
            signers.push(sender);
            pubkeys.push(sender.encodePubkey());
            pubkeyWitnesses.push(registry.witness(sender.accountID));
            const signature = sender.sign(tx);
            aggSignature = mcl.aggreagate(aggSignature, signature);
        }
        let signature = mcl.g1ToHex(aggSignature);
        let stateTransitionProof = stateTree.applyTransferBatch(txs, 0);
        assert.isTrue(stateTransitionProof.safe);
        const { serialized, commit } = serialize(txs);
        const stateWitnesses = [];
        const stateAccounts = [];
        for (let i = 0; i < COMMIT_SIZE; i++) {
            stateWitnesses.push(
                stateTree.getAccountWitness(signers[i].stateID)
            );
            stateAccounts.push(signers[i].toSolStruct());
        }
        const postStateRoot = stateTree.root;
        const accountRoot = registry.root();
        const proof = {
            stateAccounts,
            stateWitnesses,
            pubkeys,
            pubkeyWitnesses
        };
        const {
            0: gasCost,
            1: noError
        } = await rollup.callStatic._checkSignature(
            signature,
            proof,
            postStateRoot,
            accountRoot,
            DOMAIN,
            serialized
        );
        assert.equal(noError, ErrorCode.NoError);
        console.log("operation gas cost:", gasCost.toString());
        const { 1: badSig } = await rollup.callStatic._checkSignature(
            signature,
            proof,
            postStateRoot,
            accountRoot,
            BAD_DOMAIN,
            serialized
        );
        assert.equal(badSig, ErrorCode.BadSignature);
        const tx = await rollup._checkSignature(
            signature,
            proof,
            postStateRoot,
            accountRoot,
            DOMAIN,
            serialized
        );
        const receipt = await tx.wait();
        console.log("transaction gas cost:", receipt.gasUsed?.toNumber());
    }).timeout(400000);

    it("transfer commitment: processTx", async function() {
        const amount = 20;
        const fee = 1;
        for (let i = 0; i < COMMIT_SIZE; i++) {
            const senderIndex = i;
            const reciverIndex = (i + 5) % ACCOUNT_SIZE;
            const sender = accounts[senderIndex];
            const receiver = accounts[reciverIndex];
            const tx = new TxTransfer(
                sender.stateID,
                receiver.stateID,
                amount,
                fee,
                sender.nonce
            );
            const preRoot = stateTree.root;
            const proof = stateTree.applyTxTransfer(tx);
            const postRoot = stateTree.root;

            const result = await rollup.testProcessTx(
                preRoot,
                tx.extended(),
                tokenID,
                {
                    pathToAccount: sender.stateID,
                    account: proof.senderAccount,
                    siblings: proof.senderWitness
                },
                {
                    pathToAccount: receiver.stateID,
                    account: proof.receiverAccount,
                    siblings: proof.receiverWitness
                }
            );
            assert.equal(result[0], postRoot, "mismatch processed stateroot");
        }
    });
    it("transfer commitment: processTransferCommit", async function() {
        const txs: TxTransfer[] = [];
        const amount = 20;
        const fee = 1;
        let s0 = stateTree.root;
        let senders = [];
        let receivers = [];
        const feeReceiver = 0;

        for (let i = 0; i < COMMIT_SIZE; i++) {
            const senderIndex = i;
            const reciverIndex = (i + 5) % ACCOUNT_SIZE;
            const sender = accounts[senderIndex];
            const receiver = accounts[reciverIndex];
            const tx = new TxTransfer(
                sender.stateID,
                receiver.stateID,
                amount,
                fee,
                sender.nonce
            );
            txs.push(tx);
            senders.push(sender);
            receivers.push(receiver);
        }

        const { proof, feeProof, safe } = stateTree.applyTransferBatch(
            txs,
            feeReceiver
        );
        assert.isTrue(safe, "Should be a valid applyTransferBatch");
        const { serialized } = serialize(txs);
        const stateMerkleProof = [];
        // pathToAccount is just a placeholder, no effect
        const pathToAccount = 0;
        for (let i = 0; i < COMMIT_SIZE; i++) {
            stateMerkleProof.push({
                account: proof[i].senderAccount,
                pathToAccount,
                siblings: proof[i].senderWitness
            });
            stateMerkleProof.push({
                account: proof[i].receiverAccount,
                pathToAccount,
                siblings: proof[i].receiverWitness
            });
        }
        stateMerkleProof.push({
            account: feeProof.feeReceiverAccount,
            pathToAccount,
            siblings: feeProof.feeReceiverWitness
        });
        const postStateRoot = stateTree.root;

        const {
            0: postRoot,
            1: gasCost
        } = await rollup.callStatic.testProcessTransferCommit(
            s0,
            serialized,
            stateMerkleProof,
            tokenID,
            feeReceiver
        );
        console.log("processTransferBatch gas cost", gasCost.toNumber());
        assert.equal(postRoot, postStateRoot, "Mismatch post state root");
    }).timeout(80000);
});
