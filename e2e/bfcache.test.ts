import { createServer } from "node:http";

import { expect, test } from "vitest";
import type { Browser } from "wxt/browser";

import { launchExtension } from "./fixtures";
import type { Extension } from "./fixtures";

declare const chrome: typeof Browser;

async function signOut(ext: Extension) {
	const options = await ext.context.newPage();
	await options.goto(`chrome-extension://${ext.extensionId}/options.html`);
	expect(
		await options.evaluate(() => chrome.runtime.sendMessage({ type: "auth:signOut" })),
	).toMatchObject({ ok: true });
	await options.close();
}

const japanese =
	"これは翻訳された日本語の文章です。ページの内容を分かりやすく説明しています。新しく追加された文章も引き続き翻訳する必要があります。";

test.each(["未翻訳", "翻訳済み", "停止", "サインアウト", "別オリジン", "言語指定なし"])(
	"BFCache 復元時に最新の状態を反映する（%s）",
	async (mode) => {
		const translated = (text: string) =>
			mode === "言語指定なし" ? japanese : `JA:${text.toUpperCase()}`;
		const server = createServer((request, response) => {
			response.setHeader("Content-Type", "text/html; charset=utf-8");
			response.end(`<!doctype html><html ${mode === "言語指定なし" ? "" : 'lang="en"'}><body>
<p id="text">This is page ${request.url === "/b" ? "B" : "A"}.</p>
<a href="/b">Next page</a>
<script>addEventListener("pageshow", event => { document.documentElement.dataset.persisted = String(event.persisted); });</script>
</body></html>`);
		});
		await new Promise<void>((resolve) => {
			server.listen(0, "127.0.0.1", resolve);
		});
		const address = server.address();
		if (address == null || typeof address === "string")
			throw new Error("HTTP サーバーを起動できません");
		const ext = await launchExtension({
			bfcache: true,
			translationText: mode === "言語指定なし" ? japanese : undefined,
		});
		try {
			const page = await ext.context.newPage();
			await page.goto(`http://127.0.0.1:${address.port}/a`);
			await expect
				.poll(() => ext.sendToTab({ type: "page:getState" }))
				.toMatchObject({ active: false });
			const initiallyTranslated = mode !== "未翻訳" && mode !== "別オリジン";
			if (initiallyTranslated) {
				await ext.sendToTab({ type: "page:translate" });
			}
			await expect
				.poll(() => page.textContent("#text"))
				.toBe(initiallyTranslated ? translated("This is page A.") : "This is page A.");
			const detected = await ext.context
				.serviceWorkers()[0]!
				.evaluate(
					(text) => chrome.i18n.detectLanguage(text),
					await page.locator("body").innerText(),
				);
			expect(
				mode !== "言語指定なし" ||
					(detected.isReliable && detected.languages[0]?.language === "ja"),
			).toBe(true);
			await page.locator("a").evaluate((link, crossOrigin) => {
				if (link instanceof HTMLAnchorElement) {
					if (crossOrigin) link.hostname = "localhost";
					link.click();
				}
			}, mode === "別オリジン");
			await page.waitForURL("**/b");
			await expect.poll(() => ext.sendToTab({ type: "page:getState" })).toHaveProperty("active");
			await ext.sendToTab({ type: "page:translate" });
			await expect.poll(() => page.textContent("#text")).toBe(translated("This is page B."));
			if (mode === "停止") await ext.sendToTab({ type: "page:stop" });
			if (mode === "サインアウト") await signOut(ext);
			await page.goBack({ waitUntil: "commit" });
			await expect
				.poll(() => page.evaluate(() => document.documentElement.dataset["persisted"]))
				.toBe("true");
			const continuing = mode === "未翻訳" || mode === "翻訳済み" || mode === "言語指定なし";
			await expect
				.poll(() => ext.sendToTab({ type: "page:getState" }))
				.toMatchObject({ active: continuing });
			await expect
				.poll(() => page.textContent("#text"))
				.toBe(
					continuing || initiallyTranslated ? translated("This is page A.") : "This is page A.",
				);
			await page.evaluate(() => {
				const paragraph = document.createElement("p");
				paragraph.id = "added";
				paragraph.textContent = "Added after restoration.";
				document.body.append(paragraph);
			});
			await expect
				.poll(() => page.textContent("#added"))
				.toBe(continuing ? translated("Added after restoration.") : "Added after restoration.");
			await page.locator("#added").evaluate((paragraph) => {
				paragraph.textContent = "Changed after restoration.";
			});
			await expect
				.poll(() => page.textContent("#added"))
				.toBe(continuing ? translated("Changed after restoration.") : "Changed after restoration.");
		} finally {
			await ext.context.close();
			await new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			});
		}
	},
);
