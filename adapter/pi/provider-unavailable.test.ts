import { describe, expect, it, vi } from "vitest";

vi.mock("@mariozechner/pi-ai", async () => {
	const actual = await vi.importActual<typeof import("@mariozechner/pi-ai")>(
		"@mariozechner/pi-ai",
	);
	return {
		...actual,
		getApiProvider: vi.fn(() => undefined),
	};
});

describe("provider availability guard", () => {
	it("skips provider registration when openai-codex-responses is missing", async () => {
		const { buildMulticodexProviderConfig } = await import("./provider");
		const { AccountManager } = await import("../../core");

		expect(buildMulticodexProviderConfig(new AccountManager())).toBeUndefined();
	});
});
