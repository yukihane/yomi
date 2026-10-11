import { parseTokenResponse } from "@/domain/oauth";
import type { TokenResponse } from "@/domain/oauth";

const TOKEN_URL = "https://auth.openai.com/api/accounts/oauth/token";
const REVOKE_URL = "https://auth.openai.com/api/accounts/oauth/revoke";

export async function postToken(body: Record<string, string>): Promise<TokenResponse> {
	const res = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams(body),
	});
	return parseTokenResponse(res.status, res.ok, await res.json());
}

export async function revokeRefreshToken(refreshToken: string, clientId: string): Promise<void> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 10_000);
	try {
		const res = await fetch(REVOKE_URL, {
			method: "POST",
			signal: controller.signal,
			redirect: "error",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				token: refreshToken,
				token_type_hint: "refresh_token",
				client_id: clientId,
			}),
		});
		if (!res.ok) throw new Error("失効要求が拒否されました");
	} catch {
		throw new Error("トークンの失効を確認できませんでした。");
	} finally {
		clearTimeout(timeout);
	}
}
