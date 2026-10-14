import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { openDB } from "idb";
import * as v from "valibot";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

beforeEach(() => {
	vi.resetModules();
	vi.stubGlobal("indexedDB", new IDBFactory());
	vi.stubEnv("BROWSER", "firefox");
	fakeBrowser.reset();
});
afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

it("Firefox の保存値と変更通知を検証し、storage.local に秘密を置かない", async () => {
	const { defineValidatedItem } = await import("./item");
	const item = defineValidatedItem("local:test", v.nullable(v.object({ token: v.string() })), null);
	const changed = vi.fn();
	const stop = item.watch(changed);
	try {
		await item.setValue({ token: "test-secret" });
		expect(await item.getValue()).toEqual({ token: "test-secret" });
		expect(await fakeBrowser.storage.local.get(null)).toEqual({});
		await vi.waitFor(() => expect(changed).toHaveBeenCalledWith({ token: "test-secret" }));
		const db = await openDB("private-local", 1);
		await db.put("items", { token: 123 }, "test");
		db.close();
		expect(await item.getValue()).toBeNull();
	} finally {
		stop();
	}
});

it("既存データをコピーし、新保存先の値を上書きしない", async () => {
	const { migratePrivateStorage, privateLocalItem } = await import("./private-local");
	await fakeBrowser.storage.local.set({
		credentials: { token: "old" },
		siteRules: { alwaysTranslate: ["example.com"] },
	});
	await privateLocalItem("credentials").setValue({ token: "new" });
	await migratePrivateStorage();
	expect(await privateLocalItem("credentials").getValue()).toEqual({ token: "new" });
	expect(await privateLocalItem("siteRules").getValue()).toEqual({
		alwaysTranslate: ["example.com"],
	});
});

it("移行後に content script が旧保存先へ書いた値を取り込まない", async () => {
	const { migratePrivateStorage, privateLocalItem } = await import("./private-local");
	await migratePrivateStorage();
	const db = await openDB("private-local", 1);
	expect(await db.getKey("items", "credentials")).toBeUndefined();
	db.close();
	await fakeBrowser.storage.local.set({ credentials: { token: "injected" } });
	await migratePrivateStorage();
	expect(await privateLocalItem("credentials").getValue()).toBeUndefined();
});

it("書き込み失敗時は旧保存値を失わない", async () => {
	const { migratePrivateStorage } = await import("./private-local");
	await fakeBrowser.storage.local.set({ credentials: { token: "old" } });
	vi.spyOn(indexedDB, "open").mockImplementation(() => {
		throw new Error("容量不足");
	});
	await expect(migratePrivateStorage()).rejects.toThrow("容量不足");
	expect(await fakeBrowser.storage.local.get("credentials")).toEqual({
		credentials: { token: "old" },
	});
});

it("移行のコミット後に旧コピーだけを削除する", async () => {
	const { migratePrivateStorage, privateLocalItem } = await import("./private-local");
	const saved = {
		credentials: { token: "old" },
		clientId: "client",
		extAgentHostId: "host",
		siteRules: { alwaysTranslate: ["example.com"] },
		cachePolicy: { enabled: true, blocked: false },
	};
	await fakeBrowser.storage.local.set({ ...saved, unrelated: "keep" });
	const remove = vi.spyOn(fakeBrowser.storage.local, "remove");
	await migratePrivateStorage();
	for (const [key, value] of Object.entries(saved))
		expect(await privateLocalItem(key).getValue()).toEqual(value);
	expect(remove).toHaveBeenCalledOnce();
	expect(await fakeBrowser.storage.local.get(null)).toEqual({ unrelated: "keep" });
});

it("旧コピーの削除失敗後も新保存値を保持し、再試行で整理する", async () => {
	const { migratePrivateStorage, privateLocalItem } = await import("./private-local");
	await fakeBrowser.storage.local.set({ credentials: { token: "old" } });
	const remove = vi
		.spyOn(fakeBrowser.storage.local, "remove")
		.mockRejectedValueOnce(new Error("削除失敗"));
	await expect(migratePrivateStorage()).rejects.toThrow("削除失敗");
	expect(await privateLocalItem("credentials").getValue()).toEqual({ token: "old" });
	expect(await fakeBrowser.storage.local.get("credentials")).toEqual({
		credentials: { token: "old" },
	});
	await privateLocalItem("credentials").setValue(null);
	await migratePrivateStorage();
	expect(remove).toHaveBeenCalledTimes(2);
	expect(await privateLocalItem("credentials").getValue()).toBeNull();
	expect(await fakeBrowser.storage.local.get(null)).toEqual({});
});
