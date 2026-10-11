import { expect, test } from "vitest";

import { launchExtension } from "./fixtures";

test("既定では訳文を保存せず、再訪問でもAPIへ要求する", async () => {
	const ext = await launchExtension();
	try {
		const first = await ext.openTestPage();
		await first.bringToFront();
		await ext.sendToTab({ type: "page:translate" });
		await expect.poll(() => first.textContent("#far")).toContain("JA:");
		await expect.poll(() => ext.sendToTab({ type: "page:getState" })).toMatchObject({ busy: 0 });
		const count = (await ext.requests()).length;
		const second = await ext.openTestPage();
		await second.bringToFront();
		await ext.sendToTab({ type: "page:translate" });
		await expect.poll(() => second.textContent("#far")).toContain("JA:");
		await expect.poll(() => ext.sendToTab({ type: "page:getState" })).toMatchObject({ busy: 0 });
		expect((await ext.requests()).length).toBeGreaterThan(count);
	} finally {
		await ext.context.close();
	}
});
