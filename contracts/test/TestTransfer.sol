pragma solidity ^0.5.15;
pragma experimental ABIEncoderV2;

import { Transfer } from "../Transfer.sol";
import { Types } from "../libs/Types.sol";
import { Tx } from "../libs/Tx.sol";

contract TestTransfer is Transfer {
    function _checkSignature(
        uint256[2] memory signature,
        Types.SignatureProof memory proof,
        bytes32 stateRoot,
        bytes32 accountRoot,
        bytes32 domain,
        bytes memory txs
    ) public returns (uint256, Types.Result) {
        uint256 operationCost = gasleft();
        Types.Result result = checkSignature(
            signature,
            proof,
            stateRoot,
            accountRoot,
            domain,
            txs
        );
        return (operationCost - gasleft(), result);
    }

    function testProcessTx(
        bytes32 _balanceRoot,
        Tx.Transfer memory _tx,
        uint256 tokenType,
        Types.StateMerkleProof memory from,
        Types.StateMerkleProof memory to
    ) public pure returns (bytes32, Types.Result) {
        return processTx(_balanceRoot, _tx, tokenType, from, to);
    }

    function testProcessTransferCommit(
        bytes32 stateRoot,
        bytes memory txs,
        Types.StateMerkleProof[] memory proofs,
        uint256 feeReceiver
    ) public returns (bytes32, uint256) {
        bytes32 newRoot;
        uint256 operationCost = gasleft();
        (newRoot, ) = processTransferCommit(
            stateRoot,
            txs,
            proofs,
            feeReceiver
        );
        return (newRoot, operationCost - gasleft());
    }
}
