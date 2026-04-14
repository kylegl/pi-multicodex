import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import type { AccountManager } from "../../core";

async function activateBestAccountForSession(
	accountManager: AccountManager,
): Promise<void> {
	await accountManager.refreshUsageForAllAccounts({ force: true });
	const manual = accountManager.getAvailableManualAccount();
	if (manual) return;
	if (accountManager.hasManualAccount()) {
		accountManager.clearManualAccount();
	}
	await accountManager.activateBestAccount();
}

export function registerMulticodexHooks(
	pi: Pick<ExtensionAPI, "on">,
	accountManager: AccountManager,
	lastContextRef: { current?: ExtensionContext },
): void {
	pi.on("session_start", (_event: unknown, ctx: ExtensionContext) => {
		lastContextRef.current = ctx;
		if (accountManager.getAccounts().length === 0) return;
		void activateBestAccountForSession(accountManager);
	});

	pi.on(
		"session_switch",
		(event: { reason?: string }, ctx: ExtensionContext) => {
			lastContextRef.current = ctx;
			if (event.reason === "new") {
				void activateBestAccountForSession(accountManager);
			}
		},
	);
}
