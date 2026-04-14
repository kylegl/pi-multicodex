import type { OAuthCredentials } from "@mariozechner/pi-ai";
import * as piAi from "@mariozechner/pi-ai";

type LoginOpenAICodexFn = (options: {
	onAuth: (info: { url: string; instructions?: string }) => void;
	onPrompt: (prompt: { message: string }) => Promise<string>;
	onProgress?: (message: string) => void;
	onManualCodeInput?: () => Promise<string>;
	originator?: string;
}) => Promise<OAuthCredentials>;

type RefreshOpenAICodexTokenFn = (
	refreshToken: string,
) => Promise<OAuthCredentials>;

export async function resolveCodexOAuthFns(): Promise<{
	login?: LoginOpenAICodexFn;
	refresh?: RefreshOpenAICodexTokenFn;
}> {
	const topLevelLogin = (piAi as { loginOpenAICodex?: LoginOpenAICodexFn })
		.loginOpenAICodex;
	const topLevelRefresh = (
		piAi as { refreshOpenAICodexToken?: RefreshOpenAICodexTokenFn }
	).refreshOpenAICodexToken;
	if (topLevelLogin && topLevelRefresh) {
		return { login: topLevelLogin, refresh: topLevelRefresh };
	}

	try {
		const oauthModuleId = "@mariozechner/pi-ai/oauth";
		const oauthModule = (await import(oauthModuleId)) as {
			loginOpenAICodex?: LoginOpenAICodexFn;
			refreshOpenAICodexToken?: RefreshOpenAICodexTokenFn;
		};
		return {
			login: oauthModule.loginOpenAICodex,
			refresh: oauthModule.refreshOpenAICodexToken,
		};
	} catch {
		return {};
	}
}

export async function loginOpenAICodexCompat(options: {
	onAuth: (info: { url: string; instructions?: string }) => void;
	onPrompt: (prompt: { message: string }) => Promise<string>;
	onProgress?: (message: string) => void;
	onManualCodeInput?: () => Promise<string>;
	originator?: string;
}): Promise<OAuthCredentials> {
	const { login } = await resolveCodexOAuthFns();
	if (!login) {
		throw new Error(
			"OpenAI Codex OAuth login is unavailable in this pi-ai build.",
		);
	}
	return login(options);
}

export async function refreshOpenAICodexTokenCompat(
	refreshToken: string,
): Promise<OAuthCredentials> {
	const { refresh } = await resolveCodexOAuthFns();
	if (!refresh) {
		throw new Error(
			"OpenAI Codex OAuth token refresh is unavailable in this pi-ai build.",
		);
	}
	return refresh(refreshToken);
}
