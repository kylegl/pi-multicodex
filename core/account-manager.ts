import {
	getErrorMessage,
	isAbortLikeError,
	isRetryableUsageError,
} from "./errors";
import { sleepWithSignal } from "./retry";
import { isAccountAvailable, pickBestAccount } from "./selection";
import {
	ensureCanonicalStorageData,
	migrateStorageData,
	type StorageAdapter,
} from "./storage";
import type { Account, StorageData } from "./types";
import { type CodexUsageSnapshot, getNextResetAt } from "./usage";
import { type CodexUsageClient, createCodexUsageClient } from "./usage-client";

export interface RefreshTokenResult {
	access: string;
	refresh: string;
	expires: number;
	accountId?: string;
}

export type RefreshTokenFn = (
	refreshToken: string,
) => Promise<RefreshTokenResult>;
export type WarningHandler = (message: string) => void;
export type Clock = () => number;
export type RandomSource = () => number;

export interface AccountManagerDeps {
	storage?: StorageAdapter;
	usageClient?: CodexUsageClient;
	refreshToken?: RefreshTokenFn;
	clock?: Clock;
	random?: RandomSource;
	warningHandler?: WarningHandler;
}

const USAGE_CACHE_TTL_MS = 5 * 60 * 1000;
const USAGE_REQUEST_MAX_RETRIES = 2;
const USAGE_RETRY_BACKOFF_MS = [300, 900] as const;
const TOKEN_REFRESH_THRESHOLD_MS = 5 * 60 * 1000;
const QUOTA_COOLDOWN_MS = 60 * 60 * 1000;
const TOKEN_REFRESH_FAILURE_COOLDOWN_MS = 10 * 60 * 1000;
const DEFAULT_STORAGE: StorageData = { schemaVersion: 1, accounts: [] };

function createInMemoryStorageAdapter(): StorageAdapter {
	let data = structuredClone(DEFAULT_STORAGE);
	return {
		load: () => structuredClone(data),
		save: (next) => {
			data = ensureCanonicalStorageData(next);
		},
		update: (mutator) => {
			const next = ensureCanonicalStorageData(mutator(structuredClone(data)));
			data = next;
			return structuredClone(data);
		},
	};
}

async function defaultRefreshTokenFn(): Promise<RefreshTokenResult> {
	throw new Error("OpenAI Codex OAuth token refresh is unavailable.");
}

export class AccountManager {
	private readonly storage: StorageAdapter;
	private readonly usageClient: CodexUsageClient;
	private readonly refreshToken: RefreshTokenFn;
	private readonly clock: Clock;
	private readonly random: RandomSource;
	private warningHandler?: WarningHandler;
	private manualEmail?: string;
	private data: StorageData;
	private readonly usageCache = new Map<string, CodexUsageSnapshot>();
	private readonly refreshInFlight = new Map<string, Promise<string>>();
	private readonly refreshFailures = new Map<
		string,
		{ until: number; reason: string }
	>();

	constructor(deps: AccountManagerDeps = {}) {
		this.storage = deps.storage ?? createInMemoryStorageAdapter();
		this.usageClient = deps.usageClient ?? createCodexUsageClient();
		this.refreshToken = deps.refreshToken ?? defaultRefreshTokenFn;
		this.clock = deps.clock ?? (() => Date.now());
		this.random = deps.random ?? Math.random;
		this.warningHandler = deps.warningHandler;
		this.data = this.load();
	}

	private now(): number {
		return this.clock();
	}

	private load(): StorageData {
		try {
			const raw = this.storage.load();
			return migrateStorageData(raw);
		} catch (error) {
			console.error("Failed to load multicodex accounts:", error);
			return structuredClone(DEFAULT_STORAGE);
		}
	}

	private syncFromStorage(): void {
		this.data = this.load();
	}

	private updateStorage(mutator: (data: StorageData) => boolean): void {
		const applyMutator = (current: StorageData): StorageData => {
			const canonicalCurrent = ensureCanonicalStorageData(current);
			const next = ensureCanonicalStorageData(canonicalCurrent);
			const changed = mutator(next);
			return changed ? next : canonicalCurrent;
		};

		try {
			if (this.storage.update) {
				this.data = this.storage.update(applyMutator);
				return;
			}

			const current = this.load();
			const next = applyMutator(current);
			if (JSON.stringify(current) !== JSON.stringify(next)) {
				this.storage.save(next);
			}
			this.data = next;
		} catch (error) {
			console.error("Failed to update multicodex accounts:", error);
			this.syncFromStorage();
		}
	}

