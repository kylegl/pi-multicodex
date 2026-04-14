import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import type { AccountManager } from "../../core";
import { isUsageUntouched } from "../../core";
import { openLoginInBrowser } from "./browser";
import { loginOpenAICodexCompat } from "./oauth";
import { formatResetAt } from "./status";

export function registerMulticodexCommands(
	pi: ExtensionAPI,
	accountManager: AccountManager,
): void {
	pi.registerCommand("multicodex-login", {
		description: "Login to an OpenAI Codex account for the rotation pool",
		handler: async (
			args: string,
			ctx: ExtensionCommandContext,
		): Promise<void> => {
			const email = args.trim();
			if (!email) {
				ctx.ui.notify(
					"Please provide an email/identifier: /multicodex-login my@email.com",
					"error",
				);
				return;
			}

			try {
				ctx.ui.notify(
					`Starting login for ${email}... Check your browser.`,
					"info",
				);

				const creds = await loginOpenAICodexCompat({
					onAuth: ({ url }) => {
						void openLoginInBrowser(pi, ctx, url);
						ctx.ui.notify(`Please open this URL to login: ${url}`, "info");
						console.log(`[multicodex] Login URL: ${url}`);
					},
					onPrompt: async ({ message }) => (await ctx.ui.input(message)) || "",
				});

				accountManager.addOrUpdateAccount(email, {
					access: creds.access,
					refresh: creds.refresh,
					expires: creds.expires,
					...(typeof creds.accountId === "string"
						? { accountId: creds.accountId }
						: {}),
				});
				ctx.ui.notify(`Successfully logged in as ${email}`, "info");
			} catch (error) {
				ctx.ui.notify(
					`Login failed: ${error instanceof Error ? error.message : JSON.stringify(error)}`,
					"error",
				);
			}
		},
	});

	pi.registerCommand("multicodex-use", {
		description: "Switch active Codex account for this session",
		handler: async (
			_args: string,
			ctx: ExtensionCommandContext,
		): Promise<void> => {
			const accounts = accountManager.getAccounts();
			if (accounts.length === 0) {
				ctx.ui.notify(
					"No accounts logged in. Use /multicodex-login first.",
					"warning",
				);
				return;
			}

			const options = accounts.map(
				(account) =>
					account.email +
					(account.quotaExhaustedUntil &&
					account.quotaExhaustedUntil > Date.now()
						? " (Quota)"
						: ""),
			);
			const selected = await ctx.ui.select("Select Account", options);
			if (!selected) return;

			const email = selected.split(" ")[0];
			accountManager.setManualAccount(email);
			ctx.ui.notify(`Switched to ${email}`, "info");
		},
	});

	pi.registerCommand("multicodex-status", {
		description: "Show all Codex accounts and active status",
		handler: async (
			_args: string,
			ctx: ExtensionCommandContext,
		): Promise<void> => {
			await accountManager.refreshUsageForAllAccounts();
			const accounts = accountManager.getAccounts();
			if (accounts.length === 0) {
				ctx.ui.notify(
					"No accounts logged in. Use /multicodex-login first.",
					"warning",
				);
				return;
			}

			const active = accountManager.getActiveAccount();
			const options = accounts.map((account) => {
				const usage = accountManager.getCachedUsage(account.email);
				const isActive = active?.email === account.email;
				const quotaHit =
					account.quotaExhaustedUntil &&
					account.quotaExhaustedUntil > Date.now();
				const untouched = isUsageUntouched(usage) ? "untouched" : null;
				const tags = [
					isActive ? "active" : null,
					quotaHit ? "quota" : null,
					untouched,
				]
					.filter(Boolean)
					.join(", ");
				const suffix = tags ? ` (${tags})` : "";
				const primaryUsed = usage?.primary?.usedPercent;
				const secondaryUsed = usage?.secondary?.usedPercent;
				const primaryReset = usage?.primary?.resetAt;
				const secondaryReset = usage?.secondary?.resetAt;
				const primaryLabel =
					primaryUsed === undefined ? "unknown" : `${Math.round(primaryUsed)}%`;
				const secondaryLabel =
					secondaryUsed === undefined
						? "unknown"
						: `${Math.round(secondaryUsed)}%`;
				const usageSummary = `5h ${primaryLabel} reset:${formatResetAt(primaryReset)} | weekly ${secondaryLabel} reset:${formatResetAt(secondaryReset)}`;
				return `${isActive ? "•" : " "} ${account.email}${suffix} - ${usageSummary}`;
			});

			await ctx.ui.select("MultiCodex Accounts", options);
		},
	});
}
