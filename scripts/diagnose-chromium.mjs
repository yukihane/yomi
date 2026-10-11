import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { chromium } from "playwright-core";

const executablePath = process.env.CHROMIUM_PATH;
console.log("実行ファイル", executablePath, realpathSync(executablePath));
const extensionPath = resolve(".output/chrome-mv3");
let context;
try {
	console.log("ブラウザー起動開始");
	context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "yomi-diagnose-")), {
		executablePath,
		headless: true,
		args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
		viewport: { width: 1000, height: 800 },
		timeout: 15_000,
	});
	console.log("ブラウザー起動完了");
	const page = await context.newPage();
	const session = await context.newCDPSession(page);
	console.log("ブラウザーバージョン", await session.send("Browser.getVersion"));
	await page.goto("chrome://version");
	console.log("ブラウザー実体", await page.locator("body").innerText());
	console.log("service worker 待機開始");
	const sw =
		context.serviceWorkers()[0] ??
		(await context.waitForEvent("serviceworker", { timeout: 10_000 }));
	console.log("service worker 起動完了", sw.url());
} catch (error) {
	console.log("診断結果", String(error));
} finally {
	await context?.close();
}
