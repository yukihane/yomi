import { beforeEach, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import type { MessageCaller } from "@/domain/message-caller";
import { EMPTY_SITE_RULES } from "@/domain/site-rules";

import { changeSiteRule, excludePageOffer, getSiteRules, pageSiteRules } from "./site-rules";

const extension: MessageCaller = { kind: "extension", page: "options" };
const navigation = fakeBrowser.webNavigation as unknown as {
	getFrame: (details: unknown) => Promise<unknown>;
};
const content: MessageCaller = {
	kind: "content",
	tabId: 1,
	documentId: "doc",
	url: "https://example.com/page",
	origin: "https://example.com",
	incognito: false,
};
beforeEach(() => {
	fakeBrowser.reset();
	vi.spyOn(fakeBrowser.storage.local, "setAccessLevel").mockResolvedValue();
	vi.spyOn(fakeBrowser.storage.session, "setAccessLevel").mockResolvedValue();
	vi.spyOn(navigation, "getFrame").mockResolvedValue({
		documentId: "doc",
		documentLifecycle: "active",
		url: content.url,
		parentFrameId: -1,
		errorOccurred: false,
	});
});
it("同時に追加しても他サイトの設定を失わない", async () => {
	await Promise.all([
		changeSiteRule({ type: "always", host: "one.example", enabled: true }, extension),
		changeSiteRule({ type: "always", host: "two.example", enabled: true }, extension),
	]);
	expect((await getSiteRules()).alwaysTranslate).toEqual(["one.example", "two.example"]);
});
it("content script から永続的な自動翻訳許可を付与・削除できない", async () => {
	await expect(
		changeSiteRule({ type: "always", host: "example.com", enabled: true }, content),
	).rejects.toThrow("サイト設定は拡張機能の画面から変更してください");
	await expect(
		changeSiteRule({ type: "remove", list: "neverOffer", value: "example.com" }, content),
	).rejects.toThrow("サイト設定は拡張機能の画面から変更してください");
	expect(await getSiteRules()).toEqual(EMPTY_SITE_RULES);
});
it("現在サイトの提案だけを除外し、他サイトのルールを返さない", async () => {
	await changeSiteRule({ type: "always", host: "other.example", enabled: true }, extension);
	await excludePageOffer({ type: "site" }, content);
	expect(await pageSiteRules(content)).toEqual({
		alwaysTranslate: [],
		neverOffer: ["example.com"],
		neverOfferLangs: [],
	});
	expect((await getSiteRules()).alwaysTranslate).toEqual(["other.example"]);
});
it("古い文書による除外を拒否する", async () => {
	await expect(
		excludePageOffer({ type: "site" }, { ...content, documentId: "old" }),
	).rejects.toThrow("翻訳元の文書を確認できません");
	expect(await getSiteRules()).toEqual(EMPTY_SITE_RULES);
});
it("自動翻訳の解除とルールの削除を保存する", async () => {
	await changeSiteRule({ type: "always", host: "example.com", enabled: true }, extension);
	await changeSiteRule({ type: "always", host: "example.com", enabled: false }, extension);
	await excludePageOffer({ type: "language", language: "en" }, content);
	await changeSiteRule({ type: "remove", list: "neverOfferLangs", value: "en" }, extension);
	expect(await getSiteRules()).toEqual(EMPTY_SITE_RULES);
});
