import type { Account } from "./types";
import {
	type CodexUsageSnapshot,
	getWeeklyResetAt,
	isUsageUntouched,
} from "./usage";

export function getAccountQuotaBucket(account: Account): string {
	return account.accountId
		? `${account.email}:${account.accountId}`
		: account.email;
}

export function getExhaustedQuotaBuckets(
	accounts: Account[],
	now: number,
): Set<string> {
	const exhausted = new Set<string>();
	for (const account of accounts) {
		if (account.quotaExhaustedUntil && account.quotaExhaustedUntil > now) {
			exhausted.add(getAccountQuotaBucket(account));
		}
	}
	return exhausted;
}

export function isAccountAvailable(
	account: Account,
	now: number,
	exhaustedBuckets: Set<string> = new Set(),
): boolean {
	return (
		(!account.quotaExhaustedUntil || account.quotaExhaustedUntil <= now) &&
		!exhaustedBuckets.has(getAccountQuotaBucket(account))
	);
}

export function pickRandomAccount(
	accounts: Account[],
	random: () => number = Math.random,
): Account | undefined {
	if (accounts.length === 0) return undefined;
	return accounts[Math.floor(random() * accounts.length)];
}

export function pickEarliestWeeklyResetAccount(
	accounts: Account[],
	usageByEmail: Map<string, CodexUsageSnapshot>,
): Account | undefined {
	const candidates = accounts
		.map((account) => ({
			account,
			resetAt: getWeeklyResetAt(usageByEmail.get(account.email)),
		}))
		.filter(
			(entry): entry is { account: Account; resetAt: number } =>
				typeof entry.resetAt === "number",
		)
		.sort((a, b) => a.resetAt - b.resetAt);

	return candidates[0]?.account;
}

export function pickBestAccount(
	accounts: Account[],
	usageByEmail: Map<string, CodexUsageSnapshot>,
	options?: {
		excludeEmails?: Set<string>;
		now?: number;
		random?: () => number;
	},
): Account | undefined {
	const now = options?.now ?? Date.now();
	const exhaustedBuckets = getExhaustedQuotaBuckets(accounts, now);
	const available = accounts.filter(
		(account) =>
			isAccountAvailable(account, now, exhaustedBuckets) &&
			!options?.excludeEmails?.has(account.email),
	);
	if (available.length === 0) return undefined;

	const withUsage = available.filter((account) =>
		usageByEmail.has(account.email),
	);
	const untouched = withUsage.filter((account) =>
		isUsageUntouched(usageByEmail.get(account.email)),
	);

	if (untouched.length > 0) {
		return (
			pickEarliestWeeklyResetAccount(untouched, usageByEmail) ??
			pickRandomAccount(untouched, options?.random)
		);
	}

	const earliestWeeklyReset = pickEarliestWeeklyResetAccount(
		withUsage,
		usageByEmail,
	);
	if (earliestWeeklyReset) return earliestWeeklyReset;

	return pickRandomAccount(available, options?.random);
}
