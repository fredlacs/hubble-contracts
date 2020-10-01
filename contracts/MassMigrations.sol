pragma solidity ^0.5.15;
pragma experimental ABIEncoderV2;

import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { FraudProofHelpers } from "./libs/FraudProofHelpers.sol";
import { Types } from "./libs/Types.sol";
import { Tx } from "./libs/Tx.sol";

import { BLS } from "./libs/BLS.sol";
import { ParamManager } from "./libs/ParamManager.sol";
import { MerkleTreeUtilsLib, MerkleTreeUtils } from "./MerkleTreeUtils.sol";
import { NameRegistry } from "./NameRegistry.sol";

contract MassMigrationCore {
    using SafeMath for uint256;
    using Tx for bytes;
    using Types for Types.UserState;
    MerkleTreeUtils merkleTree;

    function checkSignature(
        uint256[2] memory signature,
        Types.SignatureProof memory proof,
        bytes32 stateRoot,
        bytes32 accountRoot,
        bytes32 domain,
        uint256 targetSpokeID,
        bytes memory txs
    ) public view returns (Types.Result) {
        uint256 length = txs.massMigration_size();
        uint256[2][] memory messages = new uint256[2][](length);
        for (uint256 i = 0; i < length; i++) {
            Tx.MassMigration memory _tx = txs.massMigration_decode(i);
            // check state inclustion
            require(
                MerkleTreeUtilsLib.verifyLeaf(
                    stateRoot,
                    keccak256(proof.states[i].encode()),
                    _tx.fromIndex,
                    proof.stateWitnesses[i]
                ),
                "Rollup: state inclusion signer"
            );

            // check pubkey inclusion
            require(
                MerkleTreeUtilsLib.verifyLeaf(
                    accountRoot,
                    keccak256(abi.encodePacked(proof.pubkeys[i])),
                    proof.states[i].pubkeyIndex,
                    proof.pubkeyWitnesses[i]
                ),
                "Rollup: account does not exists"
            );

            // construct the message
            require(proof.states[i].nonce > 0, "Rollup: zero nonce");
            bytes memory txMsg = Tx.massMigration_messageOf(
                _tx,
                proof.states[i].nonce - 1,
                targetSpokeID
            );
            // make the message
            messages[i] = BLS.hashToPoint(domain, txMsg);
        }
        if (!BLS.verifyMultiple(signature, proof.pubkeys, messages)) {
            return Types.Result.BadSignature;
        }
        return Types.Result.Ok;
    }

    /**
     * @notice processes the state transition of a commitment
     * @param stateRoot represents the state before the state transition
     * @return updatedRoot, txRoot and if the batch is valid or not
     * */
    function processMassMigrationCommit(
        bytes32 stateRoot,
        Types.MassMigrationBody memory commitmentBody,
        Types.StateMerkleProof[] memory proofs
    ) public view returns (bytes32, Types.Result result) {
        uint256 length = commitmentBody.txs.massMigration_size();
        Tx.MassMigration memory _tx;
        uint256 totalAmount = 0;
        bytes32 leaf = bytes32(0);
        bytes32[] memory withdrawLeaves = new bytes32[](length);

        for (uint256 i = 0; i < length; i++) {
            _tx = commitmentBody.txs.massMigration_decode(i);
            (stateRoot, , leaf, result) = processMassMigrationTx(
                stateRoot,
                _tx,
                commitmentBody.tokenID,
                proofs[i]
            );
            if (result != Types.Result.Ok) break;

            // Only trust these variables when the result is good
            totalAmount += _tx.amount;
            withdrawLeaves[i] = leaf;
        }

        if (totalAmount != commitmentBody.amount) {
            return (stateRoot, Types.Result.MismatchedAmount);
        }
        if (
            merkleTree.getMerkleRootFromLeaves(withdrawLeaves) !=
            commitmentBody.withdrawRoot
        ) {
            return (stateRoot, Types.Result.BadWithdrawRoot);
        }

        return (stateRoot, result);
    }

    function processMassMigrationTx(
        bytes32 stateRoot,
        Tx.MassMigration memory _tx,
        uint256 tokenType,
        Types.StateMerkleProof memory from
    )
        public
        pure
        returns (
            bytes32,
            bytes memory,
            bytes32 withdrawLeaf,
            Types.Result
        )
    {
        require(
            MerkleTreeUtilsLib.verifyLeaf(
                stateRoot,
                keccak256(from.state.encode()),
                _tx.fromIndex,
                from.witness
            ),
            "MassMigration: sender does not exist"
        );
        if (from.state.tokenType != tokenType) {
            return (bytes32(0), "", bytes32(0), Types.Result.BadFromTokenType);
        }
        Types.Result result = FraudProofHelpers.validateTxBasic(
            _tx.amount,
            _tx.fee,
            from.state
        );
        if (result != Types.Result.Ok)
            return (bytes32(0), "", bytes32(0), result);

        (
            bytes memory newFromState,
            bytes32 newRoot
        ) = ApplyMassMigrationTxSender(from, _tx);

        withdrawLeaf = keccak256(
            abi.encodePacked(from.state.pubkeyIndex, _tx.amount)
        );

        return (newRoot, newFromState, withdrawLeaf, Types.Result.Ok);
    }

    function ApplyMassMigrationTxSender(
        Types.StateMerkleProof memory _merkle_proof,
        Tx.MassMigration memory _tx
    ) public pure returns (bytes memory newState, bytes32 newRoot) {
        Types.UserState memory state = _merkle_proof.state;
        state.balance = state.balance.sub(_tx.amount);
        state.nonce++;
        bytes memory encodedState = state.encode();
        newRoot = MerkleTreeUtilsLib.rootFromWitnesses(
            keccak256(encodedState),
            _tx.fromIndex,
            _merkle_proof.witness
        );
        return (encodedState, newRoot);
    }
}

contract MassMigration is MassMigrationCore {
    constructor(NameRegistry nameRegistry) public {
        merkleTree = MerkleTreeUtils(
            nameRegistry.getContractDetails(ParamManager.MERKLE_UTILS())
        );
    }
}
