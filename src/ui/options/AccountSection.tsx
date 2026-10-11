import { createSignal, Show } from "solid-js";

import { callBackground } from "@/infra/messaging/background-client";
import type { AuthState } from "@/infra/messaging/protocol";
import { signInItem } from "@/infra/storage/auth";
import { PlanStatus } from "@/ui/components/PlanStatus";
import { SignInCard } from "@/ui/components/SignInCard";
import { createStorageItem } from "@/ui/hooks/storage-item";

export function AccountSection(props: { auth: AuthState }) {
	const [signingOut, setSigningOut] = createSignal(false);
	const [signOutMessage, setSignOutMessage] = createSignal("");
	async function signOut() {
		if (signingOut()) return;
		setSigningOut(true);
		setSignOutMessage("端末内の資格情報を削除し、トークンの失効を確認しています。");
		try {
			const result = await callBackground("auth:signOut");
			setSignOutMessage(
				result.remote === "failed"
					? "端末内の資格情報は削除しましたが、トークンの失効を確認できませんでした。ChatGPT の設定からこのアプリのアクセスを取り消してください。"
					: "端末内の資格情報を削除しました。" +
							(result.remote === "revoked" ? "トークンの失効要求は受理されました。" : ""),
			);
		} catch {
			setSignOutMessage(
				"サインアウト処理の完了を確認できませんでした。設定画面を開き直して状態を確認してください。",
			);
		} finally {
			setSigningOut(false);
		}
	}
	return (
		<section class="section">
			<h2>アカウント</h2>
			<Show when={props.auth.signedIn} fallback={<SignInPanel />}>
				<div class="row">
					<div class="grow">
						<PlanStatus />
						<div class="muted small">{props.auth.email ?? "ChatGPT アカウント"}</div>
					</div>
					<button class="btn" disabled={signingOut()} onClick={() => void signOut()}>
						サインアウト
					</button>
				</div>
			</Show>
			<Show when={signOutMessage()}>
				{(message) => (
					<p class="muted small" role="status">
						{message()}
					</p>
				)}
			</Show>
		</section>
	);
}

function SignInPanel() {
	const signIn = createStorageItem(signInItem);
	const failure = () => {
		const s = signIn();
		return s?.status === "failed" ? s.message : undefined;
	};
	return (
		<div class="stack">
			<SignInCard />
			<Show when={signIn()?.status === "pending"}>
				<p class="muted small">開いたタブで ChatGPT にサインインし、アクセスを許可してください。</p>
			</Show>
			<Show when={failure()}>{(message) => <p class="error-text">{message()}</p>}</Show>
			<p class="muted small">ChatGPT Plus / Pro プランが必要です。</p>
		</div>
	);
}
