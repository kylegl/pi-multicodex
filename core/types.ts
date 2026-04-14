export interface Account {
	email: string;
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
	accountId?: string;
	lastUsed?: number;
	quotaExhaustedUntil?: number;
}

export interface StorageData {
	schemaVersion: 1;
	accounts: Account[];
	activeEmail?: string;
}

export interface LegacyStorageData {
	accounts?: unknown;
	activeEmail?: unknown;
	schemaVersion?: unknown;
}
