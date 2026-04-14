import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { AccountManager } from "../../core";
import { registerMulticodexCommands } from "./commands";
import { registerMulticodexHooks } from "./hooks";
import { refreshOpenAICodexTokenCompat } from "./oauth";
import { buildMulticodexProviderConfig } from "./provider";
import { createPiStorageAdapter } from "./storage";

const PROVIDER_ID = "multicodex";

export default function multicodexExtension(pi: ExtensionAPI): void {
	const lastContextRef: { current?: ExtensionContext } = {};
	const accountManager = new AccountManager({
		storage: createPiStorageAdapter(),
		refreshToken: async (refreshToken) => {
			const creds = await refreshOpenAICodexTokenCompat(refreshToken);
			return {
				access: creds.access,
				refresh: creds.refresh,
				expires: creds.expires,
				...(typeof creds.accountId === "string"
					? { accountId: creds.accountId }
					: {}),
			};
		},
	});

	accountManager.setWarningHandler((message) => {
		if (lastContextRef.current) {
			lastContextRef.current.ui.notify(message, "warning");
		}
	});

	const providerConfig = buildMulticodexProviderConfig(accountManager);
	if (providerConfig) {
		pi.registerProvider(PROVIDER_ID, providerConfig);
	} else {
		console.warn(
			"[multicodex] OpenAI Codex provider is unavailable in this pi build. MultiCodex provider registration has been skipped.",
		);
	}

	registerMulticodexCommands(pi, accountManager);
	registerMulticodexHooks(pi, accountManager, lastContextRef);
}
