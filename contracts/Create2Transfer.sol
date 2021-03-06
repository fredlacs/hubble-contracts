pragma solidity ^0.5.15;
pragma experimental ABIEncoderV2;
import { Transition } from "./libs/Transition.sol";
import { Types } from "./libs/Types.sol";
import { MerkleTree } from "./libs/MerkleTree.sol";
import { BLS } from "./libs/BLS.sol";
import { Tx } from "./libs/Tx.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";

contract Create2Transfer {
    using Tx for bytes;
    using Types for Types.UserState;
    using SafeMath for uint256;

    function checkSignature(
        uint256[2] memory signature,
        Types.SignatureProofWithReceiver memory proof,
        bytes32 stateRoot,
        bytes32 accountRoot,
        bytes32 domain,
        bytes memory txs
    ) public view returns (Types.Result) {
        uint256 batchSize = txs.create2TransferSize();
        uint256[2][] memory messages = new uint256[2][](batchSize);
        for (uint256 i = 0; i < batchSize; i++) {
            Tx.Create2Transfer memory _tx = txs.create2TransferDecode(i);

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
                    keccak256(abi.encodePacked(proof.pubkeysSender[i])),
                    proof.states[i].pubkeyIndex,
                    proof.pubkeyWitnessesSender[i]
                ),
                "Rollup: from account does not exists"
            );

            // check receiver pubkye inclusion at committed accID
            require(
                MerkleTree.verify(
                    accountRoot,
                    keccak256(abi.encodePacked(proof.pubkeysReceiver[i])),
                    _tx.toAccID,
                    proof.pubkeyWitnessesReceiver[i]
                ),
                "Rollup: to account does not exists"
            );

            // construct the message
            require(proof.states[i].nonce > 0, "Rollup: zero nonce");

            bytes memory txMsg = Tx.create2TransferMessageOf(
                _tx,
                proof.states[i].nonce - 1,
                proof.pubkeysSender[i],
                proof.pubkeysReceiver[i]
            );

            // make the message
            messages[i] = BLS.hashToPoint(domain, txMsg);
        }

        if (!BLS.verifyMultiple(signature, proof.pubkeysSender, messages)) {
            return Types.Result.BadSignature;
        }
        return Types.Result.Ok;
    }

    /**
     * @notice processes the state transition of a commitment
     * */
    function processCreate2TransferCommit(
        bytes32 stateRoot,
        bytes memory txs,
        Types.StateMerkleProof[] memory proofs,
        uint256 feeReceiver
    ) public pure returns (bytes32, Types.Result result) {
        uint256 length = txs.create2TransferSize();
        uint256 fees = 0;
        // tokenType should be the same for all states in this commit
        uint256 tokenType = proofs[0].state.tokenType;
        Tx.Create2Transfer memory _tx;

        for (uint256 i = 0; i < length; i++) {
            _tx = txs.create2TransferDecode(i);
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
        Tx.Create2Transfer memory _tx,
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
        (, newRoot) = processCreate2TransferReceiver(
            newRoot,
            _tx,
            from.state.tokenType,
            to
        );

        return (newRoot, Types.Result.Ok);
    }

    function processCreate2TransferReceiver(
        bytes32 stateRoot,
        Tx.Create2Transfer memory _tx,
        uint256 tokenType,
        Types.StateMerkleProof memory proof
    ) internal pure returns (bytes memory encodedState, bytes32 newRoot) {
        // Validate we are creating on a zero state
        require(
            MerkleTree.verify(
                stateRoot,
                keccak256(abi.encode(0)),
                _tx.toIndex,
                proof.witness
            ),
            "Create2Transfer: receiver proof invalid"
        );
        encodedState = Transition.createState(
            _tx.toAccID,
            tokenType,
            _tx.amount
        );

        newRoot = MerkleTree.computeRoot(
            keccak256(encodedState),
            _tx.toIndex,
            proof.witness
        );
        return (encodedState, newRoot);
    }
}
