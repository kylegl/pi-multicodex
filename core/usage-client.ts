import { type CodexUsageSnapshot, parseCodexUsageResponse } from "./usage";

function createLinkedAbortController(signal?: AbortSignal): AbortController {
	const controller = new AbortController();
	if (signal?.aborted) {
		controller.abort();
		return controller;
	}
	signal?.addEventListener("abort", () => controller.abort(), { once: true });
	return controller;
}

function createTimeoutController(
	signal: AbortSignal | undefined,
	timeoutMs: number,
): { controller: AbortController; clear: () => void } {
	const controller = createLinkedAbortController(signal);
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	return {
		controller,
		clear: () => clearTimeout(timeout),
	};
}

export interface CodexUsageClient {
	fetchCodexUsage(
		accessToken: string,
		accountId?: string,
		options?: { signal?: AbortSignal },
	): Promise<CodexUsageSnapshot>;
}

export function createCodexUsageClient(options?: {
	requestTimeoutMs?: number;
	fetchImpl?: typeof fetch;
}): CodexUsageClient {
	const requestTimeoutMs = options?.requestTimeoutMs ?? 10_000;
	const fetchImpl = options?.fetchImpl ?? fetch;

	return {
		async fetchCodexUsage(
			accessToken: string,
			accountId?: string,
			options?: { signal?: AbortSignal },
		): Promise<CodexUsageSnapshot> {
			const { controller, clear } = createTimeoutController(
				options?.signal,
				requestTimeoutMs,
			);
			try {
				const headers: Record<string, string> = {
					Authorization: `Bearer ${accessToken}`,
					Accept: "application/json",
				};
				if (accountId) {
					headers["ChatGPT-Account-Id"] = accountId;
				}

				const response = await fetchImpl(
					"https://chatgpt.com/backend-api/wham/usage",
					{
						headers,
						signal: controller.signal,
					},
				);

				if (!response.ok) {
					throw new Error(`Usage request failed: ${response.status}`);
				}

				const data = (await response.json()) as Parameters<
					typeof parseCodexUsageResponse
				>[0];
				return { ...parseCodexUsageResponse(data), fetchedAt: Date.now() };
			} finally {
				clear();
			}
		},
	};
}
