import { ethers } from "@nomiclabs/buidler";
import { assert, expect } from "chai";
import { constants } from "ethers";
import { solidityKeccak256 } from "ethers/lib/utils";
import { allContracts } from "../ts/allContractsInterfaces";
import { TESTING_PARAMS } from "../ts/constants";
import { deployAll } from "../ts/deploy";
import { State } from "../ts/state";
import { Tree } from "../ts/tree";
import { randomLeaves } from "../ts/utils";
import { TestDepositCore } from "../types/ethers-contracts/TestDepositCore";
import { TestDepositCoreFactory } from "../types/ethers-contracts/TestDepositCoreFactory";

describe("Deposit Core", async function() {
    let contract: TestDepositCore;
    const maxSubtreeDepth = 4;
    before(async function() {
        const [signer] = await ethers.getSigners();
        contract = await new TestDepositCoreFactory(signer).deploy(
            maxSubtreeDepth
        );
    });
    it("insert and merge many deposits", async function() {
        const maxSubtreeSize = 2 ** maxSubtreeDepth;
        const leaves = randomLeaves(maxSubtreeSize);
        const tree = Tree.new(maxSubtreeDepth);
        for (let i = 0; i < maxSubtreeSize; i++) {
            const {
                gasCost,
                readySubtree
            } = await contract.callStatic.testInsertAndMerge(leaves[i]);
            console.log(
                `Insert leaf ${i} \t Operation cost: ${gasCost.toNumber()}`
            );
            await contract.testInsertAndMerge(leaves[i]);
            tree.updateSingle(i, leaves[i]);
            if (i !== maxSubtreeSize - 1) {
                assert.equal(
                    readySubtree,
                    constants.HashZero,
                    "Not a ready subtree yet"
                );
            } else {
                assert.equal(
                    readySubtree,
                    tree.root,
                    "Should be the merkle root of all leaves"
                );
            }
        }
        assert.equal((await contract.back()).toNumber(), 1);
        assert.equal(
            await contract.getQueue(1),
            tree.root,
            "subtree root should be in the subtree queue now"
        );
    });
});

const LARGE_AMOUNT_OF_TOKEN = 1000000;

describe("DepositManager", async function() {
    let contracts: allContracts;
    let tokenType: number;
    beforeEach(async function() {
        const [signer] = await ethers.getSigners();
        contracts = await deployAll(signer, TESTING_PARAMS);
        const { testToken, tokenRegistry, depositManager } = contracts;
        tokenType = (await tokenRegistry.numTokens()).toNumber();
        await testToken.approve(depositManager.address, LARGE_AMOUNT_OF_TOKEN);
    });
    it("should allow depositing 2 leaves in a subtree and merging it", async function() {
        const { depositManager, logger } = contracts;
        const deposit0 = State.new(0, tokenType, 10, 0);
        const deposit1 = State.new(1, tokenType, 10, 0);
        const pendingDeposit = solidityKeccak256(
            ["bytes", "bytes"],
            [deposit0.toStateLeaf(), deposit1.toStateLeaf()]
        );

        const gasCost0 = await depositManager.estimateGas.depositFor(
            0,
            10,
            tokenType
        );
        console.log("Deposit 0 transaction cost", gasCost0.toNumber());

        await expect(depositManager.depositFor(0, 10, tokenType))
            .to.emit(logger, "DepositQueued")
            .withArgs(0, deposit0.encode());

        const gasCost1 = await depositManager.estimateGas.depositFor(
            1,
            10,
            tokenType
        );
        console.log("Deposit 1 transaction cost", gasCost1.toNumber());

        await expect(depositManager.depositFor(1, 10, tokenType))
            .to.emit(logger, "DepositQueued")
            .withArgs(1, deposit1.encode())
            .and.to.emit(logger, "DepositSubTreeReady")
            .withArgs(pendingDeposit);
    });
});
