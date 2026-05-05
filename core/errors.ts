export function getErrorMessage(err: unknown): string {
	if (err instanceof Error) return err.message;
	return typeof err === "string" ? err : JSON.stringify(err);
}

export function isQuotaErrorMessage(message: string): boolean {
	return /\b429\b|quota|usage limit|rate.?limit|too many requests|limit reached/i.test(
		message,
	);
}

function normalizeResetTimestamp(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		return value > 1_000_000_000_000 ? value : value * 1000;
	}
	if (typeof value === "string" && value.trim()) {
		const numeric = Number(value.trim());
		if (Number.isFinite(numeric) && numeric > 0) {
			return numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
		}
	}
	return undefined;
}

export function getQuotaResetAt(message: string): number | undefined {
	const jsonStart = message.indexOf("{");
	if (jsonStart >= 0) {
		try {
			const parsed = JSON.parse(message.slice(jsonStart));
			const direct = normalizeResetTimestamp(parsed?.error?.resets_at);
			if (direct !== undefined) return direct;
			const headerReset = normalizeResetTimestamp(
				parsed?.headers?.["X-Codex-Primary-Reset-At"],
			);
			if (headerReset !== undefined) return headerReset;
		} catch {
			// Fall through to regex extraction for non-JSON error strings.
		}
	}
	const match = message.match(
		/(?:resets_at|X-Codex-Primary-Reset-At)["':\s]+(\d+(?:\.\d+)?)/i,
	);
	return match ? normalizeResetTimestamp(match[1]) : undefined;
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
