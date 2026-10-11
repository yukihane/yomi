import { expect, test } from "vitest";
import type { Browser } from "wxt/browser";

import { launchExtension } from "./fixtures";

declare const chrome: typeof Browser;

test.each([200, 500])(
	"失効APIが %s のとき端末内の消去と失効結果を区別して表示する",
	async (status) => {
		const ext = await launchExtension();
		try {
			const worker = ext.context.serviceWorkers()[0]!;
			await worker.evaluate((responseStatus) => {
				const original = globalThis.fetch;
				globalThis.fetch = async (url, init) => {
					const target = url instanceof Request ? url.url : String(url);
					if (target.endsWith("/oauth/revoke"))
						return new Response(null, { status: responseStatus });
					return await original(url, init);
				};
			}, status);
			const options = await ext.context.newPage();
			await options.goto(`chrome-extension://${ext.extensionId}/options.html`);
			await options.getByRole("button", { name: "サインアウト", exact: true }).click();
			const expected =
				status === 200
					? "トークンの失効要求は受理されました。"
					: "トークンの失効を確認できませんでした。";
			await expect.poll(() => options.getByRole("status").textContent()).toContain(expected);
			await expect.poll(() => options.getByText("tester@example.com").count()).toBe(0);
			expect(
				await worker.evaluate(
					async () => (await chrome.storage.local.get("credentials"))["credentials"],
				),
			).toBeUndefined();
		} finally {
			await ext.context.close();
		}
	},
);
