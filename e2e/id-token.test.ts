import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { expect, test } from "vitest";
import type { Browser } from "wxt/browser";

import { launchExtension } from "./fixtures";

declare const chrome: typeof Browser;

test.each([true, false])("IDトークン署名の正当性 %s をブラウザー内で検証する", async (valid) => {
	const pair = await generateKeyPair("RS256");
	const jwk = await exportJWK(pair.publicKey);
	const signed = await new SignJWT({
		sub: "test-subject",
		nonce: "test-nonce",
		email: "verified@example.invalid",
	})
		.setProtectedHeader({ alg: "RS256", kid: "test-key" })
		.setIssuer("https://auth.openai.com")
		.setAudience("oaiapp_test")
		.setIssuedAt()
		.setExpirationTime("1h")
		.sign(pair.privateKey);
	const jwt = valid ? signed : `${signed.slice(0, signed.lastIndexOf(".") + 1)}invalid`;
	const ext = await launchExtension();
	try {
		await ext.context.route("http://127.0.0.1:1455/**", (route) =>
			route.fulfill({ body: "認可完了" }),
		);
		const worker = ext.context.serviceWorkers()[0]!;
		await worker.evaluate(
			async ({ key, token }) => {
				await chrome.storage.local.remove("credentials");
				const original = globalThis.fetch;
				globalThis.fetch = async (url, init) => {
					const target = url instanceof Request ? url.url : String(url);
					if (target === "https://auth.openai.com/.well-known/jwks.json")
						return new Response(JSON.stringify({ keys: [{ ...key, kid: "test-key" }] }));
					if (target.endsWith("/oauth/token"))
						return new Response(
							JSON.stringify({
								access_token: "test-access",
								refresh_token: "test-refresh",
								id_token: token,
								expires_in: 3600,
								scope: "openid email chatgpt.tokens.use.direct",
							}),
						);
					return await original(url, init);
				};
				const tab = await chrome.tabs.create({ url: "about:blank" });
				await chrome.storage.session.set({
					signIn: {
						status: "pending",
						tabId: tab.id,
						verifier: "test-verifier",
						state: "test-state",
						nonce: "test-nonce",
						clientId: "oaiapp_test",
					},
				});
				await chrome.tabs.update(tab.id, {
					url: "http://127.0.0.1:1455/callback?state=test-state&code=test-code",
				});
			},
			{ key: jwk, token: jwt },
		);
		const expected = valid
			? { credentials: { subject: "test-subject", email: "verified@example.invalid" } }
			: {
					signIn: {
						status: "failed",
						message: "ID トークンを検証できませんでした。再度サインインしてください。",
					},
				};
		await expect
			.poll(() =>
				worker.evaluate(async () => ({
					...(await chrome.storage.local.get("credentials")),
					...(await chrome.storage.session.get("signIn")),
				})),
			)
			.toMatchObject(expected);
		expect(
			await worker.evaluate(async () => {
				const values = await chrome.storage.local.get("credentials");
				return Object.hasOwn(values, "credentials");
			}),
		).toBe(valid);
	} finally {
		await ext.context.close();
	}
});
