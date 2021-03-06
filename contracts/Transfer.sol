pragma solidity ^0.5.15;
pragma experimental ABIEncoderV2;

import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { Transition } from "./libs/Transition.sol";
import { Types } from "./libs/Types.sol";
import { MerkleTree } from "./libs/MerkleTree.sol";
import { BLS } from "./libs/BLS.sol";
import { Tx } from "./libs/Tx.sol";

contract Transfer {
    using SafeMath for uint256;
    using Tx for bytes;
    using Types for Types.UserState;

    function checkSignature(
        uint256[2] memory signature,
        Types.SignatureProof memory proof,
        bytes32 stateRoot,
        bytes32 accountRoot,
        bytes32 domain,
        bytes memory txs
    ) public view returns (Types.Result) {
        uint256 batchSize = txs.transferSize();
        uint256[2][] memory messages = new uint256[2][](batchSize);
        for (uint256 i = 0; i < batchSize; i++) {
            Tx.Transfer memory _tx = txs.transferDecode(i);
            // check state inclustion
            require(
                MerkleTree.verify(
                    stateRoot,
                    keccak256(proof.states[i].encode()),
                    _tx.fromIndex,
                    proof.stateWitnesses[i]
                ),
                "Rollup: state inclusion signer"
            );

            // check pubkey inclusion
            require(
                MerkleTree.verify(
                    accountRoot,
                    keccak256(abi.encodePacked(proof.pubkeys[i])),
                    proof.states[i].pubkeyIndex,
                    proof.pubkeyWitnesses[i]
                ),
                "Rollup: account does not exists"
            );

            // construct the message
            require(proof.states[i].nonce > 0, "Rollup: zero nonce");
            bytes memory txMsg = Tx.transferMessageOf(
                _tx,
                proof.states[i].nonce - 1
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
     * */
    function processTransferCommit(
        bytes32 stateRoot,
        bytes memory txs,
        Types.StateMerkleProof[] memory proofs,
        uint256 feeReceiver
    ) public pure returns (bytes32, Types.Result result) {
        uint256 length = txs.transferSize();

        uint256 fees = 0;
        // tokenType should be the same for all states in this commit
        uint256 tokenType = proofs[0].state.tokenType;
        Tx.Transfer memory _tx;

        for (uint256 i = 0; i < length; i++) {
            _tx = txs.transferDecode(i);
            (stateRoot, result) = processTx(
                stateRoot,
                _tx,
                tokenType,
                proofs[i * 2],
                proofs[i * 2 + 1]
            );
            if (result != Types.Result.Ok) return (stateRoot, result);
            // Only trust fees when the result is good
            fees = fees.add(_tx.fee);
        }
        (stateRoot, result) = Transition.processReceiver(
            stateRoot,
            feeReceiver,
            tokenType,
            fees,
            proofs[length * 2]
        );

        return (stateRoot, result);
    }

    /**
     * @notice processTx processes a transactions and returns the updated balance tree
     *  and the updated leaves
     * conditions in require mean that the dispute be declared invalid
     * if conditons evaluate if the coordinator was at fault
     */
    function processTx(
        bytes32 stateRoot,
        Tx.Transfer memory _tx,
        uint256 tokenType,
        Types.StateMerkleProof memory from,
        Types.StateMerkleProof memory to
    ) internal pure returns (bytes32 newRoot, Types.Result result) {
        (newRoot, result) = Transition.processSender(
            stateRoot,
            _tx.fromIndex,
            tokenType,
            _tx.amount,
            _tx.fee,
            from
        );
        if (result != Types.Result.Ok) return (newRoot, result);
        (newRoot, result) = Transition.processReceiver(
            newRoot,
            _tx.toIndex,
            tokenType,
            _tx.amount,
            to
        );
        return (newRoot, result);
    }
}
