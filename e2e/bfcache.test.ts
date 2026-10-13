import { createServer } from "node:http";

import { expect, test } from "vitest";

import { launchExtension } from "./fixtures";

test("BFCache から戻った未翻訳ページでも継続翻訳を開始する", async () => {
	const server = createServer((request, response) => {
		response.setHeader("Content-Type", "text/html; charset=utf-8");
		response.end(`<!doctype html><html lang="en"><body>
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
	const ext = await launchExtension({ bfcache: true });
	try {
		const page = await ext.context.newPage();
		await page.goto(`http://127.0.0.1:${address.port}/a`);
		await expect
			.poll(() => ext.sendToTab({ type: "page:getState" }))
			.toMatchObject({ active: false });
		await page.locator("a").evaluate((link) => {
			if (link instanceof HTMLAnchorElement) link.click();
		});
		await page.waitForURL("**/b");
		await expect
			.poll(() => ext.sendToTab({ type: "page:getState" }))
			.toMatchObject({ active: false });
		await ext.sendToTab({ type: "page:translate" });
		await expect.poll(() => page.textContent("#text")).toBe("JA:THIS IS PAGE B.");
		await page.goBack({ waitUntil: "commit" });
		await expect
			.poll(() => page.evaluate(() => document.documentElement.dataset["persisted"]))
			.toBe("true");
		await expect.poll(() => page.textContent("#text")).toBe("JA:THIS IS PAGE A.");
	} finally {
		await ext.context.close();
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
	}
});
