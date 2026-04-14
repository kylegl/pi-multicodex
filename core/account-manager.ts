import {
	getErrorMessage,
	isAbortLikeError,
	isRetryableUsageError,
} from "./errors";
import { sleepWithSignal } from "./retry";
import { pickBestAccount } from "./selection";
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
const DEFAULT_STORAGE: StorageData = { schemaVersion: 1, accounts: [] };

function createInMemoryStorageAdapter(): StorageAdapter {
	let data = structuredClone(DEFAULT_STORAGE);
	return {
		load: () => structuredClone(data),
		save: (next) => {
			data = ensureCanonicalStorageData(next);
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

	private save(): void {
		try {
			this.storage.save(ensureCanonicalStorageData(this.data));
		} catch (error) {
			console.error("Failed to save multicodex accounts:", error);
		}
	}

	setWarningHandler(handler?: WarningHandler): void {
		this.warningHandler = handler;
	}

	getAccounts(): Account[] {
		return this.data.accounts;
	}

	getAccount(email: string): Account | undefined {
		return this.data.accounts.find((account) => account.email === email);
	}

	getActiveAccount(): Account | undefined {
		const manual = this.getManualAccount();
		if (manual) return manual;
		if (this.data.activeEmail) {
			return this.getAccount(this.data.activeEmail);
		}
		return this.data.accounts[0];
	}

	getManualAccount(): Account | undefined {
		if (!this.manualEmail) return undefined;
		const account = this.getAccount(this.manualEmail);
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
		if (!this.isAccountAvailable(manual, now)) return undefined;
		return manual;
	}

	setActiveAccount(email: string): void {
		const account = this.getAccount(email);
		if (!account) return;
		this.data.activeEmail = email;
		account.lastUsed = this.now();
		this.save();
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
		const existing = this.getAccount(email);
		if (existing) {
			existing.accessToken = creds.access;
			existing.refreshToken = creds.refresh;
			existing.expiresAt = creds.expires;
			if (typeof creds.accountId === "string") {
				existing.accountId = creds.accountId;
			}
		} else {
			this.data.accounts.push({
				email,
				accessToken: creds.access,
				refreshToken: creds.refresh,
				expiresAt: creds.expires,
				...(typeof creds.accountId === "string"
					? { accountId: creds.accountId }
					: {}),
			});
		}
		this.setActiveAccount(email);
	}

	markExhausted(email: string, until: number): void {
		const account = this.getAccount(email);
		if (account) {
			account.quotaExhaustedUntil = until;
			this.save();
		}
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

		let lastError: unknown;
		for (let attempt = 0; attempt <= USAGE_REQUEST_MAX_RETRIES; attempt++) {
			try {
				const token = await this.ensureValidToken(account);
				const usage = await this.usageClient.fetchCodexUsage(
					token,
					account.accountId,
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
		await Promise.all(
			this.getAccounts().map((account) =>
				this.refreshUsageForAccount(account, options),
			),
		);
	}

	async refreshUsageIfStale(
		accounts: Account[],
		options?: { signal?: AbortSignal },
	): Promise<void> {
		const now = this.now();
		const stale = accounts.filter((account) => {
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
		const accounts = this.data.accounts;
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
		if (this.now() < account.expiresAt - TOKEN_REFRESH_THRESHOLD_MS) {
			return account.accessToken;
		}

		const key = account.email;
		const existing = this.refreshInFlight.get(key);
		if (existing) {
			return existing;
		}

		const refreshPromise = (async () => {
			const result = await this.refreshToken(account.refreshToken);
			account.accessToken = result.access;
			account.refreshToken = result.refresh;
			account.expiresAt = result.expires;
			if (typeof result.accountId === "string") {
				account.accountId = result.accountId;
			}
			this.save();
			return account.accessToken;
		})();

		this.refreshInFlight.set(key, refreshPromise);
		try {
			return await refreshPromise;
		} finally {
			this.refreshInFlight.delete(key);
		}
	}

	private isAccountAvailable(account: Account, now: number): boolean {
		return !account.quotaExhaustedUntil || account.quotaExhaustedUntil <= now;
	}

	private clearExpiredExhaustion(now: number): void {
		let changed = false;
		for (const account of this.data.accounts) {
			if (account.quotaExhaustedUntil && account.quotaExhaustedUntil <= now) {
				account.quotaExhaustedUntil = undefined;
				changed = true;
			}
		}
		if (changed) {
			this.save();
		}
	}
}
