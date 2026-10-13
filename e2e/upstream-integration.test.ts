import type { Page } from "playwright-core";
import { expect, test } from "vitest";
import type { Browser } from "wxt/browser";

import { launchExtension, screenshot, TEST_PAGE } from "./fixtures";
import type { Extension } from "./fixtures";

declare const chrome: typeof Browser;

async function contentContext(ext: Extension, page: Page) {
	const cdp = await ext.context.newCDPSession(page);
	let contextId: number | undefined;
	cdp.on("Runtime.executionContextCreated", ({ context }) => {
		if (context.name === "Yomi") contextId = context.id;
	});
	await cdp.send("Runtime.enable");
	await expect.poll(() => contextId).toBeDefined();
	return async (expression: string): Promise<unknown> => {
		const result = await cdp.send("Runtime.evaluate", {
			contextId,
			expression,
			awaitPromise: true,
			returnByValue: true,
		});
		expect(result.exceptionDetails).toBeUndefined();
		return result.result.value;
	};
}

async function follow(page: Page, url: string) {
	await page.evaluate((href) => {
		const link = document.createElement("a");
		link.href = href;
		document.body.append(link);
		link.click();
	}, url);
	await page.waitForURL(url);
}

test("サイト設定の直接読み書きと管理APIを拒否し、提案には個人情報を返さない", async () => {
	const ext = await launchExtension();
	try {
		await ext.setSiteRules({ alwaysTranslate: ["private.example"] });
		const page = await ext.openTestPage();
		const evaluate = await contentContext(ext, page);
		expect(
			await evaluate('chrome.storage.local.get("siteRules").then(() => true, () => false)'),
		).toBe(false);
		expect(
			await evaluate(
				'chrome.storage.local.set({siteRules: {alwaysTranslate:["test.example"]}}).then(() => true, () => false)',
			),
		).toBe(false);
		expect(await evaluate('chrome.runtime.sendMessage({type:"siteRules:get"})')).toMatchObject({
			ok: false,
		});
		expect(
			await evaluate(
				'chrome.runtime.sendMessage({type:"siteRules:change",params:{type:"always",host:"test.example",enabled:true}})',
			),
		).toMatchObject({ ok: false });
		const state = await evaluate('chrome.runtime.sendMessage({type:"offer:getState"})');
		expect(state).toMatchObject({
			ok: true,
			value: { signedIn: true, rules: { alwaysTranslate: [] } },
		});
		expect(state).not.toHaveProperty("value.email");
		expect(JSON.stringify(state)).not.toContain("tester@example.com");
		expect(JSON.stringify(state)).not.toContain("private.example");
	} finally {
		await ext.context.close();
	}
});

test("設定画面で自動翻訳を追加・削除でき、別画面にも反映する", async () => {
	const ext = await launchExtension();
	try {
		const options = await ext.context.newPage();
		await options.goto(`chrome-extension://${ext.extensionId}/options.html`);
		const other = await ext.context.newPage();
		await other.goto(options.url());
		await options.getByLabel("常に翻訳するサイト名").fill("test.example");
		await options.getByRole("button", { name: "追加", exact: true }).click();
		await expect.poll(() => other.getByText("test.example", { exact: true }).count()).toBe(1);
		await screenshot(options, "site-rules", { fullPage: true });
		const stored = await ext.context.serviceWorkers()[0]!.evaluate(async () => ({
			local: await chrome.storage.local.get("siteRules"),
			sync: await chrome.storage.sync.get("siteRules"),
		}));
		expect(stored.local).toMatchObject({ siteRules: { alwaysTranslate: ["test.example"] } });
		expect(stored.sync).toEqual({});
		const page = await ext.openTestPage();
		await expect.poll(() => page.textContent("#h1")).toMatch(/^JA:/u);
		await options.getByRole("button", { name: "削除", exact: true }).click();
		await expect.poll(() => other.getByText("test.example", { exact: true }).count()).toBe(0);
	} finally {
		await ext.context.close();
	}
});

test("提案の自動翻訳設定は設定画面だけを開き、本文を送信しない", async () => {
	const ext = await launchExtension();
	try {
		const page = await ext.openTestPage();
		await expect.poll(() => page.locator("yomi-ui").count()).toBe(1);
		const width = await page.evaluate(() => document.documentElement.clientWidth);
		await page.mouse.click(width - 16 - 360 + 140, 70);
		const optionsUrl = `chrome-extension://${ext.extensionId}/options.html`;
		await expect.poll(() => ext.context.pages().some((p) => p.url() === optionsUrl)).toBe(true);
		expect(await ext.requests()).toEqual([]);
		expect(await page.textContent("#h1")).not.toMatch(/^JA:/u);
	} finally {
		await ext.context.close();
	}
});

test("別オリジンへのリンクは継続せず、登録済みの移動先だけ自動翻訳する", async () => {
	const ext = await launchExtension();
	try {
		const page = await ext.openTestPage();
		await page.route("https://other.example/**", (route) =>
			route.fulfill({ contentType: "text/html", body: TEST_PAGE }),
		);
		await ext.sendToTab({ type: "page:translate" });
		await expect.poll(() => page.textContent("#far")).toMatch(/^JA:/u);
		await follow(page, "https://other.example/next");
		await expect.poll(() => page.locator("yomi-ui").count()).toBe(1);
		expect(await ext.sendToTab({ type: "page:getState" })).toMatchObject({ active: false });
		expect(await page.textContent("#h1")).not.toMatch(/^JA:/u);
		await ext.setSiteRules({ alwaysTranslate: ["other.example"] });
		await page.reload();
		await expect.poll(() => page.textContent("#h1")).toMatch(/^JA:/u);
	} finally {
		await ext.context.close();
	}
});

test.each(["cache:clear", "auth:signOut"])(
	"%s は継続記録も消して次ページを自動再開しない",
	async (action) => {
		const ext = await launchExtension();
		try {
			const options = await ext.context.newPage();
			await options.goto(`chrome-extension://${ext.extensionId}/options.html`);
			const page = await ext.openTestPage();
			await ext.sendToTab({ type: "page:translate" });
			await expect.poll(() => page.textContent("#far")).toMatch(/^JA:/u);
			expect(
				await options.evaluate((type) => chrome.runtime.sendMessage({ type }), action),
			).toMatchObject({ ok: true });
			await expect
				.poll(() => ext.sendToTab({ type: "page:getState" }))
				.toMatchObject({ active: false, busy: 0 });
			const states = await ext.context.serviceWorkers()[0]!.evaluate(async () => {
				const stored = await chrome.storage.session.get("tabPageStates");
				return stored["tabPageStates"] as Record<string, { translating: boolean }>;
			});
			expect(Object.values(states).every((state) => !state.translating)).toBe(true);
			await follow(page, "https://test.example/next");
			const evaluate = await contentContext(ext, page);
			await expect
				.poll(() => evaluate('chrome.runtime.sendMessage({type:"offer:getState"})'))
				.toMatchObject({
					ok: true,
					value: { translating: false, signedIn: action !== "auth:signOut" },
				});
			expect(await ext.sendToTab({ type: "page:getState" })).toMatchObject({ active: false });
		} finally {
			await ext.context.close();
		}
	},
);
