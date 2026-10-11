# セキュリティ調査の再現コード

以下をリポジトリー直下の `.output/security-probe.mjs` に保存し、報告書の手順で実行する。製品へ組み込むコードではなく、ダミーデータと CDP を使う単発の監査用モックである。

```javascript
import { mkdtemp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { chromium } from "playwright-core";

const extensionPath = resolve(".output/chrome-mv3");
const profile = await mkdtemp(resolve(".output/security-profile-"));
const context = await chromium.launchPersistentContext(profile, {
	executablePath: chromium.executablePath(),
	headless: true,
	args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
});
context.setDefaultTimeout(15000);
const result = { browser: context.browser()?.version() };
try {
	const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
	await sw.evaluate(async () => {
		globalThis.__requests = [];
		globalThis.fetch = async (url, init) => {
			const u = url instanceof Request ? url.url : String(url);
			if (u.endsWith("/v1/responses")) {
				const body = JSON.parse(init.body);
				globalThis.__requests.push(body);
				const output = body.input[0].content.replaceAll(
					/<seg id="(\d+)">([\s\S]*?)<\/seg>/gu,
					(_, id, text) => `<seg id="${id}">JA:${text}</seg>`,
				);
				const events = [
					{ type: "response.output_text.delta", delta: output },
					{ type: "response.completed", response: {} },
				];
				return new Response(
					events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(""),
					{ headers: { "content-type": "text/event-stream" } },
				);
			}
			if (u.endsWith("/v1/models")) return Response.json({ models: [] });
			if (u.endsWith("/oauth/revoke")) return new Response(null, { status: 200 });
			throw new Error(`監査で許可しない通信: ${u}`);
		};
		await chrome.storage.local.set({
			credentials: {
				clientId: "audit-dummy-client",
				email: "audit@example.invalid",
				idToken: "audit-dummy-id",
				accessToken: "audit-dummy-access",
				refreshToken: "audit-dummy-refresh",
				expiresAt: Date.now() + 3600000,
			},
		});
		await chrome.storage.sync.set({ settings: { model: "gpt-6-luna", targetLang: "ja" } });
	});
	const page = await context.newPage();
	const cdp = await context.newCDPSession(page);
	const worlds = [];
	let resolveWorld;
	const worldReady = new Promise((r) => {
		resolveWorld = r;
	});
	cdp.on("Runtime.executionContextCreated", ({ context: world }) => {
		worlds.push(world);
		if (world.name === "Yomi") resolveWorld(world);
	});
	await cdp.send("Runtime.enable");
	await page.route("https://audit.example/**", (route) =>
		route.fulfill({
			contentType: "text/html",
			body: `
    <title>AUDIT_TITLE</title><meta name="description" content="AUDIT_DESCRIPTION">
    <p id="visible">AUDIT_VISIBLE</p>
    <p style="visibility:hidden">AUDIT_VISIBILITY_HIDDEN</p>
    <p style="opacity:0">AUDIT_OPACITY_ZERO</p>
    <p>Public <span style="visibility:hidden">AUDIT_INLINE_HIDDEN</span></p>
    <p style="display:none">AUDIT_DISPLAY_NONE</p>
    <p hidden>AUDIT_HIDDEN_ATTRIBUTE</p>
    <input value="AUDIT_INPUT"><div contenteditable="true">AUDIT_EDITABLE</div>
    <div class="notranslate" id="excluded"><p>AUDIT_STATIC_EXCLUDED_CHILD</p></div>
    <p id="far" style="position:absolute;top:50000px">AUDIT_OFFSCREEN</p>
  `,
		}),
	);
	await page.goto("https://audit.example/page");
	let timeout;
	const world = await Promise.race([
		worldReady,
		new Promise((_, reject) => {
			timeout = setTimeout(
				() => reject(new Error("content script の実行環境が見つかりません")),
				15000,
			);
		}),
	]);
	clearTimeout(timeout);
	const inContent = async (expression) => {
		const read = await cdp.send("Runtime.evaluate", {
			contextId: world.id,
			expression,
			awaitPromise: true,
			returnByValue: true,
		});
		if (read.exceptionDetails) throw new Error(JSON.stringify(read.exceptionDetails));
		return read.result.value;
	};
	result.requestsBeforeAction = await sw.evaluate(() => globalThis.__requests.length);
	result.contentScriptCanReadRefreshToken = await inContent(
		'chrome.storage.local.get("credentials").then(x=>x.credentials?.refreshToken === "audit-dummy-refresh")',
	);
	const extensionId = new URL(sw.url()).host;
	const options = await context.newPage();
	await options.goto(`chrome-extension://${extensionId}/options.html`);
	const foreignKey = "ja\nhttps://other.example/private\nAUDIT_OTHER_SOURCE";
	await options.evaluate(
		(key) =>
			chrome.runtime.sendMessage({
				type: "cache:store",
				params: { entries: [{ key, translation: "AUDIT_OTHER_PRIVATE_TRANSLATION" }] },
			}),
		foreignKey,
	);
	result.crossOriginCacheLookup = await inContent(
		`chrome.runtime.sendMessage({type:'cache:lookup',params:{keys:[${JSON.stringify(foreignKey)}]}})`,
	);
	await page.bringToFront();
	await sw.evaluate(async () => {
		const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
		await chrome.tabs.sendMessage(tab.id, { type: "page:translate" });
	});
	await page.waitForFunction(() => document.querySelector("#far").textContent.startsWith("JA:"));
	result.initialRequests = await sw.evaluate(() => globalThis.__requests);
	await page.evaluate(() => {
		const p = document.createElement("p");
		p.id = "dynamic";
		p.textContent = "AUDIT_DYNAMIC_EXCLUDED_CHILD";
		document.querySelector("#excluded").append(p);
	});
	await page.waitForFunction(() =>
		document.querySelector("#dynamic").textContent.startsWith("JA:"),
	);
	result.afterMutationRequests = await sw.evaluate(() => globalThis.__requests);
	const readCache = () =>
		options.evaluate(async () => {
			const db = await new Promise((resolve, reject) => {
				const r = indexedDB.open("translation-cache");
				r.onsuccess = () => resolve(r.result);
				r.onerror = () => reject(r.error);
			});
			try {
				return await new Promise((resolve, reject) => {
					const r = db.transaction("entries").objectStore("entries").getAll();
					r.onsuccess = () => resolve(r.result);
					r.onerror = () => reject(r.error);
				});
			} finally {
				db.close();
			}
		});
	result.cacheBeforeSignOut = await readCache();
	result.signOut = await options.evaluate(() =>
		chrome.runtime.sendMessage({ type: "auth:signOut" }),
	);
	result.credentialsAfterSignOut = await sw.evaluate(
		async () => (await chrome.storage.local.get("credentials")).credentials ?? null,
	);
	result.cacheAfterSignOut = await readCache();
	await writeFile(".output/security-probe-result.json", JSON.stringify(result, null, 2));
	console.log(
		JSON.stringify(
			{
				browser: result.browser,
				requestsBeforeAction: result.requestsBeforeAction,
				contentScriptCanReadRefreshToken: result.contentScriptCanReadRefreshToken,
				crossOriginCacheLookup: result.crossOriginCacheLookup,
				initialInputs: result.initialRequests.map((r) => r.input),
				mutationInputs: result.afterMutationRequests.map((r) => r.input),
				cacheBefore: result.cacheBeforeSignOut.length,
				cacheAfter: result.cacheAfterSignOut.length,
				credentialsAfterSignOut: result.credentialsAfterSignOut,
			},
			null,
			2,
		),
	);
} finally {
	await context.close();
}

```

