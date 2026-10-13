import { beforeEach, expect, it, vi } from "vitest";

import { withDefaults } from "@/domain/settings";
import { EMPTY_SITE_RULES } from "@/domain/site-rules";
import type { SiteRules } from "@/domain/site-rules";

import type { OfferOptions, Overlay } from "./overlay";
import { offerPageTranslation } from "./page-offer";
import type { PageTranslator } from "./page-translator";

const deps = vi.hoisted(() => ({ detectPageLanguage: vi.fn(), callBackground: vi.fn() }));
vi.mock("@/infra/dom/page-language", () => ({ detectPageLanguage: deps.detectPageLanguage }));
vi.mock("@/infra/messaging/background-client", () => ({ callBackground: deps.callBackground }));
let state: { signedIn: boolean; translating: boolean; offerDismissed: boolean; rules: SiteRules };
beforeEach(() => {
	state = {
		signedIn: true,
		translating: false,
		offerDismissed: false,
		rules: { ...EMPTY_SITE_RULES },
	};
	vi.stubGlobal("location", { hostname: "example.com", href: "https://example.com/page" });
	deps.detectPageLanguage.mockResolvedValue("en-US");
	deps.callBackground.mockReset();
	deps.callBackground.mockImplementation((method: string) =>
		Promise.resolve(method === "offer:getState" ? state : undefined),
	);
});
function setup() {
	const page = { isActive: false, activityVersion: 0, start: vi.fn() };
	const overlay = {
		showOffer: vi.fn<(offer: OfferOptions) => void>(),
		hideOffer: vi.fn(),
		toast: vi.fn(),
	};
	const run = () =>
		offerPageTranslation({
			page: page as unknown as PageTranslator,
			overlay: overlay as unknown as Overlay,
			getSettings: () => withDefaults({}),
		});
	const offer = () => overlay.showOffer.mock.calls[0]![0];
	return { page, overlay, run, offer };
}
it("異なる言語では提案し、同意前に翻訳を始めない", async () => {
	const ctx = setup();
	await ctx.run();
	expect(ctx.offer().message).toBe("このページは英語です。翻訳しますか？");
	expect(ctx.page.start).not.toHaveBeenCalled();
	ctx.offer().actions[0]!.onClick();
	expect(ctx.page.start).toHaveBeenCalledOnce();
	expect(ctx.overlay.toast).toHaveBeenCalledWith("ページの翻訳を開始しました");
});
it("ページ内から自動翻訳を許可せず設定画面へ誘導する", async () => {
	const ctx = setup();
	await ctx.run();
	ctx.offer().actions[1]!.onClick();
	expect(deps.callBackground).toHaveBeenLastCalledWith("open:options");
	expect(ctx.page.start).not.toHaveBeenCalled();
	expect(deps.callBackground).not.toHaveBeenCalledWith("siteRules:change", expect.anything());
});
it("提案の除外は現在サイト用 API へ委ねる", async () => {
	const ctx = setup();
	await ctx.run();
	ctx.offer().menu[0]!.onClick();
	expect(deps.callBackground).toHaveBeenLastCalledWith("offer:exclude", { type: "site" });
	ctx.offer().menu[1]!.onClick();
	expect(deps.callBackground).toHaveBeenLastCalledWith("offer:exclude", {
		type: "language",
		language: "en",
	});
	ctx.offer().onDismiss();
	expect(deps.callBackground).toHaveBeenLastCalledWith("offer:dismiss");
});
it.each(["signedOut", "dismissed", "sameLanguage", "active"])(
	"%s では提案・自動翻訳を行わない",
	async (reason) => {
		const ctx = setup();
		if (reason === "signedOut") state.signedIn = false;
		if (reason === "dismissed") state.offerDismissed = true;
		if (reason === "sameLanguage") deps.detectPageLanguage.mockResolvedValue("ja");
		if (reason === "active") ctx.page.isActive = true;
		await ctx.run();
		expect(ctx.overlay.showOffer).not.toHaveBeenCalled();
		expect(ctx.page.start).not.toHaveBeenCalled();
	},
);
it.each(["always", "continuing"])("%s の場合は提案せず開始を通知する", async (reason) => {
	if (reason === "always") state.rules.alwaysTranslate = ["example.com"];
	else state.translating = true;
	state.offerDismissed = true;
	const ctx = setup();
	await ctx.run();
	expect(ctx.page.start).toHaveBeenCalledOnce();
	expect(ctx.overlay.showOffer).not.toHaveBeenCalled();
	expect(ctx.overlay.toast).toHaveBeenCalledWith("ページの翻訳を開始しました");
});
it("状態取得中に停止操作があれば自動再開しない", async () => {
	state.translating = true;
	const ctx = setup();
	const pending = ctx.run();
	ctx.page.activityVersion++;
	await pending;
	expect(ctx.page.start).not.toHaveBeenCalled();
});
it("状態を取得できなければ自動翻訳しない", async () => {
	deps.callBackground.mockRejectedValue(new Error("拒否"));
	const ctx = setup();
	await ctx.run();
	expect(ctx.page.start).not.toHaveBeenCalled();
	expect(ctx.overlay.showOffer).not.toHaveBeenCalled();
});
