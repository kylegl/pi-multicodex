import {
	type Api,
	type AssistantMessageEvent,
	type AssistantMessageEventStream,
	type Context,
	createAssistantMessageEventStream,
	type Model,
	type SimpleStreamOptions,
} from "@mariozechner/pi-ai";
import type { AccountManager } from "../../core";
import { isQuotaErrorMessage } from "../../core";
import {
	createErrorAssistantMessage,
	createLinkedAbortController,
	withProvider,
} from "./stream-utils";

const MAX_ROTATION_RETRIES = 5;

export function createStreamWrapper(
	accountManager: AccountManager,
	baseProvider: {
		streamSimple: (
			model: Model<Api>,
			context: Context,
			options?: SimpleStreamOptions,
		) => AsyncIterable<AssistantMessageEvent>;
	},
) {
	return (
		model: Model<Api>,
		context: Context,
		options?: SimpleStreamOptions,
	): AssistantMessageEventStream => {
		const stream = createAssistantMessageEventStream();

		(async () => {
			try {
				const excludedEmails = new Set<string>();
				for (let attempt = 0; attempt <= MAX_ROTATION_RETRIES; attempt++) {
					const now = Date.now();
					const manual = accountManager.getAvailableManualAccount({
						excludeEmails: excludedEmails,
						now,
					});
					const usingManual = Boolean(manual);
					let account = manual;
					if (!account) {
						if (accountManager.hasManualAccount()) {
							accountManager.clearManualAccount();
						}
						account = await accountManager.activateBestAccount({
							excludeEmails: excludedEmails,
							signal: options?.signal,
						});
					}
					if (!account) {
						throw new Error(
							"No available Multicodex accounts. Please use /multicodex-login.",
						);
					}

					const token = await accountManager.ensureValidToken(account);
					const abortController = createLinkedAbortController(options?.signal);

					const internalModel: Model<"openai-codex-responses"> = {
						...(model as Model<"openai-codex-responses">),
						provider: "openai-codex",
						api: "openai-codex-responses",
					};

					const inner = baseProvider.streamSimple(
						{
							...internalModel,
							headers: {
								...(internalModel.headers || {}),
								"X-Multicodex-Account": account.email,
							},
						},
						context,
						{
							...options,
							apiKey: token,
							signal: abortController.signal,
						},
					);

					let forwardedAny = false;
					let retry = false;

					for await (const event of inner) {
						if (event.type === "error") {
							const msg = event.error.errorMessage || "";
							const isQuota = isQuotaErrorMessage(msg);

							if (isQuota && !forwardedAny && attempt < MAX_ROTATION_RETRIES) {
								await accountManager.handleQuotaExceeded(account, {
									signal: options?.signal,
								});
								if (usingManual) {
									accountManager.clearManualAccount();
								}
								excludedEmails.add(account.email);
								abortController.abort();
								retry = true;
								break;
							}

							stream.push(withProvider(event, model.provider));
							stream.end();
							return;
						}

						forwardedAny = true;
						stream.push(withProvider(event, model.provider));

						if (event.type === "done") {
							stream.end();
							return;
						}
					}

					if (retry) {
						continue;
					}

					stream.end();
					return;
				}
			} catch (error) {
				const message =
					error instanceof Error ? error.message : JSON.stringify(error);
				const errorEvent: AssistantMessageEvent = {
					type: "error",
					reason: "error",
					error: createErrorAssistantMessage(
						model,
						`Multicodex failed: ${message}`,
					),
				};
				stream.push(withProvider(errorEvent, model.provider));
				stream.end();
			}
		})();

		return stream;
	};
}
