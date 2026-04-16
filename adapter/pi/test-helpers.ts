import type { AssistantMessageEvent, Model } from "@mariozechner/pi-ai";
import { vi } from "vitest";
import { createTestAccount } from "../../core/test-helpers";

export const createAdapterTestAccount = (
	email: string,
	overrides?: Parameters<typeof createTestAccount>[1],
) => createTestAccount(email, overrides, { profile: "adapter" });

export function createMulticodexTestModel(): Model<"openai-codex-responses"> {
	return {
		id: "model",
		provider: "multicodex",
		api: "openai-codex-responses",
	} as Model<"openai-codex-responses">;
}

export async function collectEvents(
	stream: AsyncIterable<AssistantMessageEvent>,
) {
	const events: AssistantMessageEvent[] = [];
	for await (const event of stream) {
		events.push(event);
	}
	return events;
}

export function createHookHarness() {
	const handlers: Record<string, (...args: unknown[]) => void> = {};
	const pi = {
		on: (event: string, handler: (...args: unknown[]) => void) => {
			handlers[event] = handler;
		},
		registerCommand: vi.fn(),
		registerProvider: vi.fn(),
		exec: vi.fn(),
	} as never;
	const lastContextRef: { current?: unknown } = {};
	return { handlers, pi, lastContextRef };
}
