import { createSignal, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";

import type { SiteRules, SiteRuleChange } from "@/domain/site-rules";
import { callBackground } from "@/infra/messaging/background-client";
import { siteRulesItem } from "@/infra/storage/site-rules";

export function createSiteRules(): [
	Accessor<SiteRules | null>,
	(change: SiteRuleChange) => Promise<boolean>,
	Accessor<string>,
] {
	const [rules, setRules] = createSignal<SiteRules | null>(null);
	const [error, setError] = createSignal("");
	const failed = () =>
		setError("サイト設定を変更・取得できませんでした。設定画面を開き直してください。");
	void callBackground("siteRules:get").then(setRules).catch(failed);
	onCleanup(siteRulesItem.watch(setRules));
	const update = async (change: SiteRuleChange) => {
		try {
			setRules(await callBackground("siteRules:change", change));
			setError("");
			return true;
		} catch {
			failed();
			return false;
		}
	};
	return [rules, update, error];
}
