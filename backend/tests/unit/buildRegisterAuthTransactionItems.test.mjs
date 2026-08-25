import { describe, it, expect, vi, afterEach } from "vitest";
import { buildRegisterAuthTransactionItems } from "../../dal/buildRegisterAuthTransactionItems.js";

const CREATED_AT_ISO = "2026-01-15T10:00:00.000Z";
const CURRENT_EPOCH_MILLISECONDS = Date.UTC(2026, 0, 15, 10, 0, 0);
const CURRENT_EPOCH_SECONDS = Math.floor(CURRENT_EPOCH_MILLISECONDS / 1000);
const TWENTY_FOUR_HOURS_IN_SECONDS = 24 * 60 * 60;

function buildItemsWith(overrides = {}) {
    return buildRegisterAuthTransactionItems({
        email: "test@example.com",
        hashedPassword: "HASHED_PASSWORD",
        generatedUserId: "abc123",
        createdAtIsoTimestamp: CREATED_AT_ISO,
        authTableName: "AuthTableTest",
        currentEpochMillisecondsProvider: () => CURRENT_EPOCH_MILLISECONDS,
        ...overrides,
    });
}

describe("buildRegisterAuthTransactionItems", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("returns exactly two items: the user record first, the email uniqueness record second", () => {
        const transactionItems = buildItemsWith();

        expect(transactionItems).toHaveLength(2);
        expect(transactionItems[0].Put.Item.PK).toBe("USER#abc123");
        expect(transactionItems[1].Put.Item.PK).toBe("EMAIL#test@example.com");
    });

    it("builds the user record at index 0 exactly", () => {
        const transactionItems = buildItemsWith();

        expect(transactionItems[0]).toEqual({
            Put: {
                TableName: "AuthTableTest",
                Item: {
                    PK: "USER#abc123",
                    SK: "AUTH",
                    userId: "abc123",
                    email: "test@example.com",
                    passwordHash: "HASHED_PASSWORD",
                    createdAt: CREATED_AT_ISO,
                    expiredAt: CURRENT_EPOCH_SECONDS + TWENTY_FOUR_HOURS_IN_SECONDS,
                },
                ConditionExpression: "attribute_not_exists(PK)",
                ReturnValuesOnConditionCheckFailure: "ALL_OLD",
            },
        });
    });

    it("builds the email uniqueness record at index 1 exactly", () => {
        const transactionItems = buildItemsWith();

        expect(transactionItems[1]).toEqual({
            Put: {
                TableName: "AuthTableTest",
                Item: {
                    PK: "EMAIL#test@example.com",
                    SK: "UNIQUE",
                    userId: "USER#abc123",
                    validated: false,
                    createdAt: CREATED_AT_ISO,
                    expiredAt: CURRENT_EPOCH_SECONDS + TWENTY_FOUR_HOURS_IN_SECONDS,
                },
                ConditionExpression: "attribute_not_exists(PK)",
                ReturnValuesOnConditionCheckFailure: "ALL_OLD",
            },
        });
    });

    it("stores the RAW id on the user record and the USER#-PREFIXED id on the email record", () => {
        // This asymmetry is deliberate and load-bearing: the 201 response body returns the
        // raw id, while the email record points at the prefixed key.
        const transactionItems = buildItemsWith({ generatedUserId: "xyz789" });

        expect(transactionItems[0].Put.Item.userId).toBe("xyz789");
        expect(transactionItems[1].Put.Item.userId).toBe("USER#xyz789");
    });

    it("applies the given table name to both items", () => {
        const transactionItems = buildItemsWith({ authTableName: "SomeOtherTable" });

        expect(transactionItems[0].Put.TableName).toBe("SomeOtherTable");
        expect(transactionItems[1].Put.TableName).toBe("SomeOtherTable");
    });

    it("guards both items with the same conditional write", () => {
        const transactionItems = buildItemsWith();

        for (const transactionItem of transactionItems) {
            expect(transactionItem.Put.ConditionExpression).toBe("attribute_not_exists(PK)");
            expect(transactionItem.Put.ReturnValuesOnConditionCheckFailure).toBe("ALL_OLD");
        }
    });

    it("sets expiredAt to 24h after the provided epoch on both items", () => {
        const transactionItems = buildItemsWith();
        const expectedExpiredAt = CURRENT_EPOCH_SECONDS + TWENTY_FOUR_HOURS_IN_SECONDS;

        expect(transactionItems[0].Put.Item.expiredAt).toBe(expectedExpiredAt);
        expect(transactionItems[1].Put.Item.expiredAt).toBe(expectedExpiredAt);
    });

    it("calls the epoch provider twice — once per item — rather than sharing one value", () => {
        // The original inlined code evaluated Date.now() separately for each item.
        // Collapsing them into a single shared call would change behavior at a second boundary.
        const currentEpochMillisecondsProvider = vi.fn(() => CURRENT_EPOCH_MILLISECONDS);

        buildItemsWith({ currentEpochMillisecondsProvider });

        expect(currentEpochMillisecondsProvider).toHaveBeenCalledTimes(2);
    });

    it("lets the two epoch calls disagree, proving they are independent", () => {
        const currentEpochMillisecondsProvider = vi
            .fn()
            .mockReturnValueOnce(1_000_000)
            .mockReturnValueOnce(2_000_000);

        const transactionItems = buildItemsWith({ currentEpochMillisecondsProvider });

        expect(transactionItems[0].Put.Item.expiredAt).toBe(1000 + TWENTY_FOUR_HOURS_IN_SECONDS);
        expect(transactionItems[1].Put.Item.expiredAt).toBe(2000 + TWENTY_FOUR_HOURS_IN_SECONDS);
    });

    it("falls back to Date.now when no epoch provider is supplied", () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(CREATED_AT_ISO));

        const transactionItems = buildRegisterAuthTransactionItems({
            email: "test@example.com",
            hashedPassword: "HASHED_PASSWORD",
            generatedUserId: "abc123",
            createdAtIsoTimestamp: CREATED_AT_ISO,
            authTableName: "AuthTableTest",
        });

        expect(transactionItems[0].Put.Item.expiredAt).toBe(
            CURRENT_EPOCH_SECONDS + TWENTY_FOUR_HOURS_IN_SECONDS
        );
    });

    it("uses the email verbatim and does not normalize it", () => {
        // Normalization is the schema's job, upstream. This builder must not silently
        // lowercase, or the DynamoDB key would stop matching what the caller expects.
        const transactionItems = buildItemsWith({ email: "MiXeD@Example.COM" });

        expect(transactionItems[0].Put.Item.email).toBe("MiXeD@Example.COM");
        expect(transactionItems[1].Put.Item.PK).toBe("EMAIL#MiXeD@Example.COM");
    });

    it("returns a fresh structure on every call", () => {
        const firstTransactionItems = buildItemsWith();
        const secondTransactionItems = buildItemsWith();

        expect(firstTransactionItems).not.toBe(secondTransactionItems);
        expect(firstTransactionItems[0]).not.toBe(secondTransactionItems[0]);

        firstTransactionItems[0].Put.Item.PK = "MUTATED";
        expect(secondTransactionItems[0].Put.Item.PK).toBe("USER#abc123");
    });
});
