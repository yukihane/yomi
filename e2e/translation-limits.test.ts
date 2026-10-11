import { expect, test } from "vitest";

import { launchExtension } from "./fixtures";

test("過大な要求をAPI送信前に拒否し、正常要求と連打制限を維持する", async () => {
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
		const evaluate = async (expression: string) => {
			const result = await cdp.send("Runtime.evaluate", {
				contextId,
				expression,
				awaitPromise: true,
				returnByValue: true,
			});
			expect(result.exceptionDetails).toBeUndefined();
			return result.result.value as unknown;
		};
		const request = (text: string) =>
			`new Promise(resolve=>{ const events=[];const port=chrome.runtime.connect({name:"translate"});port.onMessage.addListener(e=>{events.push(e);if(e.type==="done"||e.type==="error"){resolve(events);port.disconnect();}});port.postMessage(${JSON.stringify({ kind: "selection", targetLang: "ja", text })});})`;
		expect(await evaluate(request("x".repeat(8001)))).toEqual([
			expect.objectContaining({
				type: "error",
				failure: expect.objectContaining({ kind: "request_limit" }),
			}),
		]);
		expect(await ext.requests()).toHaveLength(0);
		expect(await evaluate(request("Hello"))).toEqual(
			expect.arrayContaining([expect.objectContaining({ type: "delta" }), { type: "done" }]),
		);
		expect(await ext.requests()).toHaveLength(1);
		expect(
			await evaluate(
				`Promise.all([chrome.runtime.sendMessage({type:"open:options"}),chrome.runtime.sendMessage({type:"open:usage"})])`,
			),
		).toEqual([expect.objectContaining({ ok: true }), expect.objectContaining({ ok: false })]);
	} finally {
		await ext.context.close();
	}
});
