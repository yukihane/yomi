import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import type { MessageCaller } from "@/domain/message-caller";
import { tabStatesItem } from "@/infra/storage/tab-state";

import {
	commitNavigation,
	dismissOffer,
	forgetTab,
	getTabPageState,
	setTranslating,
	stopRememberedTranslations,
} from "./tab-state";

const frames = new Map<number, { documentId: string; url: string }>();
const webNavigation = fakeBrowser.webNavigation as unknown as {
	getFrame: (details: { tabId: number }) => Promise<unknown>;
};
function caller(tabId = 1, documentId = "doc-1", url = "https://example.com/first"): MessageCaller {
	return { kind: "content", tabId, documentId, url, origin: new URL(url).origin, incognito: false };
}
function navigation(
	transitionType: string,
	url = "https://example.com/next",
	documentId = "doc-2",
	transitionQualifiers: string[] = [],
) {
	frames.set(1, { documentId, url });
	return commitNavigation({
		tabId: 1,
		frameId: 0,
		documentId,
		url,
		transitionType,
		transitionQualifiers,
	});
}
beforeEach(() => {
	fakeBrowser.reset();
	frames.clear();
	frames.set(1, { documentId: "doc-1", url: "https://example.com/first" });
	frames.set(2, { documentId: "doc-1", url: "https://example.com/first" });
	vi.spyOn(webNavigation, "getFrame").mockImplementation(async ({ tabId }) => ({
		...frames.get(tabId)!,
		documentLifecycle: "active",
		parentFrameId: -1,
		errorOccurred: false,
	}));
});
describe("tab-state", () => {
	it("別タブの同時更新を取りこぼさず記録する", async () => {
		await Promise.all([dismissOffer(caller()), setTranslating(caller(2), true)]);
		expect(await getTabPageState(caller())).toEqual({ offerDismissed: true, translating: false });
		expect(await getTabPageState(caller(2))).toEqual({ offerDismissed: false, translating: true });
	});
	it.each(["link", "form_submit"])("同一オリジンの %s では継続する", async (type) => {
		await setTranslating(caller(), true);
		await navigation(type);
		expect(await getTabPageState(caller(1, "doc-2", "https://example.com/next"))).toMatchObject({
			translating: true,
		});
	});
	it.each([
		"https://other.example/next",
		"http://example.com/next",
		"https://example.com:8443/next",
	])("別オリジン %s では継続しない", async (url) => {
		await setTranslating(caller(), true);
		await navigation("link", url);
		expect(await getTabPageState(caller(1, "doc-2", url))).toMatchObject({ translating: false });
	});
	it.each(["typed", "auto_bookmark", "generated"])("%s では翻訳だけリセットする", async (type) => {
		await dismissOffer(caller());
		await setTranslating(caller(), true);
		await navigation(type);
		expect(await getTabPageState(caller(1, "doc-2", "https://example.com/next"))).toEqual({
			translating: false,
			offerDismissed: true,
		});
	});
	it("リロードでは抑制と継続をリセットする", async () => {
		await dismissOffer(caller());
		await setTranslating(caller(), true);
		await navigation("reload");
		expect(await getTabPageState(caller(1, "doc-2", "https://example.com/next"))).toEqual({
			translating: false,
			offerDismissed: false,
		});
	});
	it("同一オリジンの戻る・進むでは継続する", async () => {
		await setTranslating(caller(), true);
		await navigation("typed", "https://example.com/next", "doc-2", ["forward_back"]);
		expect(await getTabPageState(caller(1, "doc-2", "https://example.com/next"))).toMatchObject({
			translating: true,
		});
	});
	it("古い文書からの遅延通知は新しい文書の状態を変更しない", async () => {
		await setTranslating(caller(), true);
		await navigation("link");
		await expect(setTranslating(caller(), false)).rejects.toThrow("翻訳元の文書を確認できません");
		await expect(dismissOffer(caller())).rejects.toThrow("翻訳元の文書を確認できません");
		expect(await getTabPageState(caller(1, "doc-2", "https://example.com/next"))).toEqual({
			translating: true,
			offerDismissed: false,
		});
	});
	it("手動停止したページからは継続しない", async () => {
		await setTranslating(caller(), true);
		await setTranslating(caller(), false);
		await navigation("link");
		expect(await getTabPageState(caller(1, "doc-2", "https://example.com/next"))).toMatchObject({
			translating: false,
		});
	});
	it("全ページ停止で継続状態を消し、終了したタブの記録を削除する", async () => {
		await setTranslating(caller(), true);
		await stopRememberedTranslations();
		expect(await getTabPageState(caller())).toMatchObject({ translating: false });
		await forgetTab(1);
		expect(await tabStatesItem.getValue()).toEqual({});
	});
	it("拡張画面と不正な遷移からタブ状態を作らない", async () => {
		await expect(setTranslating({ kind: "extension", page: "popup" }, true)).rejects.toThrow(
			"この画面からタブを操作できません",
		);
		await commitNavigation({ tabId: 1, frameId: 1 });
		expect(await tabStatesItem.getValue()).toEqual({});
	});
});
