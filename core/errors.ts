export function getErrorMessage(err: unknown): string {
	if (err instanceof Error) return err.message;
	return typeof err === "string" ? err : JSON.stringify(err);
}

export function isQuotaErrorMessage(message: string): boolean {
	return /\b429\b|quota|usage limit|rate.?limit|too many requests|limit reached/i.test(
		message,
	);
}

export function isAbortLikeError(err: unknown): boolean {
	if (err instanceof Error) {
		if (err.name === "AbortError") return true;
		return /\babort(?:ed)?\b/i.test(err.message);
	}
	if (typeof err === "string") {
		return /\babort(?:ed)?\b/i.test(err);
	}
	return false;
}

export function getUsageHttpStatus(err: unknown): number | undefined {
	const message = getErrorMessage(err);
	const match = message.match(/Usage request failed:\s*(\d{3})/);
	if (!match) return undefined;
	return Number(match[1]);
}

export function isRetryableUsageError(err: unknown): boolean {
	if (isAbortLikeError(err)) return true;
	const status = getUsageHttpStatus(err);
	if (status !== undefined) {
		return status === 429 || status >= 500;
	}
	if (err instanceof TypeError) {
		return /fetch failed|network|timed out|timeout|econnreset|enotfound|eai_again/i.test(
			err.message,
		);
	}
	return false;
}
