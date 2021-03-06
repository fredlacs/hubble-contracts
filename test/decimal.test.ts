import { assert } from "chai";
import { USDT } from "../ts/decimal";
import { EncodingError } from "../ts/exceptions";

describe("Decimal", () => {
    const goodCases: number[] = [0, 1, 10000, 12.13, 0.1234, 18690000000];

    it("Get's some property right", () => {
        assert.equal(USDT.bytesLength, 2);
    });

    it("Compresses and decompresses values", () => {
        for (const value of goodCases) {
            assert.equal(
                USDT.decode(USDT.encode(value)),
                value,
                `Mismatch Encode and decode of ${value}`
            );
        }
    });
    it("Compresses and decompresses random values", () => {
        let value: number;
        for (let i = 0; i <= 20; i++) {
            value = USDT.randNum();
            assert.equal(
                USDT.decode(USDT.encode(value)),
                value,
                `Mismatch Encode and decode of ${value}`
            );
        }
    });

    it("throws for bad cases", () => {
        const failingCases: number[] = [0.12345, 56789, 123.123];
        for (const value of failingCases) {
            assert.throws(() => {
                USDT.encode(value);
            }, EncodingError);
        }
    });
    it("casts values", () => {
        for (const value of goodCases) {
            assert.equal(
                USDT.cast(value),
                value,
                "Casted value should be the same in good cases"
            );
        }
        assert.equal(USDT.cast(0.12345), 0.1234);
        assert.equal(USDT.cast(56789), 56700);
        assert.equal(USDT.cast(123.123), 123.1);
        assert.equal(USDT.cast(186950000000), 186900000000);
        assert.equal(USDT.cast(4096), 4090);
        assert.equal(USDT.cast(4095), 4095);
    });
});
