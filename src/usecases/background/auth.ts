import { browser } from "#imports";
import { TranslateFailure } from "@/domain/failure";
import {
	buildAuthorizeUrl,
	createPkce,
	hasRequiredScope,
	isRedirectUrl,
	parseAuthorizationCallback,
	randomToken,
	REDIRECT_URI,
	RESOURCE,
	TokenEndpointError,
} from "@/domain/oauth";
import type { TokenResponse } from "@/domain/oauth";
import type { SignOutResult } from "@/domain/sign-out";
import type { AuthState } from "@/infra/messaging/protocol";
import { verifyIdToken } from "@/infra/oauth/id-token";
import { postToken, revokeRefreshToken } from "@/infra/oauth/token-endpoint";
import { clientIdItem, credentialsItem, hostIdItem, signInItem } from "@/infra/storage/auth";
import type { Credentials, PendingSignIn } from "@/infra/storage/auth";
import { protectAuthStorage } from "@/infra/storage/auth-access";

import { clearCache, pauseTranslations } from "./cache";

const REFRESH_MARGIN_MS = 60 * 1000;

export async function getAuthState(): Promise<AuthState> {
	await protectAuthStorage();
	const creds = await credentialsItem.getValue();
	return { signedIn: creds != null, email: creds?.email ?? null };
}

export async function startSignIn(): Promise<void> {
	await protectAuthStorage();
	const current = await signInItem.getValue();
	if (current?.status === "pending") {
		const exists = await browser.tabs.get(current.tabId).then(
			() => true,
			() => false,
		);
		if (exists) {
			await browser.tabs.update(current.tabId, { active: true });
			return;
		}
	}

	const { verifier, challenge } = await createPkce();
	const state = randomToken(16);
	const nonce = randomToken(16);
	const [clientId, hostId, previous] = await Promise.all([
		clientIdItem.getValue(),
		getHostId(),
		credentialsItem.getValue(),
	]);

	const tab = await browser.tabs.create({
		url: buildAuthorizeUrl({
			clientId,
			hostId,
			state,
			nonce,
			codeChallenge: challenge,
			idTokenHint: previous?.idToken ?? null,
		}),
	});
	if (tab.id == null) throw new Error("認可タブを開けませんでした");
	await signInItem.setValue({
		status: "pending",
		tabId: tab.id,
		verifier,
		state,
		nonce,
		clientId,
	});
}

export async function handleTabUpdated(tabId: number, url: string | undefined): Promise<boolean> {
	if (url == null || !isRedirectUrl(url)) return false;
	await protectAuthStorage();
	const pending = await signInItem.getValue();
	if (pending?.status !== "pending" || pending.tabId !== tabId) return false;
	await browser.tabs.remove(tabId);
	try {
		await completeSignIn(pending, new URL(url));
		await signInItem.setValue(null);
		return true;
	} catch (e) {
		await signInItem.setValue({
			status: "failed",
			message: e instanceof Error ? e.message : String(e),
		});
		return false;
	}
}

export async function handleTabRemoved(tabId: number): Promise<void> {
	await protectAuthStorage();
	const pending = await signInItem.getValue();
	if (pending?.status === "pending" && pending.tabId === tabId) await signInItem.setValue(null);
}

async function completeSignIn(pending: PendingSignIn, callback: URL): Promise<void> {
	const { code, clientId } = parseAuthorizationCallback(callback, pending);
	await clientIdItem.setValue(clientId);

	const tokens = await postToken({
		grant_type: "authorization_code",
		client_id: clientId,
		code,
		code_verifier: pending.verifier,
		redirect_uri: REDIRECT_URI,
		resource: RESOURCE,
	});
	if (!hasRequiredScope(tokens.scope)) {
		throw new Error(
			"このアカウントでは ChatGPT サブスクリプションを利用できません（Plus / Pro が必要です）",
		);
	}
	if (tokens.idToken == null) throw new Error("ID トークンが発行されませんでした");
	const claims = await verifyIdToken(tokens.idToken, clientId, pending.nonce);
	const previous = await credentialsItem.getValue();
	if (previous?.subject != null && previous.subject !== claims.sub)
		throw new Error("サインインしたアカウントが一致しません。先にサインアウトしてください。");

	await clearCache();
	credentialsGeneration++;
	await credentialsItem.setValue({
		clientId,
		subject: claims.sub,
		email: claims.email,
		idToken: tokens.idToken,
		accessToken: tokens.accessToken,
		refreshToken: tokens.refreshToken,
		expiresAt: Date.now() + tokens.expiresIn * 1000,
	});
}

