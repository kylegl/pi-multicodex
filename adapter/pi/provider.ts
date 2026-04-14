import {
	type Api,
	type AssistantMessageEventStream,
	type Context,
	getApiProvider,
	getModels,
	type Model,
	type SimpleStreamOptions,
} from "@mariozechner/pi-ai";
import type { AccountManager } from "../../core";
import { createStreamWrapper } from "./stream-wrapper";

export interface ProviderModelDef {
	id: string;
	name: string;
	reasoning: boolean;
	input: ("text" | "image")[];
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total?: number;
	};
	contextWindow: number;
	maxTokens: number;
}

type ApiProviderRef = NonNullable<ReturnType<typeof getApiProvider>>;

type MulticodexProviderConfig = {
	baseUrl: string;
	apiKey: string;
	api: "openai-codex-responses";
	streamSimple: (
		model: Model<Api>,
		context: Context,
		options?: SimpleStreamOptions,
	) => AssistantMessageEventStream;
	models: ProviderModelDef[];
};

export function getOpenAICodexMirror(): {
	baseUrl: string;
	models: ProviderModelDef[];
} {
	const sourceModels = getModels("openai-codex");
	return {
		baseUrl: sourceModels[0]?.baseUrl || "https://chatgpt.com/backend-api",
		models: sourceModels.map((model) => ({
			id: model.id,
			name: model.name,
			reasoning: model.reasoning,
			input: model.input,
			cost: model.cost,
			contextWindow: model.contextWindow,
			maxTokens: model.maxTokens,
		})),
	};
}

export function buildMulticodexProviderConfig(
	accountManager: AccountManager,
): MulticodexProviderConfig | undefined {
	const mirror = getOpenAICodexMirror();
	const baseProvider = getApiProvider("openai-codex-responses") as
		| ApiProviderRef
		| undefined;
	if (!baseProvider) {
		return undefined;
	}
	return {
		baseUrl: mirror.baseUrl,
		apiKey: "managed-by-extension",
		api: "openai-codex-responses",
		streamSimple: createStreamWrapper(accountManager, baseProvider),
		models: mirror.models,
	};
}
