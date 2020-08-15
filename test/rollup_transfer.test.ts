const RollupUtilsLib = artifacts.require("RollupUtils");
const MerkleTreeUtils = artifacts.require("MerkleTreeUtils");
const TransferRollup = artifacts.require("TestTransfer");

const BLSAccountRegistry = artifacts.require("BLSAccountRegistry");
import { TxTransfer, serialize, calculateRoot, Tx } from "./utils/tx";
import * as mcl from "./utils/mcl";
import { StateTree } from "./utils/state_tree";
import { AccountRegistry } from "./utils/account_tree";
import { Account } from "./utils/state_account";
import { TestTransferInstance } from "../types/truffle-contracts";

let appID =
    "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
let ACCOUNT_SIZE = 32;
let BATCH_SIZE = 32;
let STATE_TREE_DEPTH = 32;

function link(contract: any, instance: any) {
    contract.link(instance);
}

contract("Rollup Transfer Commitment", () => {
    let rollup: TestTransferInstance;
    let registry: AccountRegistry;
    let merkleTreeUtilsAddress: string;
    let stateTree: StateTree;
    const accounts: Account[] = [];
    const tokenID = 1;
    const initialBalance = 1000;
    const initialNonce = 9;

    before(async function() {
        await mcl.init();
        const registryContract = await BLSAccountRegistry.new();
        const merkleTreeUtils = await MerkleTreeUtils.new();
        merkleTreeUtilsAddress = merkleTreeUtils.address;
        registry = await AccountRegistry.new(registryContract);
        for (let i = 0; i < ACCOUNT_SIZE; i++) {
            const accountID = i;
            const stateID = i;
            const account = Account.new(
                appID,
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
        let rollupUtilsLib = await RollupUtilsLib.new();
        link(TransferRollup, rollupUtilsLib);
        rollup = await TransferRollup.new(merkleTreeUtilsAddress);
        console.log(rollup.address);
        stateTree = StateTree.new(STATE_TREE_DEPTH);
        for (let i = 0; i < ACCOUNT_SIZE; i++) {
            stateTree.createAccount(accounts[i]);
        }
    });

    it.only("transfer commitment: process transactions", async function() {
        const txs: TxTransfer[] = [];
        const amount = 20;
        let aggSignature = mcl.newG1();
        let preTransitionRoot = stateTree.root;
        let signers = [];
        const pubkeys = [];
        const pubkeyWitnesses = [];
        for (let i = 0; i < BATCH_SIZE; i++) {
            const senderIndex = i;
            const reciverIndex = (i + 5) % ACCOUNT_SIZE;
            const sender = accounts[senderIndex];
            const receiver = accounts[reciverIndex];
            const tx = new TxTransfer(
                sender.stateID,
                receiver.stateID,
                amount,
                sender.nonce
            );
            txs.push(tx);
            signers.push(sender);
            pubkeys.push(sender.encodePubkey());
            pubkeyWitnesses.push(registry.witness(sender.accountID));
            const signature = sender.sign(tx);
            aggSignature = mcl.aggreagate(aggSignature, signature);
        }
        let stateTransitionProof = stateTree.applyTransferBatch(txs);

        assert.isTrue(stateTransitionProof.safe);
        const { serialized } = serialize(txs);

        const postTransitionRoot = stateTree.root;

        const res = await rollup.processTransferCommitment.call(
            preTransitionRoot,
            serialized,
            stateTransitionProof.proof
        );
        assert.equal(res[0], postTransitionRoot);
        assert.isTrue(res[1]);
        console.log("state transition operation gas cost:", res[2].toString());
        const tx = await rollup.processTransferCommitment(
            preTransitionRoot,
            serialized,
            stateTransitionProof.proof
        );
        console.log(
            "state transition transaction gas cost:",
            tx.receipt.gasUsed
        );
    }).timeout(100000);

    it("transfer commitment: signature check", async function() {
        const txs: TxTransfer[] = [];
        const amount = 20;
        let aggSignature = mcl.newG1();
        let signers = [];
        const pubkeys = [];
        const pubkeyWitnesses = [];
        for (let i = 0; i < BATCH_SIZE; i++) {
            const senderIndex = i;
            const reciverIndex = (i + 5) % ACCOUNT_SIZE;
            const sender = accounts[senderIndex];
            const receiver = accounts[reciverIndex];
            const tx = new TxTransfer(
                sender.stateID,
                receiver.stateID,
                amount,
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
        let stateTransitionProof = stateTree.applyTransferBatch(txs);
        assert.isTrue(stateTransitionProof.safe);
        const { serialized, commit } = serialize(txs);
        const stateWitnesses = [];
        const stateAccounts = [];
        for (let i = 0; i < BATCH_SIZE; i++) {
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
        const res = await rollup.checkSignature.call(
            signature,
            proof,
            postStateRoot,
            accountRoot,
            appID,
            serialized
        );
        assert.equal(0, res[0].toNumber());
        console.log(
            "signature verification operation gas cost:",
            res[1].toString()
        );
        const tx = await rollup.checkSignature(
            signature,
            proof,
            postStateRoot,
            accountRoot,
            appID,
            serialized
        );
        console.log(
            "signature verification transaction gas cost:",
            tx.receipt.gasUsed
        );
    }).timeout(100000);
});
