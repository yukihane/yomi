import { describe, expect, it } from "vitest";

import { withDefaults } from "./settings";

describe("withDefaults", () => {
	it("旧 null のモデルを既定値に移行し、保存済みの選択は維持する", () => {
		expect(withDefaults({ model: null }).model).toBe("gpt-6-luna");
		expect(withDefaults({ model: "account-specific-model" }).model).toBe("account-specific-model");
	});
	it("保存されていない項目を既定値で補う", () => {
		expect(withDefaults({ targetLang: "en" })).toMatchObject({
			targetLang: "en",
			model: "gpt-6-luna",
			reasoningEffort: "low",
			showSelectionButton: true,
		});
	});

	it("不正な値の項目だけを既定値に戻し、他の項目は残す", () => {
		expect(
			withDefaults({ targetLang: "xx", reasoningEffort: "high", fastMode: "yes" }),
		).toMatchObject({ targetLang: "ja", reasoningEffort: "high", fastMode: false });
	});

	it("未知の項目を取り除く", () => {
		expect(withDefaults({ removed: 1 })).not.toHaveProperty("removed");
	});
});
