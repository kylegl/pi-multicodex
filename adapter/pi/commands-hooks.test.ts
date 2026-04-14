import { describe, expect, it, vi } from "vitest";
import type { Account } from "../../core";
import { registerMulticodexCommands } from "./commands";
import { registerMulticodexHooks } from "./hooks";

function makeAccount(email: string): Account {
	return {
		email,
		accessToken: `${email}-access`,
		refreshToken: `${email}-refresh`,
		expiresAt: Date.now() + 60_000,
	};
}

describe("adapter command and hook wiring", () => {
	it("registers the documented commands", () => {
		const commands: string[] = [];
		const pi = {
			registerCommand: (name: string) => commands.push(name),
			registerProvider: vi.fn(),
			on: vi.fn(),
			exec: vi.fn(),
		} as never;
		const manager = {
			getAccounts: vi.fn(() => []),
			refreshUsageForAllAccounts: vi.fn(),
			getActiveAccount: vi.fn(),
			getCachedUsage: vi.fn(),
			getAvailableManualAccount: vi.fn(),
			hasManualAccount: vi.fn(),
			clearManualAccount: vi.fn(),
			setManualAccount: vi.fn(),
			addOrUpdateAccount: vi.fn(),
		} as never;

		registerMulticodexCommands(pi, manager);
		expect(commands).toEqual([
			"multicodex-login",
			"multicodex-use",
			"multicodex-status",
		]);
	});

	it("activates the best account on session start and new session switch", async () => {
		const calls: string[] = [];
		const manager = {
			getAccounts: vi.fn(() => [makeAccount("a@example.com")]),
			refreshUsageForAllAccounts: vi.fn(
				async ({ force }: { force?: boolean } = {}) => {
					calls.push(`refresh:${Boolean(force)}`);
				},
			),
			getAvailableManualAccount: vi.fn(() => undefined),
			hasManualAccount: vi.fn(() => true),
			clearManualAccount: vi.fn(() => {
				calls.push("clear");
			}),
			activateBestAccount: vi.fn(async () => {
				calls.push("activate");
				return undefined;
			}),
		} as never;
		const handlers: Record<string, (...args: unknown[]) => void> = {};
		const pi = {
			on: (event: string, handler: (...args: unknown[]) => void) => {
				handlers[event] = handler;
			},
			registerCommand: vi.fn(),
			registerProvider: vi.fn(),
			exec: vi.fn(),
		} as never;
		const ctx = { ui: { notify: vi.fn() } } as never;

		registerMulticodexHooks(pi, manager, {} as never);
		handlers.session_start({}, ctx);
		handlers.session_switch({ reason: "new" }, ctx);

		await vi.waitFor(() => {
			expect(calls.filter((entry) => entry.startsWith("refresh")).length).toBe(
				2,
			);
			expect(calls.filter((entry) => entry === "clear").length).toBe(2);
			expect(calls.filter((entry) => entry === "activate").length).toBe(2);
		});
	});
});
