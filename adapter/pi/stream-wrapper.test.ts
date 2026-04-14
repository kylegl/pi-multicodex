import type { AssistantMessageEvent, Model } from "@mariozechner/pi-ai";
import { describe, expect, it, vi } from "vitest";
import type { Account } from "../../core";
import { createStreamWrapper } from "./stream-wrapper";

function makeAccount(email: string): Account {
	return {
		email,
		accessToken: `${email}-access`,
		refreshToken: `${email}-refresh`,
		expiresAt: Date.now() + 60_000,
	};
}

async function collect(stream: AsyncIterable<AssistantMessageEvent>) {
	const events: AssistantMessageEvent[] = [];
	for await (const event of stream) {
		events.push(event);
	}
	return events;
}

describe("createStreamWrapper", () => {
	it("injects the selected account header and rewrites provider ids", async () => {
		const manual = makeAccount("manual@example.com");
		let headerEmail: string | undefined;
		const accountManager = {
			getAvailableManualAccount: vi.fn(() => manual),
			hasManualAccount: vi.fn(() => true),
			clearManualAccount: vi.fn(),
			activateBestAccount: vi.fn(),
			ensureValidToken: vi.fn(async () => "token-manual"),
			handleQuotaExceeded: vi.fn(),
		} as const;
		const baseProvider = {
			streamSimple: vi.fn((_model: { headers?: Record<string, string> }) => {
				headerEmail = _model.headers?.["X-Multicodex-Account"];
				async function* inner() {
					yield {
						type: "done",
						message: {
							provider: "openai-codex",
							api: "openai-codex-responses",
						},
					} as AssistantMessageEvent;
				}
				return inner();
			}),
		};

		const stream = createStreamWrapper(
			accountManager as never,
			baseProvider as never,
		)(
			{
				id: "model",
				provider: "multicodex",
				api: "openai-codex-responses",
			} as Model<"openai-codex-responses">,
			{} as never,
		);

		const events = await collect(stream);
		expect(headerEmail).toBe("manual@example.com");
		expect(accountManager.activateBestAccount).not.toHaveBeenCalled();
		expect(events[0]?.type).toBe("done");
		if (events[0]?.type === "done") {
			expect(events[0].message.provider).toBe("multicodex");
		}
	});

	it("rotates on quota before output and stops after output has been forwarded", async () => {
		const manual = makeAccount("manual@example.com");
		const auto = makeAccount("auto@example.com");
		const headers: string[] = [];
		let attempt = 0;
		const accountManager = {
			getAvailableManualAccount: vi.fn(
				({ excludeEmails }: { excludeEmails?: Set<string> }) =>
					!excludeEmails?.has(manual.email) && attempt === 0
						? manual
						: undefined,
			),
			hasManualAccount: vi.fn(() => attempt === 0),
			clearManualAccount: vi.fn(),
			activateBestAccount: vi.fn(
				async ({ excludeEmails }: { excludeEmails?: Set<string> }) => {
					return excludeEmails?.has(auto.email) ? undefined : auto;
				},
			),
			ensureValidToken: vi.fn(
				async (account: Account) => `${account.email}-token`,
			),
			handleQuotaExceeded: vi.fn(async () => {}),
		} as const;
		const baseProvider = {
			streamSimple: vi.fn((_model: { headers?: Record<string, string> }) => {
				headers.push(_model.headers?.["X-Multicodex-Account"] ?? "");
				const currentAttempt = attempt++;
				async function* inner() {
					if (currentAttempt === 0) {
						yield {
							type: "error",
							error: { errorMessage: "quota exceeded" },
						} as AssistantMessageEvent;
						return;
					}
					yield {
						type: "partial",
						partial: { provider: "openai-codex", text: "hello" },
					} as unknown as AssistantMessageEvent;
					yield {
						type: "error",
						error: { errorMessage: "quota exceeded" },
					} as AssistantMessageEvent;
				}
				return inner();
			}),
		};

		const stream = createStreamWrapper(
			accountManager as never,
			baseProvider as never,
		)(
			{
				id: "model",
				provider: "multicodex",
				api: "openai-codex-responses",
			} as Model<"openai-codex-responses">,
			{} as never,
		);

		const events = await collect(stream);
		expect(headers).toEqual(["manual@example.com", "auto@example.com"]);
		expect(accountManager.handleQuotaExceeded).toHaveBeenCalledTimes(1);
		expect(accountManager.clearManualAccount).toHaveBeenCalledTimes(1);
		expect(events[0]?.type).toBe("partial");
		const partialEvent = events[0] as
			| { partial?: { provider: string } }
			| undefined;
		if (partialEvent?.partial) {
			expect(partialEvent.partial.provider).toBe("multicodex");
		}
		expect(events[1]?.type).toBe("error");
		if (events[1]?.type === "error") {
			expect(events[1].error.provider).toBe("multicodex");
		}
	});

	it("honors excludeEmails across quota retries and caps rotation retries", async () => {
		const accounts = [
			makeAccount("a@example.com"),
			makeAccount("b@example.com"),
			makeAccount("c@example.com"),
			makeAccount("d@example.com"),
			makeAccount("e@example.com"),
			makeAccount("f@example.com"),
		];
		const seenExcludes: Array<string[]> = [];
		let calls = 0;
		const accountManager = {
			getAvailableManualAccount: vi.fn(
				({ excludeEmails }: { excludeEmails?: Set<string> }) => {
					seenExcludes.push(Array.from(excludeEmails ?? []));
					return undefined;
				},
			),
			hasManualAccount: vi.fn(() => false),
			clearManualAccount: vi.fn(),
			activateBestAccount: vi.fn(
				async ({ excludeEmails }: { excludeEmails?: Set<string> }) => {
					const next = accounts.find(
						(account) => !excludeEmails?.has(account.email),
					);
					return next;
				},
			),
			ensureValidToken: vi.fn(
				async (account: Account) => `${account.email}-token`,
			),
			handleQuotaExceeded: vi.fn(async () => {}),
		} as const;
		const baseProvider = {
			streamSimple: vi.fn((_model: { headers?: Record<string, string> }) => {
				calls += 1;
				async function* inner() {
					if (calls <= 6) {
						yield {
							type: "error",
							error: { errorMessage: "quota exceeded" },
						} as AssistantMessageEvent;
						return;
					}
					yield {
						type: "done",
						message: { provider: "openai-codex" },
					} as AssistantMessageEvent;
				}
				return inner();
			}),
		};

		const stream = createStreamWrapper(
			accountManager as never,
			baseProvider as never,
		)(
			{
				id: "model",
				provider: "multicodex",
				api: "openai-codex-responses",
			} as Model<"openai-codex-responses">,
			{} as never,
		);

		const events = await collect(stream);
		expect(calls).toBe(6);
		expect(accountManager.handleQuotaExceeded).toHaveBeenCalledTimes(5);
		expect(seenExcludes[0]).toEqual([]);
		expect(seenExcludes.at(-1)).toContain("a@example.com");
		expect(events[0]?.type).toBe("error");
	});
});
