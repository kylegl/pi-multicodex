import { describe, expect, it } from "vitest";
import { ensureCanonicalStorageData, migrateStorageData } from "./storage";

describe("storage migration", () => {
	it("normalizes legacy unversioned storage into canonical schema", () => {
		const migrated = migrateStorageData({
			accounts: [
				{
					email: "a@example.com",
					accessToken: "access",
					refreshToken: "refresh",
					expiresAt: 123,
					lastUsed: 456,
					quotaExhaustedUntil: 789,
				},
				{ email: "invalid" },
			],
			activeEmail: "a@example.com",
		});

		expect(migrated).toEqual({
			schemaVersion: 1,
			accounts: [
				{
					email: "a@example.com",
					accessToken: "access",
					refreshToken: "refresh",
					expiresAt: 123,
					lastUsed: 456,
					quotaExhaustedUntil: 789,
				},
			],
			activeEmail: "a@example.com",
		});

		expect(ensureCanonicalStorageData(migrated)).toEqual(migrated);
	});
});
