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
		const refreshed = manager.getAccount("a@example.com");
		if (!refreshed) throw new Error("missing refreshed account");
		expect(refreshed.refreshToken).toBe("a@example.com-refresh-new-refresh-1");

		manager.addOrUpdateAccount("a@example.com", {
			access: one,
			refresh: refreshed.refreshToken,
			expires: Date.now() + 6 * 60 * 1000,
		});
		const persisted = manager.getAccount("a@example.com");
		if (!persisted) throw new Error("missing persisted account");
		const stillFresh = await manager.ensureValidToken(persisted);
		expect(stillFresh).toBe(one);
		expect(manager.getAccount("a@example.com")?.accessToken).toBe(one);
	});

	it("backs off repeated refresh failures and clears block after re-login", async () => {
		const refreshToken = vi.fn(async (): Promise<RefreshTokenResult> => {
			throw new Error("Failed to refresh OpenAI Codex token");
		});
		const manager = new AccountManager({
			storage: createMemoryStorage({
				schemaVersion: 1,
				accounts: [createTestAccount("a@example.com", { expiresAt: 0 })],
			}).adapter,
			refreshToken,
			usageClient: { fetchCodexUsage: vi.fn() },
		});

		const account = manager.getAccount("a@example.com");
		if (!account) throw new Error("missing account");

		await expect(manager.ensureValidToken(account)).rejects.toThrow(
			"Run /multicodex-login a@example.com",
		);
		await expect(manager.ensureValidToken(account)).rejects.toThrow(
			"Run /multicodex-login a@example.com",
		);
		expect(refreshToken).toHaveBeenCalledTimes(1);
		expect(manager.isRefreshBlocked("a@example.com")).toBe(true);

		manager.addOrUpdateAccount("a@example.com", {
			access: "a@example.com-access-recovered",
			refresh: "a@example.com-refresh-recovered",
			expires: Date.now() + 10 * 60 * 1000,
		});

		expect(manager.isRefreshBlocked("a@example.com")).toBe(false);
		const recovered = await manager.ensureValidToken(account);
		expect(recovered).toBe("a@example.com-access-recovered");
		expect(refreshToken).toHaveBeenCalledTimes(1);
	});

	it("uses newly re-logged credentials from another manager even when blocked", async () => {
		const now = Date.now();
		const shared = createMemoryStorage({
			schemaVersion: 1,
			accounts: [createTestAccount("a@example.com", { expiresAt: 0 })],
		});
		const refreshToken = vi.fn(async (): Promise<RefreshTokenResult> => {
			throw new Error("Failed to refresh OpenAI Codex token");
		});
		const blocked = new AccountManager({
			storage: shared.adapter,
			refreshToken,
			usageClient: { fetchCodexUsage: vi.fn() },
		});
		const relogin = new AccountManager({
			storage: shared.adapter,
			refreshToken: vi.fn(
				async (token: string): Promise<RefreshTokenResult> => ({
					access: `${token}-access`,
					refresh: `${token}-refresh`,
					expires: now + 60_000,
				}),
			),
			usageClient: { fetchCodexUsage: vi.fn() },
		});

		const stale = blocked.getAccount("a@example.com");
		if (!stale) throw new Error("missing account");
		await expect(blocked.ensureValidToken(stale)).rejects.toThrow(
			"Run /multicodex-login a@example.com",
		);
		expect(blocked.isRefreshBlocked("a@example.com")).toBe(true);

		relogin.addOrUpdateAccount("a@example.com", {
			access: "fresh-access",
			refresh: "fresh-refresh",
			expires: now + 10 * 60_000,
		});

		const recovered = await blocked.ensureValidToken(stale);
		expect(recovered).toBe("fresh-access");
		expect(blocked.isRefreshBlocked("a@example.com")).toBe(false);
		expect(refreshToken).toHaveBeenCalledTimes(1);
	});

	it("removes accounts and clears active/manual state", () => {
		const manager = new AccountManager({
			storage: createMemoryStorage({
				schemaVersion: 1,
				accounts: [
					createTestAccount("a@example.com", {
						expiresAt: Date.now() + 60_000,
					}),
					createTestAccount("b@example.com", {
						expiresAt: Date.now() + 60_000,
					}),
				],
				activeEmail: "a@example.com",
			}).adapter,
			refreshToken: vi.fn(async (refreshToken: string) => ({
				access: `${refreshToken}-access`,
				refresh: `${refreshToken}-refresh`,
				expires: Date.now() + 60_000,
			})),
			usageClient: { fetchCodexUsage: vi.fn() },
		});

		manager.setManualAccount("a@example.com");
		expect(manager.removeAccount("a@example.com")).toBe(true);
		expect(manager.getAccount("a@example.com")).toBeUndefined();
		expect(manager.getActiveAccount()?.email).toBe("b@example.com");
		expect(manager.getManualAccount()).toBeUndefined();
	});

	it("keeps refreshed credentials when another manager updates metadata", () => {
		const now = Date.now();
		const shared = createMemoryStorage({
			schemaVersion: 1,
			accounts: [
				createTestAccount("a@example.com", {
					accessToken: "old-access",
					refreshToken: "old-refresh",
					expiresAt: now + 30_000,
				}),
			],
			activeEmail: "a@example.com",
		});
		const one = new AccountManager({
			storage: shared.adapter,
			refreshToken: vi.fn(async (refreshToken: string) => ({
				access: `${refreshToken}-new-access`,
				refresh: `${refreshToken}-new-refresh`,
				expires: now + 5 * 60_000,
			})),
			usageClient: { fetchCodexUsage: vi.fn() },
		});
		const two = new AccountManager({
			storage: shared.adapter,
			refreshToken: vi.fn(async (refreshToken: string) => ({
				access: `${refreshToken}-new-access`,
				refresh: `${refreshToken}-new-refresh`,
				expires: now + 5 * 60_000,
			})),
			usageClient: { fetchCodexUsage: vi.fn() },
		});

		one.addOrUpdateAccount("a@example.com", {
			access: "relogin-access",
			refresh: "relogin-refresh",
			expires: now + 10 * 60_000,
		});
		two.setActiveAccount("a@example.com");

		const persisted = shared.getData();
		expect(persisted.accounts[0]?.accessToken).toBe("relogin-access");
		expect(persisted.accounts[0]?.refreshToken).toBe("relogin-refresh");
		expect(persisted.activeEmail).toBe("a@example.com");
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
		expect(manager.getAccount("a@example.com")?.quotaExhaustedUntil).toBe(
			8_888,
		);

		now = 10_000;
		const next = manager.getAccount("a@example.com");
		if (!next) throw new Error("missing account after first exhaustion mark");
		await manager.handleQuotaExceeded(next);
		expect(manager.getAccount("a@example.com")?.quotaExhaustedUntil).toBe(
			10_000 + 60 * 60 * 1000,
		);
	});
});
