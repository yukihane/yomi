import { createResource, createSignal, Show } from "solid-js";

import { callBackground } from "@/infra/messaging/background-client";

export function CacheSection() {
	const [state, { refetch }] = createResource(() =>
		callBackground("cache:status").catch(() => null),
	);
	const [busy, setBusy] = createSignal(false);
	const [error, setError] = createSignal("");
	async function change(action: "cache:enable" | "cache:disable" | "cache:clear") {
		setBusy(true);
		setError("");
		try {
			await callBackground(action);
			await refetch();
		} catch {
			setError("キャッシュを変更できませんでした。消去を再試行してください。");
			await refetch();
		} finally {
			setBusy(false);
		}
	}
	return (
		<section class="section">
			<h2>キャッシュ</h2>
			<label class="row">
				<input
					type="checkbox"
					checked={state()?.enabled ?? false}
					disabled={busy() || !state()}
					onChange={(e) => void change(e.currentTarget.checked ? "cache:enable" : "cache:disable")}
				/>
				訳文を端末に保存する（既定は無効）
			</label>
			<p class="muted small">
				保存期間は7日間です。無効化・サインアウト・アカウント変更時に消去します。シークレットモードでは保存しません。消去すると進行中の翻訳も停止します。
			</p>
			<div class="row">
				<div class="grow">保存済みの訳文 {state()?.count.toLocaleString() ?? "-"} 件</div>
				<button class="btn" disabled={busy()} onClick={() => void change("cache:clear")}>
					キャッシュを消去
				</button>
			</div>
			<Show when={error() || (!state.loading && !state())}>
				<p class="error-text">
					{error() || "キャッシュを利用できません。消去を再試行してください。"}
				</p>
			</Show>
		</section>
	);
}
