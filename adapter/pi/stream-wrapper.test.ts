import type { AssistantMessageEvent } from "@mariozechner/pi-ai";
import { describe, expect, it, vi } from "vitest";
import type { Account } from "../../core";
import { createStreamWrapper } from "./stream-wrapper";
import {
	collectEvents,
	createAdapterTestAccount,
	createMulticodexTestModel,
} from "./test-helpers";

describe("createStreamWrapper", () => {
	it("injects the selected account header and rewrites provider ids", async () => {
		const manual = createAdapterTestAccount("manual@example.com");
		let headerEmail: string | undefined;
		const accountManager = {
			getAvailableManualAccount: vi.fn(() => manual),
			hasManualAccount: vi.fn(() => true),
			clearManualAccount: vi.fn(),
			activateBestAccount: vi.fn(async () => {
				throw new Error("unexpected auto-selection when manual account exists");
			}),
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
		)(createMulticodexTestModel(), {} as never);

		const events = await collectEvents(stream);
		expect(headerEmail).toBe("manual@example.com");
		expect(events[0]?.type).toBe("done");
		if (events[0]?.type === "done") {
			expect(events[0].message.provider).toBe("multicodex");
		}
	});

	it("rotates on early quota errors, then forwards output without further rotation", async () => {
		const manual = createAdapterTestAccount("manual@example.com");
		const auto = createAdapterTestAccount("auto@example.com");
		const headers: string[] = [];
		const exhaustedEmails: string[] = [];
		let manualPinned = true;
		let attempt = 0;

		const accountManager = {
			getAvailableManualAccount: vi.fn(
				({ excludeEmails }: { excludeEmails?: Set<string> }) => {
					if (!manualPinned) return undefined;
					if (excludeEmails?.has(manual.email)) return undefined;
					return manual;
				},
			),
			hasManualAccount: vi.fn(() => manualPinned),
			clearManualAccount: vi.fn(() => {
				manualPinned = false;
			}),
			activateBestAccount: vi.fn(
				async ({ excludeEmails }: { excludeEmails?: Set<string> }) => {
					return excludeEmails?.has(auto.email) ? undefined : auto;
				},
			),
			ensureValidToken: vi.fn(
				async (account: Account) => `${account.email}-token`,
			),
			handleQuotaExceeded: vi.fn(async (account: Account) => {
				exhaustedEmails.push(account.email);
			}),
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
		)(createMulticodexTestModel(), {} as never);

		const events = await collectEvents(stream);
		expect(headers).toEqual(["manual@example.com", "auto@example.com"]);
		expect(exhaustedEmails).toEqual(["manual@example.com"]);
		expect(manualPinned).toBe(false);
		const firstEvent = events[0] as
			| { type?: string; partial?: { provider?: string } }
			| undefined;
		expect(firstEvent?.type).toBe("partial");
		expect(firstEvent?.partial?.provider).toBe("multicodex");
		expect(events[1]?.type).toBe("error");
		if (events[1]?.type === "error") {
			expect(events[1].error.provider).toBe("multicodex");
		}
	});

	it("excludes exhausted accounts across retries and stops after retry cap", async () => {
		const accounts = [
			createAdapterTestAccount("a@example.com"),
			createAdapterTestAccount("b@example.com"),
			createAdapterTestAccount("c@example.com"),
			createAdapterTestAccount("d@example.com"),
			createAdapterTestAccount("e@example.com"),
			createAdapterTestAccount("f@example.com"),
		];
		const headers: string[] = [];
		const seenExcludes: Array<string[]> = [];
		const exhaustedEmails: string[] = [];

		const accountManager = {
			getAvailableManualAccount: vi.fn(() => undefined),
			hasManualAccount: vi.fn(() => false),
			clearManualAccount: vi.fn(),
			activateBestAccount: vi.fn(
				async ({ excludeEmails }: { excludeEmails?: Set<string> }) => {
					seenExcludes.push(Array.from(excludeEmails ?? []));
					return accounts.find((account) => !excludeEmails?.has(account.email));
				},
			),
			ensureValidToken: vi.fn(
				async (account: Account) => `${account.email}-token`,
			),
			handleQuotaExceeded: vi.fn(async (account: Account) => {
				exhaustedEmails.push(account.email);
			}),
		} as const;
		const baseProvider = {
			streamSimple: vi.fn((_model: { headers?: Record<string, string> }) => {
				headers.push(_model.headers?.["X-Multicodex-Account"] ?? "");
				async function* inner() {
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
		)(createMulticodexTestModel(), {} as never);

		const events = await collectEvents(stream);
		expect(headers).toEqual(accounts.map((account) => account.email));
		expect(exhaustedEmails).toEqual(
			accounts.slice(0, 5).map((account) => account.email),
		);
		expect(seenExcludes[0]).toEqual([]);
		expect(seenExcludes.at(-1)).toEqual(
			accounts.slice(0, 5).map((account) => account.email),
		);
		expect(events).toHaveLength(1);
		expect(events[0]?.type).toBe("error");
		if (events[0]?.type === "error") {
			expect(events[0].error.provider).toBe("multicodex");
		}
	});
});
