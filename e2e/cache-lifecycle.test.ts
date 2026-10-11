import { expect, test } from "vitest";
import type { Browser } from "wxt/browser";

import { enableCache, launchExtension } from "./fixtures";

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

declare const chrome: typeof Browser;
type Delayed = typeof globalThis & { __waiting: boolean; __release: () => void };

test.each(["cache:clear", "cache:disable", "auth:signOut", "epoch-change"])(
	"%s の後で遅延応答が訳文を復活させない",
	async (action) => {
		const ext = await launchExtension();
		try {
			await enableCache(ext);
			const options = await ext.context.newPage();
			await options.goto(`chrome-extension://${ext.extensionId}/options.html`);
			const worker = ext.context.serviceWorkers()[0]!;
			await worker.evaluate(() => {
				const original = globalThis.fetch;
				globalThis.fetch = async (url, init) => {
					const target = url instanceof Request ? url.url : String(url);
					if (target.endsWith("/oauth/revoke")) return new Response(null, { status: 200 });
					if (target.endsWith("/responses")) {
						(globalThis as Delayed).__waiting = true;
						await new Promise<void>((resolve) => {
							(globalThis as Delayed).__release = resolve;
						});
					}
					return await original(url, init);
				};
			});
			const page = await ext.openTestPage();
			await page.bringToFront();
			await ext.sendToTab({ type: "page:translate" });
			await expect.poll(() => worker.evaluate(() => (globalThis as Delayed).__waiting)).toBe(true);
			let result: unknown = { ok: true };
			if (action === "epoch-change") {
				await worker.evaluate(async () => {
					const db = await new Promise<IDBDatabase>((resolve) => {
						const r = indexedDB.open("translation-cache", 3);
						r.onsuccess = () => resolve(r.result);
					});
					try {
						await new Promise<void>((resolve, reject) => {
							const tx = db.transaction("meta", "readwrite");
							tx.objectStore("meta").put(crypto.randomUUID(), "epoch");
							tx.oncomplete = () => resolve();
							tx.addEventListener("abort", () => reject(new Error("世代更新失敗")), { once: true });
						});
					} finally {
						db.close();
					}
				});
			} else {
				result = await options.evaluate((type) => chrome.runtime.sendMessage({ type }), action);
			}
			expect(result).toMatchObject({ ok: true });
			await worker.evaluate(() => (globalThis as Delayed).__release());
			await expect.poll(() => ext.sendToTab({ type: "page:getState" })).toMatchObject({ busy: 0 });
			expect(
				await options.evaluate(() => chrome.runtime.sendMessage({ type: "cache:status" })),
			).toMatchObject({ ok: true, value: { count: 0 } });
		} finally {
			await ext.context.close();
		}
	},
);

test("期限切れの行を返さず削除し、有効化後の行だけを再利用する", async () => {
	const ext = await launchExtension();
	try {
		await enableCache(ext);
		const translatePage = async () => {
			const page = await ext.openTestPage();
			await page.bringToFront();
			await ext.sendToTab({ type: "page:translate" });
			await expect.poll(() => page.textContent("#far")).toContain("JA:");
			await expect.poll(() => ext.sendToTab({ type: "page:getState" })).toMatchObject({ busy: 0 });
		};
		await translatePage();
		const initial = (await ext.requests()).length;
		await translatePage();
		expect((await ext.requests()).length).toBe(initial);
		await ext.context.serviceWorkers()[0]!.evaluate(async () => {
			const db = await new Promise<IDBDatabase>((resolve) => {
				const req = indexedDB.open("translation-cache", 3);
				req.onsuccess = () => resolve(req.result);
			});
			try {
				await new Promise<void>((resolve, reject) => {
					const tx = db.transaction("entries", "readwrite");
					const req = tx.objectStore("entries").openCursor();
					req.onsuccess = () => {
						const cursor = req.result;
						if (!cursor) return;
						const row = cursor.value as Record<string, unknown>;
						cursor.update({ ...row, createdAt: Date.now() - 7 * 86400000, expiresAt: Date.now() });
						cursor.continue();
					};
					tx.oncomplete = () => resolve();
					tx.addEventListener("abort", () => reject(new Error("DB操作失敗")), { once: true });
				});
			} finally {
				db.close();
			}
		});
		await translatePage();
		expect((await ext.requests()).length).toBeGreaterThan(initial);
	} finally {
		await ext.context.close();
	}
});

type QueuedFetch = typeof globalThis & { __started: number; __releaseAll: () => void };
test("キャッシュ消去で待機バッチとDOM監視を停止し、明示的な再開まで保存しない", async () => {
	const ext = await launchExtension();
	try {
		await enableCache(ext);
		const options = await ext.context.newPage();
		await options.goto(`chrome-extension://${ext.extensionId}/options.html`);
		const worker = ext.context.serviceWorkers()[0]!;
		await worker.evaluate(() => {
			const original = globalThis.fetch;
			const state = globalThis as QueuedFetch;
			state.__started = 0;
			const gate = new Promise<void>((resolve) => {
				state.__releaseAll = resolve;
			});
			globalThis.fetch = async (url, init) => {
				const target = url instanceof Request ? url.url : String(url);
				if (target.endsWith("/responses")) {
					state.__started++;
					await gate;
					if (init?.signal?.aborted === true) throw new Error("通信が中断されました");
				}
				return await original(url, init);
			};
		});
		const page = await ext.openTestPage();
		await page.evaluate(() => {
			document.body.replaceChildren(
				...Array.from({ length: 200 }, (_, i) => {
					const p = document.createElement("p");
					p.textContent = `Paragraph number ${i}.`;
					return p;
				}),
			);
		});
		await page.bringToFront();
		await ext.sendToTab({ type: "page:translate" });
		await expect.poll(() => worker.evaluate(() => (globalThis as QueuedFetch).__started)).toBe(4);
		expect(await ext.sendToTab({ type: "page:getState" })).toMatchObject({
			active: true,
			busy: 200,
		});
		expect(
			await options.evaluate(() => chrome.runtime.sendMessage({ type: "cache:clear" })),
		).toMatchObject({ ok: true });
		await worker.evaluate(() => (globalThis as QueuedFetch).__releaseAll());
		await expect
			.poll(() => ext.sendToTab({ type: "page:getState" }))
			.toMatchObject({ active: false, busy: 0 });
		await page.evaluate(async () => {
			const p = document.createElement("p");
			p.id = "after-clear";
			p.textContent = "New paragraph after clearing.";
			document.body.append(p);
			await new Promise<void>((resolve) => {
				requestAnimationFrame(() => {
					requestAnimationFrame(() => resolve());
				});
			});
		});
		expect(await worker.evaluate(() => (globalThis as QueuedFetch).__started)).toBe(4);
		expect(
			await options.evaluate(() => chrome.runtime.sendMessage({ type: "cache:status" })),
		).toMatchObject({ ok: true, value: { count: 0 } });
		await ext.sendToTab({ type: "page:translate" });
		await expect.poll(() => page.textContent("#after-clear")).toContain("JA:");
		await expect
			.poll(() => ext.sendToTab({ type: "page:getState" }))
			.toMatchObject({ busy: 0, done: 201 });
		expect(
			await options.evaluate(() => chrome.runtime.sendMessage({ type: "cache:status" })),
		).toMatchObject({ ok: true, value: { count: 201 } });
	} finally {
		await ext.context.close();
	}
});
