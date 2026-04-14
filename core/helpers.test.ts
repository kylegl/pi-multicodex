import { describe, expect, it } from "vitest";
import { isQuotaErrorMessage } from "./errors";
import { pickBestAccount } from "./selection";
import type { Account } from "./types";
import {
	getNextResetAt,
	getWeeklyResetAt,
	isUsageUntouched,
	parseCodexUsageResponse,
} from "./usage";

function makeAccount(email: string, overrides?: Partial<Account>): Account {
	return {
		email,
		accessToken: "token",
		refreshToken: "refresh",
		expiresAt: 0,
		...overrides,
	};
}

describe("core helpers", () => {
	it("classifies quota errors", () => {
		expect(isQuotaErrorMessage("HTTP 429 Too Many Requests")).toBe(true);
		expect(isQuotaErrorMessage("usage limit reached")).toBe(true);
		expect(isQuotaErrorMessage("network error")).toBe(false);
	});

	it("parses usage windows and reset timestamps", () => {
		const parsed = parseCodexUsageResponse({
			rate_limit: {
				primary_window: { used_percent: 12.5, reset_at: 1700000000 },
				secondary_window: { used_percent: 0, reset_at: 1700003600 },
			},
		});

		expect(parsed.primary?.usedPercent).toBe(12.5);
		expect(parsed.primary?.resetAt).toBe(1700000000 * 1000);
		expect(parsed.secondary?.usedPercent).toBe(0);
		expect(parsed.secondary?.resetAt).toBe(1700003600 * 1000);
	});

	it("detects untouched usage and reset helpers", () => {
		const usage = {
			primary: { usedPercent: 0, resetAt: 2 },
			secondary: { usedPercent: 0, resetAt: 1 },
			fetchedAt: 0,
		};

		expect(isUsageUntouched(usage)).toBe(true);
		expect(getNextResetAt(usage)).toBe(1);
		expect(getWeeklyResetAt(usage)).toBe(1);
	});

	it("prefers untouched then earliest weekly reset accounts", () => {
		const accounts = [makeAccount("a"), makeAccount("b")];
		const usage = new Map([
			[
				"a",
				{
					primary: { usedPercent: 10, resetAt: 5000 },
					secondary: { usedPercent: 10, resetAt: 8000 },
					fetchedAt: 0,
				},
			],
			[
				"b",
				{
					primary: { usedPercent: 0, resetAt: 4000 },
					secondary: { usedPercent: 0, resetAt: 7000 },
					fetchedAt: 0,
				},
			],
		]);

		expect(pickBestAccount(accounts, usage, { now: 0 })?.email).toBe("b");
	});

	it("honors excludeEmails and falls back to random available accounts", () => {
		const accounts = [makeAccount("a"), makeAccount("b")];
		const usage = new Map<string, { fetchedAt: number }>();
		const selected = pickBestAccount(accounts, usage as never, {
			now: 0,
			excludeEmails: new Set(["a"]),
			random: () => 0,
		});

		expect(selected?.email).toBe("b");
	});
});
