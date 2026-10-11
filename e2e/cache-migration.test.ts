import { expect, test } from "vitest";

import { launchExtension } from "./fixtures";

type LegacyProbe = typeof globalThis & { __legacyDb: IDBDatabase };

test("旧画面がDB更新を妨げても翻訳でき、解放後は旧行を破棄して再利用する", async () => {
	const ext = await launchExtension();
	try {
		await expect
			.poll(() => ext.context.pages().some((page) => page.url().endsWith("/options.html")))
			.toBe(true);
		for (const page of ext.context.pages()) {
			if (page.url().startsWith(`chrome-extension://${ext.extensionId}/`)) await page.close();
		}
		const worker = ext.context.serviceWorkers()[0]!;
		await worker.evaluate(async () => {
			await new Promise<void>((resolve, reject) => {
				const request = indexedDB.deleteDatabase("translation-cache");
				request.onsuccess = () => resolve();
				request.addEventListener(
					"error",
					() => reject(request.error ?? new Error("DB操作に失敗しました")),
					{ once: true },
				);
				request.onblocked = () => reject(new Error("旧DBの準備がブロックされました"));
			});
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open("translation-cache", 1);
				request.onupgradeneeded = () =>
					request.result
						.createObjectStore("entries", { keyPath: "key" })
						.createIndex("usedAt", "usedAt");
				request.onsuccess = () => resolve(request.result);
				request.addEventListener(
					"error",
					() => reject(request.error ?? new Error("DB操作に失敗しました")),
					{ once: true },
				);
			});
			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction("entries", "readwrite");
				tx.objectStore("entries").put({
					key: "legacy-untrusted-key",
					translation: "POISON",
					usedAt: Date.now(),
				});
				tx.oncomplete = () => resolve();
				tx.addEventListener(
					"error",
					() => reject(tx.error ?? new Error("DB書き込みに失敗しました")),
					{ once: true },
				);
			});
			(globalThis as LegacyProbe).__legacyDb = db;
		});
		const first = await ext.openTestPage();
		await first.bringToFront();
		await ext.sendToTab({ type: "page:translate" });
		await expect.poll(() => first.textContent("#far")).toContain("JA:");
		await expect.poll(() => ext.sendToTab({ type: "page:getState" })).toMatchObject({ busy: 0 });
		await worker.evaluate(() => (globalThis as LegacyProbe).__legacyDb.close());
		await expect
			.poll(() =>
				worker.evaluate(
					async () =>
						(await indexedDB.databases()).find((db) => db.name === "translation-cache")?.version,
				),
			)
			.toBe(2);
		const before = (await ext.requests()).length;
		const second = await ext.openTestPage();
		await second.bringToFront();
		await ext.sendToTab({ type: "page:translate" });
		await expect.poll(() => second.textContent("#far")).toContain("JA:");
		await expect.poll(() => ext.sendToTab({ type: "page:getState" })).toMatchObject({ busy: 0 });
		expect((await ext.requests()).length).toBeGreaterThan(before);
		const count = (await ext.requests()).length;
		const third = await ext.openTestPage();
		await third.bringToFront();
		await ext.sendToTab({ type: "page:translate" });
		await expect.poll(() => third.textContent("#far")).toContain("JA:");
		await expect.poll(() => ext.sendToTab({ type: "page:getState" })).toMatchObject({ busy: 0 });
		expect((await ext.requests()).length).toBe(count);
		const oldRow = await worker.evaluate(async () => {
			const db = await new Promise<IDBDatabase>((resolve) => {
				const request = indexedDB.open("translation-cache", 2);
				request.onsuccess = () => resolve(request.result);
			});
			try {
				return await new Promise<unknown>((resolve) => {
					const request = db
						.transaction("entries")
						.objectStore("entries")
						.get("legacy-untrusted-key");
					request.onsuccess = () => resolve(request.result);
				});
			} finally {
				db.close();
			}
		});
		expect(oldRow).toBeUndefined();
	} finally {
		await ext.context.close();
	}
});
