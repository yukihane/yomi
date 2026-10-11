import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { browser } from "#imports";
import { toTranslateFailure } from "@/domain/api-error";

import { serveBackgroundApi, serveTranslatePort } from "./background-server";
import type { BackgroundHandlers, TranslateHandler } from "./background-server";

beforeEach(() => fakeBrowser.reset());
afterEach(() => vi.restoreAllMocks());

function contentSender(): Browser.runtime.MessageSender {
	return {
		id: browser.runtime.id,
		url: "https://example.com/page",
		origin: "https://example.com",
		tab: { id: 1 } as Browser.tabs.Tab,
		frameId: 0,
		documentId: "document-1",
		documentLifecycle: "active",
	};
}

function handlers(): BackgroundHandlers {
	return {
		"auth:getState": vi
			.fn()
			.mockResolvedValue({ signedIn: true, email: "private@example.invalid" }),
		"auth:signIn": vi.fn().mockResolvedValue(undefined),
		"auth:signOut": vi.fn().mockResolvedValue(undefined),
		"models:list": vi.fn().mockResolvedValue([]),
		"open:options": vi.fn().mockResolvedValue(undefined),
		"open:usage": vi.fn().mockResolvedValue(undefined),
		"open:shortcuts": vi.fn().mockResolvedValue(undefined),
	};
}

async function request(sender: unknown, type: string, params?: unknown) {
	const api = handlers();
	const listener = vi.spyOn(fakeBrowser.runtime.onMessage, "addListener");
	serveBackgroundApi(api, (error) => toTranslateFailure(error).serialize());
	const response = vi.fn<(value: unknown) => void>();
	listener.mock.calls[0]![0]({ type, params }, sender as Browser.runtime.MessageSender, response);
	await vi.waitFor(() => expect(response).toHaveBeenCalledOnce());
	return { api, value: response.mock.calls[0]![0] };
}

it.each(["auth:getState", "auth:signIn", "auth:signOut", "models:list", "open:shortcuts"])(
	"content script の %s 呼び出しを拒否する",
	async (type) => {
		const { api, value } = await request(contentSender(), type);
		expect(value).toMatchObject({ ok: false });
		for (const handler of Object.values(api)) expect(handler).not.toHaveBeenCalled();
	},
);

it("正規の拡張設定画面は認証状態を取得できる", async () => {
	const { value } = await request(
		{ id: browser.runtime.id, url: browser.runtime.getURL("/options.html") },
		"auth:getState",
	);
	expect(value).toMatchObject({ ok: true, value: { signedIn: true } });
});

it.each([
	{},
	{ id: "other-extension", url: "https://example.com/page", origin: "https://example.com" },
	{
		url: "https://example.com/page",
		origin: "https://other.example",
		tab: { id: 1 },
		frameId: 0,
		documentId: "doc",
		documentLifecycle: "active",
	},
	{
		url: "file:///private.txt",
		origin: "null",
		tab: { id: 1 },
		frameId: 0,
		documentId: "doc",
		documentLifecycle: "active",
	},
])("不明または不整合な送信元 %o を拒否する", async (partial) => {
	const { value } = await request({ id: browser.runtime.id, ...partial }, "open:options");
	expect(value).toMatchObject({ ok: false });
});

it("content script から固定の設定画面を開ける", async () => {
	const { value } = await request(contentSender(), "open:options");
	expect(value).toMatchObject({ ok: true });
});

it.each([
	["cache:lookup", { keys: ["other-site-key"] }],
	["cache:store", { entries: [{ key: "other-site-key", translation: "poison" }] }],
])("旧%s APIから任意キーにアクセスできない", async (type, params) => {
	const { value } = await request(contentSender(), type, params);
	expect(value).toMatchObject({ ok: false });
});

it("拡張画面から翻訳ポートを使えない", () => {
	const translate = vi.fn<TranslateHandler>().mockResolvedValue(undefined);
	const connected = vi
		.spyOn(fakeBrowser.runtime.onConnect, "addListener")
		.mockImplementation(() => {});
	const message = vi.fn<(callback: (raw: unknown) => void) => void>();
	const disconnect = vi.fn();
	const port = {
		name: "translate",
		sender: { id: browser.runtime.id, url: browser.runtime.getURL("/options.html") },
		onMessage: { addListener: message },
		onDisconnect: { addListener: vi.fn() },
		postMessage: vi.fn(),
		disconnect,
	} as unknown as Browser.runtime.Port;
	serveTranslatePort(translate, (error) => toTranslateFailure(error).serialize());
	connected.mock.calls[0]![0](port);
	message.mock.calls[0]?.[0]({ instructions: "日本語に翻訳", input: "Hello" });
	expect(disconnect).toHaveBeenCalledOnce();
	expect(translate).not.toHaveBeenCalled();
});
