import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    classifyRegisterTransactionCancellation,
    REGISTER_CANCELLATION_OUTCOME,
} from "../../dal/classifyRegisterTransactionCancellation.js";

// Mirrors the real shape: index 0 is the USER# record, index 1 is the EMAIL# record.
const TRANSACTION_ITEMS = [
    { Put: { TableName: "AuthTableTest", Item: { PK: "USER#abc123" } } },
    { Put: { TableName: "AuthTableTest", Item: { PK: "EMAIL#test@example.com" } } },
];

const CONDITIONAL_CHECK_FAILED = {
    Code: "ConditionalCheckFailed",
    Message: "The conditional request failed",
};
const NO_FAILURE = { Code: "None" };

describe("classifyRegisterTransactionCancellation", () => {
    beforeEach(() => {
        vi.spyOn(console, "info").mockImplementation(() => { });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("outcomes", () => {
        it("returns EMAIL_ALREADY_EXISTS when index 0 failed its conditional check", () => {
            const outcome = classifyRegisterTransactionCancellation(
                [CONDITIONAL_CHECK_FAILED, NO_FAILURE],
                TRANSACTION_ITEMS
            );

            expect(outcome).toBe(REGISTER_CANCELLATION_OUTCOME.EMAIL_ALREADY_EXISTS);
        });

        it("returns ID_COLLISION when index 1 failed its conditional check", () => {
            const outcome = classifyRegisterTransactionCancellation(
                [NO_FAILURE, CONDITIONAL_CHECK_FAILED],
                TRANSACTION_ITEMS
            );

            expect(outcome).toBe(REGISTER_CANCELLATION_OUTCOME.ID_COLLISION);
        });

        it("prefers index 0 when both indices failed", () => {
            const outcome = classifyRegisterTransactionCancellation(
                [CONDITIONAL_CHECK_FAILED, CONDITIONAL_CHECK_FAILED],
                TRANSACTION_ITEMS
            );

            expect(outcome).toBe(REGISTER_CANCELLATION_OUTCOME.EMAIL_ALREADY_EXISTS);
        });

        it("returns UNCLASSIFIED when neither index failed a conditional check", () => {
            const outcome = classifyRegisterTransactionCancellation(
                [NO_FAILURE, NO_FAILURE],
                TRANSACTION_ITEMS
            );

            expect(outcome).toBe(REGISTER_CANCELLATION_OUTCOME.UNCLASSIFIED);
        });

        it("returns UNCLASSIFIED for an empty reasons array", () => {
            const outcome = classifyRegisterTransactionCancellation([], TRANSACTION_ITEMS);

            expect(outcome).toBe(REGISTER_CANCELLATION_OUTCOME.UNCLASSIFIED);
        });

        it("returns UNCLASSIFIED when only index 0 is present and it did not fail", () => {
            const outcome = classifyRegisterTransactionCancellation(
                [NO_FAILURE],
                TRANSACTION_ITEMS
            );

            expect(outcome).toBe(REGISTER_CANCELLATION_OUTCOME.UNCLASSIFIED);
        });

        it("returns UNCLASSIFIED for a failure code other than ConditionalCheckFailed", () => {
            const outcome = classifyRegisterTransactionCancellation(
                [{ Code: "ThrottlingError" }, { Code: "ThrottlingError" }],
                TRANSACTION_ITEMS
            );

            expect(outcome).toBe(REGISTER_CANCELLATION_OUTCOME.UNCLASSIFIED);
        });
    });

    describe("OOS-2 — the index-to-meaning mapping is inverted, and is preserved as such", () => {
        it("maps the USER# record (index 0) to EMAIL_ALREADY_EXISTS", () => {
            // Index 0 is the USER# Put — an id collision — yet it is classified as a
            // duplicate email. Preserved verbatim from the original implementation.
            expect(TRANSACTION_ITEMS[0].Put.Item.PK).toMatch(/^USER#/);

            const outcome = classifyRegisterTransactionCancellation(
                [CONDITIONAL_CHECK_FAILED, NO_FAILURE],
                TRANSACTION_ITEMS
            );

            expect(outcome).toBe(REGISTER_CANCELLATION_OUTCOME.EMAIL_ALREADY_EXISTS);
        });

        it("maps the EMAIL# record (index 1) to ID_COLLISION", () => {
            // Index 1 is the EMAIL# Put — a genuine duplicate email — yet it is classified
            // as an id collision, which is what sends the caller into its retry loop.
            expect(TRANSACTION_ITEMS[1].Put.Item.PK).toMatch(/^EMAIL#/);

            const outcome = classifyRegisterTransactionCancellation(
                [NO_FAILURE, CONDITIONAL_CHECK_FAILED],
                TRANSACTION_ITEMS
            );

            expect(outcome).toBe(REGISTER_CANCELLATION_OUTCOME.ID_COLLISION);
        });
    });

    describe("logging", () => {
        it("logs the mapped reasons with index, opType, code and message", () => {
            classifyRegisterTransactionCancellation(
                [NO_FAILURE, CONDITIONAL_CHECK_FAILED],
                TRANSACTION_ITEMS
            );

            expect(console.info).toHaveBeenCalledWith("createAuthEntry cancellation reasons", [
                { index: 0, opType: "Put", code: "None", message: undefined },
                {
                    index: 1,
                    opType: "Put",
                    code: "ConditionalCheckFailed",
                    message: "The conditional request failed",
                },
            ]);
        });

        it("logs emailCheck and checkId in that order when index 0 did not match", () => {
            classifyRegisterTransactionCancellation(
                [NO_FAILURE, CONDITIONAL_CHECK_FAILED],
                TRANSACTION_ITEMS
            );

            const loggedLabels = console.info.mock.calls.map(([label]) => label);
            expect(loggedLabels).toEqual([
                "createAuthEntry cancellation reasons",
                "emailCheck",
                "checkId",
            ]);
        });

        it("does not log checkId when index 0 matched and the function returned early", () => {
            classifyRegisterTransactionCancellation(
                [CONDITIONAL_CHECK_FAILED, NO_FAILURE],
                TRANSACTION_ITEMS
            );

            const loggedLabels = console.info.mock.calls.map(([label]) => label);
            expect(loggedLabels).toEqual([
                "createAuthEntry cancellation reasons",
                "emailCheck",
            ]);
            expect(loggedLabels).not.toContain("checkId");
        });

        it("derives opType from the transaction item's operation key", () => {
            const deleteTransactionItems = [
                { Delete: { TableName: "AuthTableTest" } },
                { Put: { TableName: "AuthTableTest" } },
            ];

            classifyRegisterTransactionCancellation(
                [NO_FAILURE, NO_FAILURE],
                deleteTransactionItems
            );

            const [, loggedReasons] = console.info.mock.calls[0];
            expect(loggedReasons[0].opType).toBe("Delete");
            expect(loggedReasons[1].opType).toBe("Put");
        });
    });

    describe("failure modes", () => {
        it("throws when there are more cancellation reasons than transaction items", () => {
            // Object.keys(undefined) throws. The original inlined code behaved identically;
            // the throw propagates out to the lambda's outer catch.
            expect(() =>
                classifyRegisterTransactionCancellation(
                    [NO_FAILURE, NO_FAILURE, NO_FAILURE],
                    TRANSACTION_ITEMS
                )
            ).toThrow(TypeError);
        });
    });

    describe("REGISTER_CANCELLATION_OUTCOME", () => {
        it("exposes exactly the three outcomes the caller branches on", () => {
            expect(REGISTER_CANCELLATION_OUTCOME).toEqual({
                EMAIL_ALREADY_EXISTS: "EMAIL_ALREADY_EXISTS",
                ID_COLLISION: "ID_COLLISION",
                UNCLASSIFIED: "UNCLASSIFIED",
            });
        });
    });
});
