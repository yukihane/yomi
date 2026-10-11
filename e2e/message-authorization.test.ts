import { expect, test } from "vitest";

import { launchExtension } from "./fixtures";

test("content script の管理操作を拒否し、設定画面の認証表示は維持する", async () => {
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
		for (const type of [
			"auth:getState",
			"auth:signIn",
			"auth:signOut",
			"models:list",
			"open:shortcuts",
		]) {
			const result = await cdp.send("Runtime.evaluate", {
				contextId,
				expression: `chrome.runtime.sendMessage({type: ${JSON.stringify(type)}})`,
				awaitPromise: true,
				returnByValue: true,
			});
			expect(result.exceptionDetails).toBeUndefined();
			expect(result.result.value).toMatchObject({ ok: false });
			expect(result.result.value).not.toHaveProperty("value");
		}
		const opened = ext.context.waitForEvent("page");
		const result = await cdp.send("Runtime.evaluate", {
			contextId,
			expression: 'chrome.runtime.sendMessage({type: "open:options"})',
			awaitPromise: true,
			returnByValue: true,
		});
		expect(result.exceptionDetails).toBeUndefined();
		expect(result.result.value).toMatchObject({ ok: true });
		const options = await opened;
		await expect.poll(() => options.getByText("tester@example.com").count()).toBe(1);
	} finally {
		await ext.context.close();
	}
});
