import { expect, test } from "vitest";

import { cacheKey } from "../src/domain/translation-cache";
import { enableCache, launchExtension, TEST_PAGE } from "./fixtures";
import type { Extension } from "./fixtures";

async function content(ext: Extension, url: string) {
	const page = await ext.context.newPage();
	await page.route("**/*", (route) => route.fulfill({ contentType: "text/html", body: TEST_PAGE }));
	await page.goto(url);
	const cdp = await ext.context.newCDPSession(page);
	let contextId: number | undefined;
	cdp.on("Runtime.executionContextCreated", ({ context }) => {
		if (context.name === "Yomi") contextId = context.id;
	});
	await cdp.send("Runtime.enable");
	await expect.poll(() => contextId).toBeDefined();
	return {
		page,
		evaluate: async (expression: string): Promise<unknown> => {
			const result = await cdp.send("Runtime.evaluate", {
				contextId,
				expression,
				awaitPromise: true,
				returnByValue: true,
			});
			expect(result.exceptionDetails).toBeUndefined();
			return result.result.value;
		},
	};
}

const request = {
	kind: "page",
	targetLang: "ja",
	segments: ["Hello"],
	context: { title: "Title", description: "Description" },
};
const stream = (req: unknown) => `new Promise(resolve => {
	const events = [];
	const port = chrome.runtime.connect({name: "translate"});
	port.onMessage.addListener(event => {
		events.push(event);
		if (event.type === "done" || event.type === "error") { resolve(events); port.disconnect(); }
	});
	port.onDisconnect.addListener(() => resolve(events));
	port.postMessage(${JSON.stringify(req)});
})`;
const translated = [{ type: "segment", index: 0, markup: "JA:HELLO" }, { type: "done" }];

test("別サイトの既知キーを参照・上書きできず、正規の同一サイトキャッシュは再利用できる", async () => {
	const ext = await launchExtension();
	await enableCache(ext);
	try {
		const siteB = await content(ext, "https://b.example/page");
		expect(await siteB.evaluate(stream(request))).toEqual(translated);
		expect((await ext.requests()).length).toBe(1);
		const [apiRequest] = await ext.requests();
		const knownKey = cacheKey("ja", "https://b.example/page", "Hello", {
			model: "gpt-6-luna",
			reasoningEffort: "low",
			fastMode: false,
			instructions: apiRequest!.instructions,
		});
		const siteA = await content(ext, "https://a.example/page");
		for (const message of [
			{ type: "cache:lookup", params: { keys: [knownKey] } },
			{ type: "cache:store", params: { entries: [{ key: knownKey, translation: "POISON" }] } },
		]) {
			expect(
				await siteA.evaluate(`chrome.runtime.sendMessage(${JSON.stringify(message)})`),
			).toMatchObject({ ok: false });
		}
		expect(await siteA.evaluate(stream({ ...request, origin: "https://b.example" }))).toEqual([
			expect.objectContaining({ type: "error" }),
		]);
		expect(await siteB.evaluate(stream(request))).toEqual(translated);
		expect((await ext.requests()).length).toBe(1);
		expect(await siteA.evaluate(stream(request))).toEqual(translated);
		expect((await ext.requests()).length).toBe(2);
		expect(await siteA.evaluate(stream(request))).toEqual(translated);
		expect((await ext.requests()).length).toBe(2);
		await siteA.page.evaluate(() => history.pushState({}, "", "/other"));
		expect(await siteA.evaluate(stream(request))).toEqual(translated);
		expect((await ext.requests()).length).toBe(3);
		await siteA.page.evaluate(() => history.pushState({}, "", "/page"));
		expect(await siteA.evaluate(stream(request))).toEqual(translated);
		expect((await ext.requests()).length).toBe(3);
	} finally {
		await ext.context.close();
	}
});

test("旧翻訳形式は再読み込みを案内し、APIに送信しない", async () => {
	const ext = await launchExtension();
	await enableCache(ext);
	try {
		const site = await content(ext, "https://a.example/page");
		expect(await site.evaluate(stream({ instructions: "old", input: "Hello" }))).toEqual([
			expect.objectContaining({
				type: "error",
				failure: expect.objectContaining({ kind: "extension_reloaded" }),
			}),
		]);
		expect(await ext.requests()).toEqual([]);
	} finally {
		await ext.context.close();
	}
});
