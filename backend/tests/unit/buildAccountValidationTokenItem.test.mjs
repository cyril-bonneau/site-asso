import { describe, it, expect, vi, afterEach } from "vitest";
import { buildAccountValidationTokenItem } from "../../dal/buildAccountValidationTokenItem.js";

const CREATED_AT_ISO = "2026-01-15T10:00:00.000Z";
const CURRENT_EPOCH_MILLISECONDS = Date.UTC(2026, 0, 15, 10, 0, 0);
const CURRENT_EPOCH_SECONDS = Math.floor(CURRENT_EPOCH_MILLISECONDS / 1000);
const TWENTY_FOUR_HOURS_IN_SECONDS = 24 * 60 * 60;

const RAW_TOKEN = { validationToken: "Zm9vYmFyYmF6cXV4LTEyMzQ1Njc4OTAtYWJjZGVm" };

function buildTokenItemWith(overrides = {}) {
    return buildAccountValidationTokenItem({
        rawToken: RAW_TOKEN,
        userId: "abc123",
        accountValidationTableName: "AccountValidationTableTest",
        currentIsoTimestampProvider: () => CREATED_AT_ISO,
        currentEpochMillisecondsProvider: () => CURRENT_EPOCH_MILLISECONDS,
        ...overrides,
    });
}

describe("buildAccountValidationTokenItem", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("builds the Put parameters exactly", () => {
        expect(buildTokenItemWith()).toEqual({
            TableName: "AccountValidationTableTest",
            Item: {
                PK: RAW_TOKEN.validationToken,
                SK: "EMAIL_VALIDATION",
                userId: "abc123",
                createdAt: CREATED_AT_ISO,
                expiredAt: CURRENT_EPOCH_SECONDS + TWENTY_FOUR_HOURS_IN_SECONDS,
            },
        });
    });

    it("uses the validation token itself as the partition key", () => {
        const tokenItem = buildTokenItemWith({
            rawToken: { validationToken: "a-different-token" },
        });

        expect(tokenItem.Item.PK).toBe("a-different-token");
    });

    it("always sets the sort key to EMAIL_VALIDATION", () => {
        expect(buildTokenItemWith().Item.SK).toBe("EMAIL_VALIDATION");
    });

    it("stores the raw user id, without the USER# prefix", () => {
        const tokenItem = buildTokenItemWith({ userId: "xyz789" });

        expect(tokenItem.Item.userId).toBe("xyz789");
        expect(tokenItem.Item.userId).not.toMatch(/^USER#/);
    });

    it("applies the given table name", () => {
        const tokenItem = buildTokenItemWith({
            accountValidationTableName: "SomeOtherTable",
        });

        expect(tokenItem.TableName).toBe("SomeOtherTable");
    });

    it("sets expiredAt to 24h after the provided epoch", () => {
        const tokenItem = buildTokenItemWith({
            currentEpochMillisecondsProvider: () => 1_000_000,
        });

        expect(tokenItem.Item.expiredAt).toBe(1000 + TWENTY_FOUR_HOURS_IN_SECONDS);
    });

    it("calls each timestamp provider exactly once", () => {
        const currentIsoTimestampProvider = vi.fn(() => CREATED_AT_ISO);
        const currentEpochMillisecondsProvider = vi.fn(() => CURRENT_EPOCH_MILLISECONDS);

        buildTokenItemWith({ currentIsoTimestampProvider, currentEpochMillisecondsProvider });

        expect(currentIsoTimestampProvider).toHaveBeenCalledTimes(1);
        expect(currentEpochMillisecondsProvider).toHaveBeenCalledTimes(1);
    });

    it("evaluates createdAt before expiredAt, as the original inlined literal did", () => {
        const providerCallOrder = [];

        buildTokenItemWith({
            currentIsoTimestampProvider: () => {
                providerCallOrder.push("createdAt");
                return CREATED_AT_ISO;
            },
            currentEpochMillisecondsProvider: () => {
                providerCallOrder.push("expiredAt");
                return CURRENT_EPOCH_MILLISECONDS;
            },
        });

        expect(providerCallOrder).toEqual(["createdAt", "expiredAt"]);
    });

    it("falls back to the real clock when no providers are supplied", () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(CREATED_AT_ISO));

        const tokenItem = buildAccountValidationTokenItem({
            rawToken: RAW_TOKEN,
            userId: "abc123",
            accountValidationTableName: "AccountValidationTableTest",
        });

        expect(tokenItem.Item.createdAt).toBe(CREATED_AT_ISO);
        expect(tokenItem.Item.expiredAt).toBe(
            CURRENT_EPOCH_SECONDS + TWENTY_FOUR_HOURS_IN_SECONDS
        );
    });

    it("returns a fresh structure on every call", () => {
        const firstTokenItem = buildTokenItemWith();
        const secondTokenItem = buildTokenItemWith();

        expect(firstTokenItem).not.toBe(secondTokenItem);

        firstTokenItem.Item.PK = "MUTATED";
        expect(secondTokenItem.Item.PK).toBe(RAW_TOKEN.validationToken);
    });
});
