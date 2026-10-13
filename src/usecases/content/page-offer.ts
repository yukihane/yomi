import type { Settings } from "@/domain/settings";
import { decidePageOffer, languageLabel, pageLanguageKey } from "@/domain/site-rules";
import { detectPageLanguage } from "@/infra/dom/page-language";
import { callBackground } from "@/infra/messaging/background-client";

import type { Overlay } from "./overlay";
import type { PageTranslator } from "./page-translator";
import { startPageTranslation } from "./start-page";

export async function offerPageTranslation(deps: {
	overlay: Overlay;
	page: PageTranslator;
	getSettings: () => Settings;
}): Promise<void> {
	const { overlay, page } = deps;
	const host = location.hostname;
	if (host === "") return;
	const url = location.href;
	const revision = page.activityVersion;
	const state = await Promise.all([callBackground("offer:getState"), detectPageLanguage()]).catch(
		() => null,
	);
	if (
		state == null ||
		!state[0].signedIn ||
		page.isActive ||
		page.activityVersion !== revision ||
		location.href !== url
	)
		return;
	const [context, detected] = state;
	const settings = deps.getSettings();
	const pageLang = detected == null ? null : pageLanguageKey(detected);
	const decision = decidePageOffer({
		rules: context.rules,
		host,
		pageLang,
		targetLang: settings.targetLang,
		offerEnabled: settings.offerTranslation,
		continuing: context.translating,
	});
	const start = () => {
		if (location.href === url && page.activityVersion === revision)
			startPageTranslation(overlay, page);
	};
	if (decision === "translate") {
		start();
		return;
	}
	if (decision === "none" || pageLang == null || context.offerDismissed) return;
	const label = languageLabel(pageLang);
	const failed = () =>
		overlay.toast("設定を変更できませんでした。もう一度お試しください。", { error: true });
	overlay.showOffer({
		message: `このページは${label}です。翻訳しますか？`,
		actions: [
			{ label: "翻訳する", onClick: start },
			{ label: "自動翻訳を設定", onClick: () => void callBackground("open:options").catch(failed) },
		],
		menu: [
			{
				label: "このサイトでは表示しない",
				onClick: () => void callBackground("offer:exclude", { type: "site" }).catch(failed),
			},
			{
				label: `${label}のページでは表示しない`,
				onClick: () =>
					void callBackground("offer:exclude", { type: "language", language: pageLang }).catch(
						failed,
					),
			},
		],
		onDismiss: () => void callBackground("offer:dismiss").catch(() => {}),
	});
}

export function rememberPageTranslating(translating: boolean): void {
	void callBackground("tab:setTranslating", { translating }).catch(() => {});
}