	setWarningHandler(handler?: WarningHandler): void {
		this.warningHandler = handler;
	}

	isRefreshBlocked(email: string, options?: { now?: number }): boolean {
		return Boolean(this.getRefreshFailure(email, options?.now));
	}

	getRefreshBlockedReason(
		email: string,
		options?: { now?: number },
	): string | undefined {
		return this.getRefreshFailure(email, options?.now)?.reason;
	}

	getAccounts(): Account[] {
		this.syncFromStorage();
		return this.data.accounts;
	}

	getAccount(email: string): Account | undefined {
		this.syncFromStorage();
		return this.data.accounts.find((account) => account.email === email);
	}

	getActiveAccount(): Account | undefined {
		this.syncFromStorage();
		const manual = this.getManualAccount();
		if (manual) return manual;
		if (this.data.activeEmail) {
			return this.data.accounts.find(
				(account) => account.email === this.data.activeEmail,
			);
		}
		return this.data.accounts[0];
	}

	getManualAccount(): Account | undefined {
		this.syncFromStorage();
		if (!this.manualEmail) return undefined;
		const account = this.data.accounts.find(
			(entry) => entry.email === this.manualEmail,
		);
		if (!account) {
			this.manualEmail = undefined;
			return undefined;
		}
		return account;
	}

	hasManualAccount(): boolean {
		return Boolean(this.getManualAccount());
	}

	getAvailableManualAccount(options?: {
		now?: number;
		excludeEmails?: Set<string>;
	}): Account | undefined {
		const now = options?.now ?? this.now();
		this.clearExpiredExhaustion(now);
		const manual = this.getManualAccount();
		if (!manual) return undefined;
		if (options?.excludeEmails?.has(manual.email)) return undefined;
		if (!isAccountAvailable(manual, now)) return undefined;
		if (this.isRefreshBlocked(manual.email, { now })) return undefined;
		return manual;
	}

	setActiveAccount(email: string): void {
		const now = this.now();
		this.updateStorage((data) => {
			const account = data.accounts.find((entry) => entry.email === email);
			if (!account) return false;
			data.activeEmail = email;
			account.lastUsed = now;
			return true;
		});
	}

	setManualAccount(email: string): void {
		const account = this.getAccount(email);
		if (!account) return;
		this.manualEmail = email;
		account.lastUsed = this.now();
	}

	clearManualAccount(): void {
		this.manualEmail = undefined;
	}

	addOrUpdateAccount(email: string, creds: RefreshTokenResult): void {
		const now = this.now();
		this.updateStorage((data) => {
			const existing = data.accounts.find((entry) => entry.email === email);
			if (existing) {
				existing.accessToken = creds.access;
				existing.refreshToken = creds.refresh;
				existing.expiresAt = creds.expires;
				if (typeof creds.accountId === "string") {
					existing.accountId = creds.accountId;
				}
				existing.lastUsed = now;
			} else {
				data.accounts.push({
					email,
					accessToken: creds.access,
					refreshToken: creds.refresh,
					expiresAt: creds.expires,
					lastUsed: now,
					...(typeof creds.accountId === "string"
						? { accountId: creds.accountId }
						: {}),
				});
			}
			data.activeEmail = email;
			return true;
		});
		this.clearRefreshFailure(email);
	}

	removeAccount(email: string): boolean {
		let removed = false;
		if (this.manualEmail === email) {
			this.manualEmail = undefined;
		}
		this.updateStorage((data) => {
			const nextAccounts = data.accounts.filter(
				(entry) => entry.email !== email,
			);
			if (nextAccounts.length === data.accounts.length) {
				return false;
			}
			data.accounts = nextAccounts;
			if (data.activeEmail === email) {
				data.activeEmail = nextAccounts[0]?.email;
			}
			removed = true;
			return true;
		});
		if (removed) {
			this.usageCache.delete(email);
			this.refreshFailures.delete(email);
			this.refreshInFlight.delete(email);
		}
		return removed;
	}

