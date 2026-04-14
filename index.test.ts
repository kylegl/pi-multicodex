import { describe, expect, it } from "vitest";
import multicodexExtension, {
	AccountManager,
	buildMulticodexProviderConfig,
	createStreamWrapper,
	getNextResetAt,
	getOpenAICodexMirror,
	getWeeklyResetAt,
	isQuotaErrorMessage,
	isUsageUntouched,
	parseCodexUsageResponse,
	pickBestAccount,
} from "./index";

describe("root compatibility barrel", () => {
	it("exports the legacy public API", () => {
		expect(typeof multicodexExtension).toBe("function");
		expect(typeof AccountManager).toBe("function");
		expect(typeof buildMulticodexProviderConfig).toBe("function");
		expect(typeof createStreamWrapper).toBe("function");
		expect(typeof getOpenAICodexMirror).toBe("function");
		expect(typeof parseCodexUsageResponse).toBe("function");
		expect(typeof pickBestAccount).toBe("function");
		expect(typeof isQuotaErrorMessage).toBe("function");
		expect(typeof isUsageUntouched).toBe("function");
		expect(typeof getNextResetAt).toBe("function");
		expect(typeof getWeeklyResetAt).toBe("function");
	});
});
