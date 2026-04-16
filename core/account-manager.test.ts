import { describe, expect, it, vi } from "vitest";
import { AccountManager, type RefreshTokenResult } from "./account-manager";
import { createMemoryStorage, createTestAccount } from "./test-helpers";

describe("AccountManager without pi runtime", () => {
	it("uses a manual account before auto-selection", async () => {
		const { adapter } = createMemoryStorage({
			schemaVersion: 1,
			accounts: [
				createTestAccount("manual@example.com"),
				createTestAccount("auto@example.com"),
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
				accounts: [createTestAccount("a@example.com")],
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

	it("reuses a single in-flight token refresh and keeps fresh tokens unchanged", async () => {
		let refreshCount = 0;
		const manager = new AccountManager({
			storage: createMemoryStorage({
				schemaVersion: 1,
				accounts: [createTestAccount("a@example.com", { expiresAt: 0 })],
			}).adapter,
			refreshToken: async (
				refreshToken: string,
			): Promise<RefreshTokenResult> => {
				refreshCount += 1;
				await new Promise((resolve) => setTimeout(resolve, 5));
				return {
					access: `${refreshToken}-new-access-${refreshCount}`,
					refresh: `${refreshToken}-new-refresh-${refreshCount}`,
					expires: Date.now() + 60_000,
				};
			},
			usageClient: { fetchCodexUsage: vi.fn() },
		});

		const account = manager.getAccount("a@example.com");
		if (!account) throw new Error("missing account");
		const [one, two] = await Promise.all([
			manager.ensureValidToken(account),
			manager.ensureValidToken(account),
		]);

		expect(one).toBe(two);
		expect(one).toBe("a@example.com-refresh-new-access-1");
		expect(account.refreshToken).toBe("a@example.com-refresh-new-refresh-1");

		account.expiresAt = Date.now() + 6 * 60 * 1000;
		const stillFresh = await manager.ensureValidToken(account);
		expect(stillFresh).toBe(one);
		expect(account.accessToken).toBe(one);
	});

	it("activates best account and persists active selection metadata", async () => {
		const now = 1_000_000;
		const { adapter, getData } = createMemoryStorage({
			schemaVersion: 1,
			accounts: [
				createTestAccount("used@example.com", { expiresAt: now + 60_000 }),
				createTestAccount("fresh@example.com", { expiresAt: now + 60_000 }),
			],
		});
		const manager = new AccountManager({
			storage: adapter,
			clock: () => now,
			refreshToken: vi.fn(
				async (refreshToken: string): Promise<RefreshTokenResult> => ({
					access: `${refreshToken}-refreshed`,
					refresh: `${refreshToken}-next`,
					expires: now + 60_000,
				}),
			),
			usageClient: {
				fetchCodexUsage: vi.fn(async (token: string) => {
					if (token.includes("used@example.com")) {
						return {
							primary: { usedPercent: 45, resetAt: now + 50_000 },
							secondary: { usedPercent: 30, resetAt: now + 60_000 },
							fetchedAt: now,
						};
					}
					return {
						primary: { usedPercent: 0, resetAt: now + 70_000 },
						secondary: { usedPercent: 0, resetAt: now + 80_000 },
						fetchedAt: now,
					};
				}),
			},
		});

		const selected = await manager.activateBestAccount();
		expect(selected?.email).toBe("fresh@example.com");
		expect(manager.getActiveAccount()?.email).toBe("fresh@example.com");

		const saved = getData();
		expect(saved.activeEmail).toBe("fresh@example.com");
		expect(
			saved.accounts.find((account) => account.email === "fresh@example.com")
				?.lastUsed,
		).toBe(now);
	});

	it("marks exhausted accounts using reset time or fallback cooldown", async () => {
		let now = 1_000;
		const manager = new AccountManager({
			storage: createMemoryStorage({
				schemaVersion: 1,
				accounts: [createTestAccount("a@example.com")],
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