	markExhausted(email: string, until: number): void {
		this.updateStorage((data) => {
			const account = data.accounts.find((entry) => entry.email === email);
			if (!account) return false;
			if (account.quotaExhaustedUntil === until) return false;
			account.quotaExhaustedUntil = until;
			return true;
		});
	}

	getCachedUsage(email: string): CodexUsageSnapshot | undefined {
		return this.usageCache.get(email);
	}

	async refreshUsageForAccount(
		account: Account,
		options?: { force?: boolean; signal?: AbortSignal },
	): Promise<CodexUsageSnapshot | undefined> {
		const cached = this.usageCache.get(account.email);
		const now = this.now();
		if (
			cached &&
			!options?.force &&
			now - cached.fetchedAt < USAGE_CACHE_TTL_MS
		) {
			return cached;
		}

		if (this.isRefreshBlocked(account.email, { now })) {
			return cached;
		}

		let lastError: unknown;
		for (let attempt = 0; attempt <= USAGE_REQUEST_MAX_RETRIES; attempt++) {
			try {
				const token = await this.ensureValidToken(account);
				const latest = this.getAccount(account.email);
				const usage = await this.usageClient.fetchCodexUsage(
					token,
					latest?.accountId,
					{ signal: options?.signal },
				);
				this.usageCache.set(account.email, usage);
				return usage;
			} catch (error) {
				lastError = error;
				const willRetry =
					attempt < USAGE_REQUEST_MAX_RETRIES && isRetryableUsageError(error);
				if (!willRetry) break;
				const backoffMs =
					USAGE_RETRY_BACKOFF_MS[
						Math.min(attempt, USAGE_RETRY_BACKOFF_MS.length - 1)
					];
				console.debug(
					`[multicodex] Usage fetch retry ${attempt + 1}/${USAGE_REQUEST_MAX_RETRIES} for ${account.email} after: ${getErrorMessage(error)}`,
				);
				await sleepWithSignal(backoffMs, options?.signal);
			}
		}

		if (isAbortLikeError(lastError)) {
			console.debug(
				`[multicodex] Usage fetch aborted for ${account.email}: ${getErrorMessage(lastError)}`,
			);
			return cached;
		}
		this.warningHandler?.(
			`Multicodex: failed to fetch usage for ${account.email}: ${getErrorMessage(lastError)}`,
		);
		return cached;
	}

	async refreshUsageForAllAccounts(options?: {
		force?: boolean;
		signal?: AbortSignal;
	}): Promise<void> {
		const now = this.now();
		const accounts = this.getAccounts().filter(
			(account) => !this.isRefreshBlocked(account.email, { now }),
		);
		await Promise.all(
			accounts.map((account) => this.refreshUsageForAccount(account, options)),
		);
	}

	async refreshUsageIfStale(
		accounts: Account[],
		options?: { signal?: AbortSignal },
	): Promise<void> {
		const now = this.now();
		const stale = accounts.filter((account) => {
			if (this.isRefreshBlocked(account.email, { now })) {
				return false;
			}
			const cached = this.usageCache.get(account.email);
			return !cached || now - cached.fetchedAt >= USAGE_CACHE_TTL_MS;
		});
		if (stale.length === 0) return;
		await Promise.all(
			stale.map((account) =>
				this.refreshUsageForAccount(account, { force: true, ...options }),
			),
		);
	}

	async activateBestAccount(options?: {
		excludeEmails?: Set<string>;
		signal?: AbortSignal;
	}): Promise<Account | undefined> {
		const now = this.now();
		this.clearExpiredExhaustion(now);
		const accounts = this.getAccounts().filter(
			(account) => !this.isRefreshBlocked(account.email, { now }),
		);
		await this.refreshUsageIfStale(accounts, options);

		const selected = pickBestAccount(accounts, this.usageCache, {
			excludeEmails: options?.excludeEmails,
			now,
			random: this.random,
		});
		if (selected) {
			this.setActiveAccount(selected.email);
		}
		return selected;
	}

