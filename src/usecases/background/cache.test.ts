import { beforeEach, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { cachePolicyItem } from "@/infra/storage/cache-policy";

const db = vi.hoisted(() => ({ rotateCache: vi.fn(), countTranslations: vi.fn() }));
vi.mock("@/infra/storage/translation-cache", () => db);
vi.mock("@/infra/storage/auth-access", () => ({ protectAuthStorage: vi.fn(async () => {}) }));
beforeEach(() => {
	fakeBrowser.reset();
	vi.resetModules();
	db.rotateCache.mockReset().mockResolvedValue("new");
	db.countTranslations.mockReset().mockResolvedValue(0);
});
it("既定無効・シークレットでは保存世代を渡さない", async () => {
	const cache = await import("./cache");
	expect((await cache.cacheSession(new AbortController().signal, false)).epoch).toBeNull();
	await cache.enableCache();
	expect((await cache.cacheSession(new AbortController().signal, true)).epoch).toBeNull();
	expect((await cache.cacheSession(new AbortController().signal, false)).epoch).toBe("new");
});
it("消去で進行中要求を中断し、新しい要求だけを再開する", async () => {
	const cache = await import("./cache");
	await cache.enableCache();
	const old = await cache.cacheSession(new AbortController().signal, false);
	db.rotateCache.mockResolvedValue("next");
	await cache.clearCache();
	expect(old.signal.aborted).toBe(true);
	expect((await cache.cacheSession(new AbortController().signal, false)).epoch).toBe("next");
});
it("消去失敗を永続化し、再起動後も停止して再試行で回復する", async () => {
	let cache = await import("./cache");
	await cache.enableCache();
	db.rotateCache.mockRejectedValueOnce(new Error("DB failure"));
	await expect(cache.clearCache()).rejects.toThrow("DB failure");
	expect((await cachePolicyItem.getValue()).blocked).toBe(true);
	vi.resetModules();
	cache = await import("./cache");
	expect((await cache.cacheSession(new AbortController().signal, false)).epoch).toBeNull();
	await cache.clearCache();
	expect((await cache.cacheSession(new AbortController().signal, false)).epoch).toBe("new");
});
it("worker再起動で永続世代を更新し、無効化は設定と全件消去を反映する", async () => {
	let cache = await import("./cache");
	await cache.enableCache();
	vi.resetModules();
	cache = await import("./cache");
	await cache.initializeCache();
	expect(db.rotateCache).toHaveBeenLastCalledWith(false);
	await cache.disableCache();
	expect(db.rotateCache).toHaveBeenLastCalledWith(true);
	expect((await cachePolicyItem.getValue()).enabled).toBe(false);
});
it("認証変更中の翻訳を受け付けない", async () => {
	const cache = await import("./cache");
	const resume = cache.pauseTranslations();
	await expect(cache.cacheSession(new AbortController().signal, false)).rejects.toThrow("認証状態");
	resume();
	await expect(cache.cacheSession(new AbortController().signal, false)).resolves.toBeDefined();
});
