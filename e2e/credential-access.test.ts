import { expect, test } from "vitest";

import { launchExtension } from "./fixtures";

test("content script から資格情報を読み書きできない", async () => {
	const ext = await launchExtension();
	try {
		const page = await ext.openTestPage();
		const cdp = await ext.context.newCDPSession(page);
		let contextId: number | undefined;
		cdp.on("Runtime.executionContextCreated", ({ context }) => {
			if (context.name === "Yomi") contextId = context.id;
		});
		await cdp.send("Runtime.enable");
		await expect.poll(() => contextId).toBeDefined();
		const read = await cdp.send("Runtime.evaluate", {
			contextId,
			expression: `Promise.resolve().then(() => chrome.storage.local.get("credentials")).then(value => value.credentials?.refreshToken === "fake-refresh", () => false)`,
			awaitPromise: true,
			returnByValue: true,
		});
		expect(read.exceptionDetails).toBeUndefined();
		expect(read.result.value).toBe(false);
		const write = await cdp.send("Runtime.evaluate", {
			contextId,
			expression: `Promise.resolve().then(() => chrome.storage.local.set({credentials: null})).then(() => true, () => false)`,
			awaitPromise: true,
			returnByValue: true,
		});
		expect(write.exceptionDetails).toBeUndefined();
		expect(write.result.value).toBe(false);
		const options = await ext.context.newPage();
		await options.goto(`chrome-extension://${ext.extensionId}/options.html`);
		await expect.poll(() => options.getByText("tester@example.com").count()).toBe(1);
	} finally {
		await ext.context.close();
	}
});
