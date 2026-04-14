import { getModels } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import { AccountManager } from "../../core";
import {
	buildMulticodexProviderConfig,
	getOpenAICodexMirror,
} from "./provider";

describe("provider mirroring", () => {
	it("mirrors openai-codex metadata", () => {
		const sourceModels = getModels("openai-codex");
		expect(getOpenAICodexMirror()).toEqual({
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
		});
	});

	it("builds a provider config when openai-codex-responses is available", () => {
		const config = buildMulticodexProviderConfig(new AccountManager());
		expect(config?.api).toBe("openai-codex-responses");
		expect(config?.apiKey).toBe("managed-by-extension");
		expect(typeof config?.streamSimple).toBe("function");
	});
});
