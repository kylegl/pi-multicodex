import type { StorageAdapter } from "./storage";
import type { Account, StorageData } from "./types";

export type TestAccountProfile = "core" | "adapter";

const ADAPTER_DEFAULT_EXPIRES_AT_MS = 60_000;

function getDefaultExpiresAt(profile: TestAccountProfile): number {
	if (profile === "adapter") {
		return Date.now() + ADAPTER_DEFAULT_EXPIRES_AT_MS;
	}
	return 0;
}

export function createTestAccount(
	email: string,
	overrides?: Partial<Account>,
	options?: { profile?: TestAccountProfile },
): Account {
	const profile = options?.profile ?? "core";
	return {
		email,
		accessToken: `${email}-access`,
		refreshToken: `${email}-refresh`,
		expiresAt: getDefaultExpiresAt(profile),
		...overrides,
	};
}

export function createMemoryStorage(
	initial: StorageData = { schemaVersion: 1, accounts: [] },
): { adapter: StorageAdapter; getData: () => StorageData } {
	let data: StorageData = structuredClone(initial);
	const adapter: StorageAdapter = {
		load: () => structuredClone(data),
		save: (next) => {
			data = structuredClone(next);
		},
	};
	return { adapter, getData: () => structuredClone(data) };
}