	async handleQuotaExceeded(
		account: Account,
		options?: { signal?: AbortSignal },
	): Promise<void> {
		const usage = await this.refreshUsageForAccount(account, {
			force: true,
			signal: options?.signal,
		});
		const now = this.now();
		const resetAt = getNextResetAt(usage);
		const fallback = now + QUOTA_COOLDOWN_MS;
		const until = resetAt && resetAt > now ? resetAt : fallback;
		this.markExhausted(account.email, until);
	}

	async ensureValidToken(account: Account): Promise<string> {
		this.syncFromStorage();
		const latestAccount = this.data.accounts.find(
			(entry) => entry.email === account.email,
		);
		if (!latestAccount) {
			throw new Error(
				`Multicodex account ${account.email} is not available. Run /multicodex-login ${account.email}.`,
			);
		}

		const now = this.now();
		const blockedReason = this.getRefreshBlockedReason(latestAccount.email, {
			now,
		});
		if (blockedReason) {
			if (now < latestAccount.expiresAt - TOKEN_REFRESH_THRESHOLD_MS) {
				this.clearRefreshFailure(latestAccount.email);
				return latestAccount.accessToken;
			}
			throw new Error(blockedReason);
		}

		if (now < latestAccount.expiresAt - TOKEN_REFRESH_THRESHOLD_MS) {
			return latestAccount.accessToken;
		}

		const key = latestAccount.email;
		const existing = this.refreshInFlight.get(key);
		if (existing) {
			return existing;
		}

		const refreshPromise = (async () => {
			try {
				const result = await this.refreshToken(latestAccount.refreshToken);
				let persisted = false;
				this.updateStorage((data) => {
					const target = data.accounts.find(
						(entry) => entry.email === latestAccount.email,
					);
					if (!target) return false;
					target.accessToken = result.access;
					target.refreshToken = result.refresh;
					target.expiresAt = result.expires;
					if (typeof result.accountId === "string") {
						target.accountId = result.accountId;
					}
					persisted = true;
					return true;
				});
				if (!persisted) {
					throw new Error(
						`Multicodex account ${latestAccount.email} was removed before refresh completed.`,
					);
				}
				this.clearRefreshFailure(latestAccount.email);
				return result.access;
			} catch (error) {
				const reason = this.formatRefreshFailureReason(latestAccount, error);
				this.setRefreshFailure(latestAccount.email, reason);
				throw new Error(reason);
			}
		})();

		this.refreshInFlight.set(key, refreshPromise);
		try {
			return await refreshPromise;
		} finally {
			this.refreshInFlight.delete(key);
		}
	}

	private getRefreshFailure(
		email: string,
		now = this.now(),
	): { until: number; reason: string } | undefined {
		const failure = this.refreshFailures.get(email);
		if (!failure) return undefined;
		if (failure.until <= now) {
			this.refreshFailures.delete(email);
			return undefined;
		}
		return failure;
	}

	private setRefreshFailure(email: string, reason: string): void {
		this.refreshFailures.set(email, {
			until: this.now() + TOKEN_REFRESH_FAILURE_COOLDOWN_MS,
			reason,
		});
	}

	private clearRefreshFailure(email: string): void {
		this.refreshFailures.delete(email);
	}

	private formatRefreshFailureReason(account: Account, error: unknown): string {
		const message = getErrorMessage(error);
		if (
			message.startsWith(`Token refresh failed for ${account.email}`) ||
			message.startsWith(`Multicodex account ${account.email} was removed`)
		) {
			return message;
		}
		const cooldownMinutes = Math.floor(
			TOKEN_REFRESH_FAILURE_COOLDOWN_MS / (60 * 1000),
		);
		const cooldownHint = `Pausing automatic refresh attempts for ${cooldownMinutes} minutes.`;
		const loginHint = `Run /multicodex-login ${account.email} to re-authenticate this account.`;
		if (/failed to refresh openai codex token/i.test(message)) {
			return `Token refresh failed for ${account.email}. ${loginHint} ${cooldownHint}`;
		}
		return `Token refresh failed for ${account.email}: ${message}. ${cooldownHint}`;
	}

	private clearExpiredExhaustion(now: number): void {
		this.updateStorage((data) => {
			let changed = false;
			for (const account of data.accounts) {
				if (account.quotaExhaustedUntil && account.quotaExhaustedUntil <= now) {
					account.quotaExhaustedUntil = undefined;
					changed = true;
				}
			}
			return changed;
		});
	}
}
