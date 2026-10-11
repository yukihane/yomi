import { afterEach, expect, it, vi } from "vitest";

const openPage = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/infra/browser/tabs", () => ({
	openOptionsPage: openPage,
	openUsagePage: openPage,
	openShortcutsPage: openPage,
}));
afterEach(() => vi.useRealTimers());
it("種類を変えた連打も制限し、待機後は再び開ける", async () => {
	vi.useFakeTimers();
	const pages = await import("./open-page");
	await pages.openOptions();
	await expect(pages.openUsage()).rejects.toThrow("画面を開く操作");
	await vi.advanceTimersByTimeAsync(1000);
	await pages.openUsage();
	expect(openPage).toHaveBeenCalledTimes(2);
});
