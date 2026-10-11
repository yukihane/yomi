import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { browser } from "#imports";
import { toTranslateFailure } from "@/domain/api-error";

import { serveBackgroundApi, serveTranslatePort } from "./background-server";
import type { BackgroundHandlers, TranslateHandler } from "./background-server";

beforeEach(() => {
	fakeBrowser.reset();
	vi.spyOn(fakeBrowser.runtime, "getPlatformInfo").mockResolvedValue();
	for (const event of [
		fakeBrowser.webNavigation.onCommitted,
		fakeBrowser.webNavigation.onHistoryStateUpdated,
	]) {
		vi.spyOn(event, "addListener").mockImplementation(() => {});
		vi.spyOn(event, "removeListener").mockImplementation(() => {});
	}
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

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

it("1接続の2件目の要求は切断し、最初の要求もキャンセルする", async () => {
	const translate = vi.fn<TranslateHandler>().mockResolvedValue(undefined);
	const connected = vi
		.spyOn(fakeBrowser.runtime.onConnect, "addListener")
		.mockImplementation(() => {});
	const message = vi.fn<(callback: (raw: unknown) => void) => void>();
	const disconnect = vi.fn();
	const port = {
		name: "translate",
		sender: contentSender(),
		onMessage: { addListener: message },
		onDisconnect: { addListener: vi.fn() },
		postMessage: vi.fn(),
		disconnect,
	} as unknown as Browser.runtime.Port;
	serveTranslatePort(translate, (error) => toTranslateFailure(error).serialize());
	connected.mock.calls[0]![0](port);
	const translationRequest = { kind: "selection", targetLang: "ja", text: "Hello" };
	message.mock.calls[0]![0](translationRequest);
	message.mock.calls[0]![0](translationRequest);
	await vi.waitFor(() => expect(translate).toHaveBeenCalledOnce());
	expect(disconnect).toHaveBeenCalledOnce();
	expect(translate.mock.calls[0]![1].aborted).toBe(true);
	expect(translate.mock.calls[0]![3]).toMatchObject({
		origin: "https://example.com",
		documentId: "document-1",
	});
});

it("未送信ポートも枠を占有し、切断と期限切れで枠とタイマーを解放する", async () => {
	vi.useFakeTimers();
	const translate = vi.fn<TranslateHandler>();
	const connected = vi
		.spyOn(fakeBrowser.runtime.onConnect, "addListener")
		.mockImplementation(() => {});
	serveTranslatePort(translate, (error) => toTranslateFailure(error).serialize());
	const connect = () => {
		const message = vi.fn<(callback: (raw: unknown) => void) => void>();
		const disconnectEvent = vi.fn<(callback: () => void) => void>();
		const disconnect = vi.fn();
		const postMessage = vi.fn();
		const port = {
			name: "translate",
			sender: contentSender(),
			onMessage: { addListener: message },
			onDisconnect: { addListener: disconnectEvent },
			disconnect,
			postMessage,
		} as unknown as Browser.runtime.Port;
		connected.mock.calls[0]![0](port);
		return { message, disconnectEvent, disconnect, postMessage };
	};
	const first = connect();
	connect();
	connect();
	connect();
	expect(connect().disconnect).toHaveBeenCalledOnce();
	first.disconnectEvent.mock.calls[0]![0]();
	expect(connect().disconnect).not.toHaveBeenCalled();
	await vi.advanceTimersByTimeAsync(15000);
	expect(vi.getTimerCount()).toBe(0);
	const last = connect();
	expect(last.disconnect).not.toHaveBeenCalled();
	last.disconnectEvent.mock.calls[0]![0]();
	expect(vi.getTimerCount()).toBe(0);
	expect(translate).not.toHaveBeenCalled();
});
it("応答が終わらない要求も120秒で中断し、枠を返す", async () => {
	vi.useFakeTimers();
	const pending = Promise.withResolvers<void>();
	const translate = vi.fn<TranslateHandler>().mockReturnValue(pending.promise);
	const connected = vi
		.spyOn(fakeBrowser.runtime.onConnect, "addListener")
		.mockImplementation(() => {});
	const message = vi.fn<(callback: (raw: unknown) => void) => void>();
	const disconnect = vi.fn();
	const postMessage = vi.fn();
	serveTranslatePort(translate, (error) => toTranslateFailure(error).serialize());
	connected.mock.calls[0]![0]({
		name: "translate",
		sender: contentSender(),
		onMessage: { addListener: message },
		onDisconnect: { addListener: vi.fn() },
		disconnect,
		postMessage,
	} as unknown as Browser.runtime.Port);
	message.mock.calls[0]![0]({ kind: "selection", targetLang: "ja", text: "Hello" });
	await vi.advanceTimersByTimeAsync(120000);
	expect(translate.mock.calls[0]![1].aborted).toBe(true);
	expect(disconnect).toHaveBeenCalledOnce();
	expect(vi.getTimerCount()).toBe(0);
	pending.resolve();
	await pending.promise;
	expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
});
