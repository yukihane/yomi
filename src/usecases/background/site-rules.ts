import { TranslateFailure } from "@/domain/failure";
import type { MessageCaller } from "@/domain/message-caller";
import { withAlwaysTranslate, withoutRule, withRule } from "@/domain/site-rules";
import type { SiteRules, SiteRuleChange, OfferExclusion } from "@/domain/site-rules";
import { currentDocument } from "@/infra/browser/current-document";
import { protectAuthStorage } from "@/infra/storage/auth-access";
import { siteRulesItem } from "@/infra/storage/site-rules";

let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
	const run = queue.then(async () => {
		await protectAuthStorage();
		return await task();
	});
	queue = run.catch(() => {});
	return run;
}
export function getSiteRules() {
	return serialize(() => siteRulesItem.getValue());
}

export function changeSiteRule(change: SiteRuleChange, caller: MessageCaller) {
	if (caller.kind !== "extension")
		return Promise.reject(
			new TranslateFailure("other", "サイト設定は拡張機能の画面から変更してください。"),
		);
	return serialize(async () => {
		const rules = await siteRulesItem.getValue();
		const next =
			change.type === "always"
				? withAlwaysTranslate(rules, change.host, change.enabled)
				: withoutRule(rules, change.list, change.value);
		await siteRulesItem.setValue(next);
		return next;
	});
}

export function excludePageOffer(change: OfferExclusion, caller: MessageCaller) {
	return serialize(async () => {
		if (caller.kind !== "content")
			throw new TranslateFailure("other", "この画面から提案を変更できません。");
		const source = await currentDocument(caller);
		const rules = await siteRulesItem.getValue();
		const next =
			change.type === "site"
				? withRule(rules, "neverOffer", new URL(source.url).hostname)
				: withRule(rules, "neverOfferLangs", change.language);
		await siteRulesItem.setValue(next);
	});
}

export async function pageSiteRules(caller: MessageCaller): Promise<SiteRules> {
	if (caller.kind !== "content") throw new TranslateFailure("other", "ページを確認できません。");
	const source = await currentDocument(caller);
	const host = new URL(source.url).hostname;
	const rules = await getSiteRules();
	return {
		alwaysTranslate: rules.alwaysTranslate.filter((value) => value === host),
		neverOffer: rules.neverOffer.filter((value) => value === host),
		neverOfferLangs: rules.neverOfferLangs,
	};
}
