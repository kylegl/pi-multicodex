import type { Account, LegacyStorageData, StorageData } from "./types";

export interface StorageAdapter {
	load(): StorageData;
	save(data: StorageData): void;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeAccount(value: unknown): Account | undefined {
	if (!isPlainObject(value)) return undefined;
	const email = typeof value.email === "string" ? value.email : undefined;
	const accessToken =
		typeof value.accessToken === "string" ? value.accessToken : undefined;
	const refreshToken =
		typeof value.refreshToken === "string" ? value.refreshToken : undefined;
	const expiresAt =
		typeof value.expiresAt === "number" && Number.isFinite(value.expiresAt)
			? value.expiresAt
			: undefined;
	if (!email || !accessToken || !refreshToken || expiresAt === undefined) {
		return undefined;
	}

	const account: Account = { email, accessToken, refreshToken, expiresAt };
	if (typeof value.accountId === "string") account.accountId = value.accountId;
	if (typeof value.lastUsed === "number" && Number.isFinite(value.lastUsed)) {
		account.lastUsed = value.lastUsed;
	}
	if (
		typeof value.quotaExhaustedUntil === "number" &&
		Number.isFinite(value.quotaExhaustedUntil)
	) {
		account.quotaExhaustedUntil = value.quotaExhaustedUntil;
	}
	return account;
}

function normalizeAccounts(value: unknown): Account[] {
	if (!Array.isArray(value)) return [];
	return value
		.map(normalizeAccount)
		.filter((entry): entry is Account => !!entry);
}

export function migrateStorageData(raw: unknown): StorageData {
	if (!isPlainObject(raw)) {
		return { schemaVersion: 1, accounts: [] };
	}

	const accounts = normalizeAccounts(raw.accounts);
	const activeEmail =
		typeof raw.activeEmail === "string" ? raw.activeEmail : undefined;

	return {
		schemaVersion: 1,
		accounts,
		...(activeEmail ? { activeEmail } : {}),
	};
}

export function ensureCanonicalStorageData(data: StorageData): StorageData {
	return {
		schemaVersion: 1,
		accounts: data.accounts.map((account) => ({ ...account })),
		...(typeof data.activeEmail === "string"
			? { activeEmail: data.activeEmail }
			: {}),
	};
}

export function isLegacyStorageData(
	value: unknown,
): value is LegacyStorageData {
	return isPlainObject(value) && !("schemaVersion" in value);
}
