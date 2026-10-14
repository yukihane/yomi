import type { Browser } from "wxt/browser";

declare const browser: typeof Browser;

// テスト用コピーだけに注入し、ページ側コンテキストの権限で検証する。
export function installSecurityProbe() {
	browser.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse) => {
		if (typeof raw !== "object" || raw == null || !("type" in raw) || raw.type !== "e2e:probe")
			return undefined;
		void (async () => {
			const local = await browser.storage.local.get("credentials");
			const sessionReadable = await Promise.resolve()
				.then(() => browser.storage.session.get("signIn"))
				.then(
					() => true,
					() => false,
				);
			const auth: unknown = await browser.runtime.sendMessage({ type: "auth:getState" });
			const databases = await indexedDB.databases();
			await browser.storage.local.set({ credentials: { accessToken: "injected-test-token" } });
			const limit = await new Promise<unknown>((resolve) => {
				const port = browser.runtime.connect({ name: "translate" });
				port.onMessage.addListener((event: unknown) => {
					resolve(event);
					port.disconnect();
				});
				port.onDisconnect.addListener(() => resolve(null));
				port.postMessage({ kind: "selection", targetLang: "ja", text: "x".repeat(8001) });
			});
			return {
				localHasCredentials: local["credentials"] != null,
				sessionReadable,
				auth,
				hasPrivateDatabase: databases.some((db) => db.name === "private-local"),
				limit,
			};
		})().then(sendResponse, (error: unknown) => sendResponse({ error: String(error) }));
		return true;
	});
}
