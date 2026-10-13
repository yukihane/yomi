import { createSignal, For, Show } from "solid-js";

import { languageLabel } from "@/domain/site-rules";
import type { SiteRuleList } from "@/domain/site-rules";
import { createSiteRules } from "@/ui/hooks/site-rules";

const GROUPS: { list: SiteRuleList; title: string; label: (value: string) => string }[] = [
	{ list: "alwaysTranslate", title: "常に翻訳するサイト", label: (host) => host },
	{ list: "neverOffer", title: "翻訳を提案しないサイト", label: (host) => host },
	{ list: "neverOfferLangs", title: "翻訳を提案しない言語", label: languageLabel },
];

export function SiteRulesSection() {
	const [rules, update, error] = createSiteRules();
	const [host, setHost] = createSignal("");
	return (
		<section class="section">
			<h2>サイト</h2>
			<form
				class="row site-rule-form"
				onSubmit={(event) => {
					event.preventDefault();
					void update({ type: "always", host: host().trim().toLowerCase(), enabled: true }).then(
						(saved) => {
							if (saved) setHost("");
						},
					);
				}}
			>
				<label class="field grow">
					<span>常に翻訳するサイト名</span>
					<input
						type="text"
						value={host()}
						placeholder="example.com"
						onInput={(event) => setHost(event.currentTarget.value)}
					/>
				</label>
				<button class="btn" type="submit" disabled={host().trim() === ""}>
					追加
				</button>
			</form>
			<p class="muted small">
				サイト設定はこの端末内に保存します。「提案しない」は翻訳の送信を禁止する設定ではありません。
			</p>
			<Show when={error()}>
				{(message) => (
					<p class="error-text" role="alert">
						{message()}
					</p>
				)}
			</Show>
			<Show when={rules()}>
				{(current) => (
					<div class="stack">
						<For each={GROUPS}>
							{(group) => (
								<div class="rule-group">
									<h3>{group.title}</h3>
									<Show
										when={current()[group.list].length > 0}
										fallback={<p class="muted small">なし</p>}
									>
										<ul class="rule-list">
											<For each={current()[group.list]}>
												{(value) => (
													<li class="row">
														<span class="grow">{group.label(value)}</span>
														<button
															class="btn link small"
															onClick={() =>
																void update({ type: "remove", list: group.list, value })
															}
														>
															削除
														</button>
													</li>
												)}
											</For>
										</ul>
									</Show>
								</div>
							)}
						</For>
					</div>
				)}
			</Show>
		</section>
	);
}
