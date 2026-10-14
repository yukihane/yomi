import { By } from "selenium-webdriver";
import { afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import type { Browser } from "wxt/browser";

import { launchFirefoxExtension } from "./fixtures";
import type { FirefoxExtension, FirefoxPage } from "./fixtures";

declare const browser: typeof Browser;

let extension: FirefoxExtension;
const pages: FirefoxPage[] = [];

beforeAll(async () => {
	extension = await launchFirefoxExtension();
	return () => extension.close();
});

beforeEach(async () => {
	await extension.configureMock({});
});

afterEach(async () => {
	for (const page of pages.splice(0)) await extension.closePage(page);
});

async function openPage(path: string) {
	const page = await extension.openTestPage(path);
	pages.push(page);
	return page;
}

function text(page: FirefoxPage, selector: string) {
	return extension.evaluate<string>(
		page,
		(query: string) => document.querySelector(query)?.textContent,
		selector,
	);
}

test("設定とポップアップを表示し、モデルの変更を保存する", async () => {
	const options = extension.control;
	await expect.poll(() => text(options, "select")).toContain("GPT-6 Luna");
	await extension.driver.findElement(By.css('select option[value="gpt-6.1-sol"]')).click();
	await expect
		.poll(() => extension.evaluate(options, () => browser.storage.sync.get("settings")))
		.toMatchObject({ settings: { model: "gpt-6.1-sol" } });
	await extension.driver.navigate().refresh();
	await expect
		.poll(() => extension.evaluate(options, () => document.querySelector("select")?.value))
		.toBe("gpt-6.1-sol");
	await extension.driver.findElement(By.css('select option[value="gpt-6-luna"]')).click();
	await extension.screenshot(options, "options");

	const popup = await extension.newPage("popup.html");
	pages.push(popup);
	await expect.poll(() => text(popup, ".shortcuts")).toContain("翻訳 / 停止");
	await extension.screenshot(popup, "popup");
});

test("設定からブラウザ標準のショートカット設定を開く", async () => {
	await extension.driver.switchTo().window(extension.control.handle);
	const button = By.xpath('//button[normalize-space()="ショートカットを変更"]');
	await expect
		.poll(async () => await extension.driver.findElement(button).isDisplayed())
		.toBe(true);
	await extension.driver
		.findElement(By.xpath('//button[normalize-space()="ショートカットを変更"]'))
		.click();
	await expect
		.poll(
			async () => {
				for (const handle of await extension.driver.getAllWindowHandles()) {
					await extension.driver.switchTo().window(handle);
					const url = await extension.driver.getCurrentUrl();
					if (url === "about:addons") {
						pages.push({ handle, url });
						return true;
					}
				}
				return false;
			},
			{ timeout: 10_000 },
		)
		.toBe(true);
	await expect
		.poll(async () => await extension.driver.findElement(By.css("addon-shortcuts")).isDisplayed(), {
			timeout: 10_000,
		})
		.toBe(true);
});

test("ページ翻訳・原文切り替え・動的な文章・キャッシュが動作する", async () => {
	await extension.evaluate(extension.control, () =>
		browser.runtime.sendMessage({ type: "cache:enable" }),
	);
	const page = await openPage("/translation");
	const original = await extension.evaluate(page, () => document.querySelector("#p1")?.innerHTML);
	await extension.sendToTab(page, { type: "page:translate" });
	await expect.poll(() => text(page, "#h1")).toMatch(/^JA:GETTING/u);
	await expect
		.poll(() => extension.sendToTab(page, { type: "page:getState" }))
		.toMatchObject({ busy: 0, failed: 0 });
	expect(await text(page, "#contents-p")).toContain("JA:");
	expect(await text(page, "#code")).toBe("npm run build");
	expect(await text(page, ".notranslate")).toBe("BrandName");

	await extension.evaluate(page, () => {
		const paragraph = document.createElement("p");
		paragraph.id = "dynamic";
		paragraph.textContent = "Dynamically inserted content";
		document.querySelector("#dynamic-root")!.append(paragraph);
		window.scrollTo(0, document.body.scrollHeight);
	});
	await expect.poll(() => text(page, "#dynamic")).toBe("JA:DYNAMICALLY INSERTED CONTENT");
	await expect.poll(() => text(page, "#far")).toContain("JA:");
	await extension.sendToTab(page, { type: "page:showOriginal" });
	expect(await extension.evaluate(page, () => document.querySelector("#p1")?.innerHTML)).toBe(
		original,
	);
	await extension.sendToTab(page, { type: "page:showTranslation" });
	expect(await text(page, "#h1")).toMatch(/^JA:GETTING/u);
	await expect
		.poll(() => extension.sendToTab(page, { type: "page:getState" }))
		.toMatchObject({ busy: 0, failed: 0 });

	const requests = (await extension.stats()).requests.length;
	await extension.closePage(page);
	pages.splice(pages.indexOf(page), 1);
	const cached = await openPage("/translation");
	await extension.sendToTab(cached, { type: "page:translate" });
	await expect.poll(() => text(cached, "#h1")).toMatch(/^JA:GETTING/u);
	await extension.evaluate(cached, () => window.scrollTo(0, document.body.scrollHeight));
	await expect.poll(() => text(cached, "#far")).toContain("JA:");
	await expect
		.poll(() => extension.sendToTab(cached, { type: "page:getState" }))
		.toMatchObject({ busy: 0, failed: 0 });
	expect((await extension.stats()).requests.length).toBe(requests);
	await extension.evaluate(cached, () => window.scrollTo(0, 0));
	await extension.screenshot(cached, "page");
});

test("選択した文章をページ上のボタンから翻訳する", async () => {
	const page = await openPage("/selection");
	const before = await extension.stats();
	const box = await extension.driver.findElement(By.css("#li2")).getRect();
	await extension.driver
		.actions()
		.move({ x: Math.round(box.x + 2), y: Math.round(box.y + box.height / 2) })
		.press()
		.move({ x: Math.round(box.x + 120), y: Math.round(box.y + box.height / 2), duration: 300 })
		.release()
		.perform();
	const selected = await extension.evaluate<string>(page, () => getSelection()?.toString());
	expect(selected.trim()).not.toBe("");
	await expect
		.poll(async () => {
			const root = await extension.driver.findElement(By.css("yomi-ui")).getShadowRoot();
			return await root.findElement(By.css(".sel-btn"));
		})
		.toBeDefined();
	const root = await extension.driver.findElement(By.css("yomi-ui")).getShadowRoot();
	await (await root.findElement(By.css(".sel-btn"))).click();
	await expect
		.poll(async () => (await extension.stats()).requests.length)
		.toBe(before.requests.length + 1);
	await expect
		.poll(async () => (await extension.stats()).completed)
		.toBeGreaterThan(before.completed);
	expect((await extension.stats()).requests.at(-1)!.input[0]!.content).toBe(selected.trim());
	await expect
		.poll(async () => await (await root.findElement(By.css(".panel .body"))).getText())
		.toContain(`訳: ${selected.trim()}`);
	await extension.screenshot(page, "selection");
});

test("待機時間が長い翻訳もバックグラウンドで完了する", async () => {
	const page = await openPage("/long-response");
	await extension.configureMock({ delayMs: 35_000 });
	await extension.sendToTab(page, { type: "page:translate" });
	await extension.withoutViews(page, async () => {
		await expect.poll(() => text(page, "#h1"), { timeout: 45_000 }).toMatch(/^JA:GETTING/u);
	});
	await expect
		.poll(() => extension.sendToTab(page, { type: "page:getState" }))
		.toMatchObject({ busy: 0, failed: 0 });
}, 50_000);

test("翻訳を停止すると通信も中断する", async () => {
	const page = await openPage("/cancel");
	const before = await extension.stats();
	await extension.configureMock({ delayMs: 35_000 });
	await extension.sendToTab(page, { type: "page:translate" });
	await expect
		.poll(async () => (await extension.stats()).requests.length)
		.toBeGreaterThan(before.requests.length);
	await extension.sendToTab(page, { type: "page:stop" });
	await expect.poll(async () => (await extension.stats()).aborted).toBeGreaterThan(before.aborted);
	expect(await extension.sendToTab(page, { type: "page:getState" })).toMatchObject({
		active: false,
		busy: 0,
	});
});

test("通信エラー後に翻訳を再試行できる", async () => {
	const page = await openPage("/error");
	await extension.configureMock({ fail: true });
	await extension.sendToTab(page, { type: "page:translate" });
	await expect
		.poll(
			async () =>
				(await extension.sendToTab<{ failed: number }>(page, { type: "page:getState" })).failed,
		)
		.toBeGreaterThan(0);
	await extension.configureMock({});
	await extension.sendToTab(page, { type: "page:stop" });
	await extension.sendToTab(page, { type: "page:translate" });
	await expect.poll(() => text(page, "#h1")).toMatch(/^JA:GETTING/u);
	await expect
		.poll(() => extension.sendToTab(page, { type: "page:getState" }))
		.toMatchObject({ failed: 0, busy: 0 });
});
