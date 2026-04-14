import { describe, expect, it, vi } from "vitest";
import { AccountManager, type RefreshTokenResult } from "./account-manager";
import type { StorageAdapter } from "./storage";
import type { Account, StorageData } from "./types";

function makeAccount(email: string, overrides?: Partial<Account>): Account {
	return {
		email,
		accessToken: `${email}-access`,
		refreshToken: `${email}-refresh`,
		expiresAt: 0,
		...overrides,
	};
}

function createMemoryStorage(
	initial: StorageData = { schemaVersion: 1, accounts: [] },
) {
	let data: StorageData = structuredClone(initial);
	const adapter: StorageAdapter = {
		load: () => structuredClone(data),
		save: (next) => {
			data = structuredClone(next);
		},
	};
	return { adapter, getData: () => structuredClone(data) };
}

describe("AccountManager without pi runtime", () => {
	it("uses a manual account before auto-selection", async () => {
		const { adapter } = createMemoryStorage({
			schemaVersion: 1,
			accounts: [
				makeAccount("manual@example.com"),
				makeAccount("auto@example.com"),
			],
		});
		const manager = new AccountManager({
			storage: adapter,
			refreshToken: vi.fn(
				async (refreshToken: string): Promise<RefreshTokenResult> => ({
					access: `${refreshToken}-refreshed`,
					refresh: `${refreshToken}-next`,
					expires: Date.now() + 60_000,
				}),
			),
			usageClient: { fetchCodexUsage: vi.fn() },
		});

		manager.setManualAccount("manual@example.com");
		expect(manager.getAvailableManualAccount()).toMatchObject({
			email: "manual@example.com",
		});
		expect(manager.hasManualAccount()).toBe(true);
	});

	it("refreshes usage with cache, retries, and abort fallback", async () => {
		const now = vi.fn(() => 1_000_000);
		const usage = {
			primary: { usedPercent: 0, resetAt: 2_000_000 },
			secondary: { usedPercent: 0, resetAt: 3_000_000 },
			fetchedAt: 0,
		};
		let calls = 0;
		const manager = new AccountManager({
			storage: createMemoryStorage({
				schemaVersion: 1,
				accounts: [makeAccount("a@example.com")],
			}).adapter,
			clock: now,
			refreshToken: vi.fn(
				async (refreshToken: string): Promise<RefreshTokenResult> => ({
					access: `${refreshToken}-refreshed`,
					refresh: `${refreshToken}-next`,
					expires: 2_000_000,
				}),
			),
			usageClient: {
				fetchCodexUsage: vi.fn(async () => {
					calls += 1;
					if (calls < 3) {
						throw new Error("Usage request failed: 429");
					}
					return { ...usage, fetchedAt: now() };
				}),
			},
		});

		const account = manager.getAccount("a@example.com");
		if (!account) throw new Error("missing account");
		const refreshed = await manager.refreshUsageForAccount(account, {
			force: true,
		});
		expect(refreshed?.primary?.usedPercent).toBe(0);
		expect(calls).toBe(3);

		const cached = await manager.refreshUsageForAccount(account);
		expect(cached).toBe(refreshed);
		expect(calls).toBe(3);

		const aborted = await manager.refreshUsageForAccount(account, {
			force: true,
			signal: AbortSignal.abort(),
		});
		expect(aborted).toEqual(refreshed);
	});

	it("refreshes expired tokens once per account and keeps fresh tokens", async () => {
		const refreshToken = vi.fn(
			async (refreshToken: string): Promise<RefreshTokenResult> => ({
				access: `${refreshToken}-new-access`,
				refresh: `${refreshToken}-new-refresh`,
				expires: Date.now() + 60_000,
			}),
		);
		const manager = new AccountManager({
			storage: createMemoryStorage({
				schemaVersion: 1,
				accounts: [makeAccount("a@example.com", { expiresAt: 0 })],
			}).adapter,
			refreshToken,
			usageClient: { fetchCodexUsage: vi.fn() },
		});

		const account = manager.getAccount("a@example.com");
		if (!account) throw new Error("missing account");
		const [one, two] = await Promise.all([
			manager.ensureValidToken(account),
			manager.ensureValidToken(account),
		]);

		expect(one).toBe("a@example.com-refresh-new-access");
		expect(two).toBe(one);
		expect(refreshToken).toHaveBeenCalledTimes(1);

		account.expiresAt = Date.now() + 6 * 60 * 1000;
		await manager.ensureValidToken(account);
		expect(refreshToken).toHaveBeenCalledTimes(1);
	});

	it("marks exhausted accounts using reset time or fallback cooldown", async () => {
		let now = 1_000;
		const manager = new AccountManager({
			storage: createMemoryStorage({
				schemaVersion: 1,
				accounts: [makeAccount("a@example.com")],
			}).adapter,
			clock: () => now,
			refreshToken: vi.fn(
				async (refreshToken: string): Promise<RefreshTokenResult> => ({
					access: `${refreshToken}-refreshed`,
					refresh: `${refreshToken}-next`,
					expires: now + 60_000,
				}),
			),
			usageClient: {
				fetchCodexUsage: vi.fn(async () => ({
					primary: { usedPercent: 99, resetAt: 9_999 },
					secondary: { usedPercent: 99, resetAt: 8_888 },
					fetchedAt: now,
				})),
			},
		});

		const account = manager.getAccount("a@example.com");
		if (!account) throw new Error("missing account");
		await manager.handleQuotaExceeded(account);
		expect(account.quotaExhaustedUntil).toBe(8_888);

		now = 10_000;
		await manager.handleQuotaExceeded(account);
		expect(account.quotaExhaustedUntil).toBe(10_000 + 60 * 60 * 1000);
	});
});
