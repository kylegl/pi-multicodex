import { describe, expect, it, vi } from "vitest";
import { registerMulticodexCommands } from "./commands";
import { registerMulticodexHooks } from "./hooks";
import { createAdapterTestAccount, createHookHarness } from "./test-helpers";

describe("adapter command and hook wiring", () => {
	it("registers the documented commands with handlers", () => {
		const registered: Record<
			string,
			{ description: string; handler: unknown }
		> = {};
		const pi = {
			registerCommand: (
				name: string,
				config: { description: string; handler: unknown },
			) => {
				registered[name] = config;
			},
			registerProvider: vi.fn(),
			on: vi.fn(),
			exec: vi.fn(),
		} as never;
		const manager = {
			getAccounts: vi.fn(() => []),
			refreshUsageForAllAccounts: vi.fn(),
			getActiveAccount: vi.fn(),
			getCachedUsage: vi.fn(),
			isRefreshBlocked: vi.fn(() => false),
			getAvailableManualAccount: vi.fn(),
			hasManualAccount: vi.fn(),
			clearManualAccount: vi.fn(),
			setManualAccount: vi.fn(),
			addOrUpdateAccount: vi.fn(),
			removeAccount: vi.fn(() => true),
		} as never;

		registerMulticodexCommands(pi, manager);

		expect(Object.keys(registered)).toEqual([
			"multicodex-login",
			"multicodex-remove",
			"multicodex-use",
			"multicodex-status",
		]);
		expect(typeof registered["multicodex-login"]?.handler).toBe("function");
		expect(typeof registered["multicodex-remove"]?.handler).toBe("function");
		expect(typeof registered["multicodex-use"]?.handler).toBe("function");
		expect(typeof registered["multicodex-status"]?.handler).toBe("function");
	});

	it("multicodex-remove removes a selected account", async () => {
		const registered: Record<
			string,
			{
				description: string;
				handler: (args: string, ctx: unknown) => Promise<void>;
			}
		> = {};
		const manager = {
			getAccounts: () => [createAdapterTestAccount("remove@example.com")],
			removeAccount: vi.fn(() => true),
			isRefreshBlocked: () => false,
			setManualAccount: vi.fn(),
			refreshUsageForAllAccounts: vi.fn(),
			getActiveAccount: vi.fn(),
			getCachedUsage: vi.fn(),
			getAvailableManualAccount: vi.fn(),
			hasManualAccount: vi.fn(),
			clearManualAccount: vi.fn(),
			addOrUpdateAccount: vi.fn(),
		};
		const pi = {
			registerCommand: (
				name: string,
				config: {
					description: string;
					handler: (args: string, ctx: unknown) => Promise<void>;
				},
			) => {
				registered[name] = config;
			},
			registerProvider: vi.fn(),
			on: vi.fn(),
			exec: vi.fn(),
		} as never;
		registerMulticodexCommands(pi, manager as never);

		const notify = vi.fn();
		await registered["multicodex-remove"]?.handler("", {
			ui: {
				notify,
				select: vi.fn(async () => "remove@example.com"),
			},
		});

		expect(manager.removeAccount).toHaveBeenCalledWith("remove@example.com");
		expect(notify).toHaveBeenCalledWith(
			"Removed remove@example.com from MultiCodex.",
			"info",
		);
	});

	it("session_start refreshes, clears stale manual pin, and activates best account", async () => {
		const state = {
			refreshedWithForce: false,
			manualCleared: false,
			activatedEmail: undefined as string | undefined,
		};
		let manualPinned = true;
		const manager = {
			getAccounts: () => [createAdapterTestAccount("a@example.com")],
			refreshUsageForAllAccounts: async ({
				force,
			}: {
				force?: boolean;
			} = {}) => {
				state.refreshedWithForce = Boolean(force);
			},
			getAvailableManualAccount: () => undefined,
			hasManualAccount: () => manualPinned,
			clearManualAccount: () => {
				manualPinned = false;
				state.manualCleared = true;
			},
			activateBestAccount: async () => {
				state.activatedEmail = "best@example.com";
				return createAdapterTestAccount("best@example.com");
			},
		} as never;

		const { handlers, pi, lastContextRef } = createHookHarness();
		registerMulticodexHooks(pi, manager, lastContextRef as never);
		const ctx = { ui: { notify: vi.fn() } };
		handlers.session_start({}, ctx);

		await vi.waitFor(() => {
			expect(state.refreshedWithForce).toBe(true);
			expect(state.manualCleared).toBe(true);
			expect(state.activatedEmail).toBe("best@example.com");
		});
		expect(lastContextRef.current).toBe(ctx);
	});

	it("session_switch(new) preserves valid manual account and skips activation", async () => {
		const manual = createAdapterTestAccount("manual@example.com");
		const state = {
			refreshedWithForce: false,
			manualCleared: false,
			activated: false,
		};
		let manualPinned = true;
		const manager = {
			getAccounts: () => [manual, createAdapterTestAccount("auto@example.com")],
			refreshUsageForAllAccounts: async ({
				force,
			}: {
				force?: boolean;
			} = {}) => {
				state.refreshedWithForce = Boolean(force);
			},
			getAvailableManualAccount: () => (manualPinned ? manual : undefined),
			hasManualAccount: () => manualPinned,
			clearManualAccount: () => {
				manualPinned = false;
				state.manualCleared = true;
			},
			activateBestAccount: async () => {
				state.activated = true;
				return createAdapterTestAccount("auto@example.com");
			},
		} as never;

		const { handlers, pi, lastContextRef } = createHookHarness();
		registerMulticodexHooks(pi, manager, lastContextRef as never);
		const ctx = { ui: { notify: vi.fn() } };
		handlers.session_switch({ reason: "new" }, ctx);

		await vi.waitFor(() => {
			expect(state.refreshedWithForce).toBe(true);
		});
		expect(state.manualCleared).toBe(false);
		expect(state.activated).toBe(false);
		expect(lastContextRef.current).toBe(ctx);
	});

	it("session_switch(non-new) updates context only and does not trigger activation flow", async () => {
		const state = {
			refreshed: false,
			manualCleared: false,
			activated: false,
		};
		const manager = {
			getAccounts: () => [createAdapterTestAccount("a@example.com")],
			refreshUsageForAllAccounts: async () => {
				state.refreshed = true;
			},
			getAvailableManualAccount: () => undefined,
			hasManualAccount: () => true,
			clearManualAccount: () => {
				state.manualCleared = true;
			},
			activateBestAccount: async () => {
				state.activated = true;
				return undefined;
			},
		} as never;

		const { handlers, pi, lastContextRef } = createHookHarness();
		registerMulticodexHooks(pi, manager, lastContextRef as never);
		const ctx = { ui: { notify: vi.fn() } };
		handlers.session_switch({ reason: "resume" }, ctx);

		await Promise.resolve();
		expect(state.refreshed).toBe(false);
		expect(state.manualCleared).toBe(false);
		expect(state.activated).toBe(false);
		expect(lastContextRef.current).toBe(ctx);
	});
});
