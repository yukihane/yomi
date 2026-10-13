import { beforeAll, describe, expect, test } from "vitest";
import type { Browser } from "wxt/browser";

import { launchExtension, screenshot, takesScreenshots } from "./fixtures";
import type { Extension } from "./fixtures";

let ext: Extension;
declare const chrome: typeof Browser;

beforeAll(async () => {
	ext = await launchExtension();
	return () => ext.context.close();
});

test.runIf(takesScreenshots)("ポップアップを表示する", async () => {
	const popup = await ext.context.newPage();
	await popup.setViewportSize({ width: 340, height: 520 });
	await popup.goto(`chrome-extension://${ext.extensionId}/popup.html`);
	await expect.poll(() => popup.getByText("tester@example.com").count()).toBe(1);
	await screenshot(popup, "popup", { fullPage: true });
	await popup.close();
});

describe("設定ページ", () => {
	test("保存済みモデルが利用できない場合は案内し、選択を勝手に変更しない", async () => {
		await ext.setSettings({ model: "unavailable-model", targetLang: "ja" });
		const options = await ext.context.newPage();
		try {
			await options.goto(`chrome-extension://${ext.extensionId}/options.html`);
			await expect
				.poll(() =>
					options
						.getByText("選択中のモデル（unavailable-model）はこのアカウントでは利用できません。")
						.count(),
				)
				.toBe(1);
			expect(
				await ext.context.serviceWorkers()[0]!.evaluate(() => chrome.storage.sync.get("settings")),
			).toMatchObject({ settings: { model: "unavailable-model" } });
		} finally {
			await options.close();
			await ext.setSettings({ model: "gpt-6-luna", targetLang: "ja" });
		}
	});

	test("モデルごとの選択肢を表示する", async () => {
		const options = await ext.context.newPage();
		await options.setViewportSize({ width: 900, height: 1100 });
		await options.goto(`chrome-extension://${ext.extensionId}/options.html`);
		const selects = options.locator("select");

		// 表示対象のモデルだけが並ぶ
		await expect
			.poll(() => selects.first().locator("option").allTextContents())
			.toEqual(["GPT-6 Luna", "GPT-6.1 Sol"]);
		// 推論の強さはモデルが対応するものだけ並ぶ
		expect(await selects.nth(1).locator("option").allTextContents()).toEqual(["low", "medium"]);
		expect(await options.getByText("高速モード").count()).toBe(1);

		await screenshot(options, "options", { fullPage: true });
		await options.close();
	});
});