/** 進んでいたら refresh の結果を書き戻さない */
let credentialsGeneration = 0;
let refreshPromise: Promise<Credentials> | null = null;

export async function getAccessToken(forceRefresh = false): Promise<string> {
	await protectAuthStorage();
	const creds = await credentialsItem.getValue();
	if (!creds)
		throw new TranslateFailure("signed_out", "翻訳するには ChatGPT でサインインしてください。");
	if (!forceRefresh && creds.expiresAt - REFRESH_MARGIN_MS > Date.now()) {
		return creds.accessToken;
	}
	// refresh token はローテーションされ、使用済みを再送すると refresh_token_reused で失効するため直列化する
	refreshPromise ??= refresh(creds).finally(() => {
		refreshPromise = null;
	});
	return (await refreshPromise).accessToken;
}

async function refresh(creds: Credentials): Promise<Credentials> {
	const generation = credentialsGeneration;
	let tokens: TokenResponse;
	try {
		tokens = await postToken({
			grant_type: "refresh_token",
			client_id: creds.clientId,
			refresh_token: creds.refreshToken,
			resource: RESOURCE,
		});
	} catch (e) {
		if (e instanceof TokenEndpointError && e.requiresReauth) {
			if (generation === credentialsGeneration) await credentialsItem.setValue(null);
			throw new TranslateFailure(
				"signed_out",
				"セッションの有効期限が切れました。再度サインインしてください",
			);
		}
		throw e;
	}
	const claims =
		tokens.idToken == null ? null : await verifyIdToken(tokens.idToken, creds.clientId);
	if (claims != null && creds.subject != null && claims.sub !== creds.subject)
		throw new TranslateFailure(
			"signed_out",
			"更新されたアカウント情報が一致しません。再度サインインしてください。",
		);
	if (generation !== credentialsGeneration) {
		throw new TranslateFailure("signed_out", "サインイン状態が変わったため処理を中断しました");
	}
	const next: Credentials = {
		...creds,
		...(claims == null ? {} : { subject: claims.sub, email: claims.email }),
		accessToken: tokens.accessToken,
		refreshToken: tokens.refreshToken,
		// refresh 応答の id_token は省略されうる
		idToken: tokens.idToken ?? creds.idToken,
		expiresAt: Date.now() + tokens.expiresIn * 1000,
	};
	await credentialsItem.setValue(next);
	return next;
}

export async function signOut(): Promise<SignOutResult> {
	const resume = pauseTranslations();
	try {
		await protectAuthStorage();
		credentialsGeneration++;
		const cacheCleared = await clearCache().then(
			() => true,
			() => false,
		);
		// 進行中の refresh が新しい refresh token を受け取っていれば、そちらを revoke する
		await refreshPromise?.catch(() => {});
		const creds = await credentialsItem.getValue();
		await credentialsItem.setValue(null);
		if (!creds) return { localCleared: true, cacheCleared, remote: "not_needed" };
		try {
			await revokeRefreshToken(creds.refreshToken, creds.clientId);
			return { localCleared: true, cacheCleared, remote: "revoked" };
		} catch {
			return { localCleared: true, cacheCleared, remote: "failed" };
		}
	} finally {
		resume();
	}
}

async function getHostId(): Promise<string> {
	const existing = await hostIdItem.getValue();
	if (existing != null) return existing;
	const id = `urn:uuid:${crypto.randomUUID()}`;
	await hostIdItem.setValue(id);
	return id;
}
