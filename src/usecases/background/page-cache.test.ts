import { beforeEach, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import type { MessageCaller } from "@/domain/message-caller";
import type { TranslateRequest, TranslationOutput } from "@/domain/translation-request";
import { streamResponse } from "@/infra/openai/client";
import { updateSettings } from "@/infra/storage/settings";
import { lookupTranslations, storeTranslations } from "@/infra/storage/translation-cache";

import { getAccessToken } from "./auth";
import { translate } from "./translate";

vi.mock("@/infra/openai/client", () => ({ listModels: vi.fn(), streamResponse: vi.fn() }));
vi.mock("@/infra/storage/translation-cache", () => ({
	lookupTranslations: vi.fn(),
	storeTranslations: vi.fn(),
}));
vi.mock("./auth", () => ({ getAccessToken: vi.fn() }));
vi.mock("@/infra/browser/current-document", () => ({
	currentDocument: vi.fn(async (source: Extract<MessageCaller, { kind: "content" }>) => source),
}));

const req: TranslateRequest = {
	kind: "page",
	targetLang: "ja",
	segments: ["Hello"],
	context: { title: "Title", description: "Description" },
};
const caller: MessageCaller = {
	kind: "content",
	url: "https://a.example/page",
	origin: "https://a.example",
	tabId: 1,
	documentId: "document-1",
	incognito: false,
};
const cache = new Map<string, string>();

beforeEach(async () => {
	fakeBrowser.reset();
	vi.clearAllMocks();
	cache.clear();
	await updateSettings({ model: "model" });
	vi.mocked(getAccessToken).mockResolvedValue("token");
	vi.mocked(lookupTranslations).mockImplementation(async (keys) =>
		keys.map((key) => cache.get(key) ?? null),
	);
	vi.mocked(storeTranslations).mockImplementation(async (entries) => {
		for (const entry of entries) cache.set(entry.key, entry.translation);
	});
	vi.mocked(streamResponse).mockImplementation(async ({ onDelta }) => {
		onDelta('<seg id="1">訳文</seg>');
	});
});

async function run(source = caller, request = req, signal = new AbortController().signal) {
	const events: TranslationOutput[] = [];
	await translate(request, signal, (event) => events.push(event), source);
	return events;
}

it("backgroundで取得した訳文だけを保存し、同じ条件ではAPIを呼ばない", async () => {
	expect(await run()).toEqual([{ type: "segment", index: 0, markup: "訳文" }]);
	expect(await run()).toEqual([{ type: "segment", index: 0, markup: "訳文" }]);
	expect(streamResponse).toHaveBeenCalledTimes(1);
	expect(cache.size).toBe(1);
});

it("同じ原文でもブラウザー由来のoriginが異なればキャッシュを共有しない", async () => {
	await run();
	await run({ ...caller, origin: "https://b.example", url: "https://b.example/page" });
	expect(streamResponse).toHaveBeenCalledTimes(2);
	expect(cache.size).toBe(2);
});

it("モデルや文脈の変更で古い訳文を返さない", async () => {
	await run();
	await updateSettings({ model: "other-model" });
	await run();
	await run(caller, { ...req, context: { title: "Other", description: "" } });
	expect(streamResponse).toHaveBeenCalledTimes(3);
});

it.each([
	'<seg id="1">一</seg><seg id="1">二</seg>',
	'<seg id="2">他</seg>',
	'<seg id="1">未完了',
	'<seg id="1">訳</seg>余計な出力',
])("不正な出力 %s を保存も返却もしない", async (output) => {
	vi.mocked(streamResponse).mockImplementation(async ({ onDelta }) => {
		onDelta(output);
	});
	const events = vi.fn();
	await expect(translate(req, new AbortController().signal, events, caller)).rejects.toThrow(
		"翻訳結果のセグメント",
	);
	expect(storeTranslations).not.toHaveBeenCalled();
	expect(events).not.toHaveBeenCalled();
});

it("切断後の遅延応答を保存しない", async () => {
	const controller = new AbortController();
	vi.mocked(streamResponse).mockImplementation(async ({ onDelta }) => {
		controller.abort();
		onDelta('<seg id="1">遅延</seg>');
	});
	await expect(run(caller, req, controller.signal)).rejects.toThrow("abort");
	expect(storeTranslations).not.toHaveBeenCalled();
});

it("選択翻訳とシークレット文書は永続キャッシュを参照・保存しない", async () => {
	await run({ ...caller, incognito: true });
	await run(caller, { kind: "selection", targetLang: "ja", text: "Hello" });
	expect(lookupTranslations).not.toHaveBeenCalled();
	expect(storeTranslations).not.toHaveBeenCalled();
});

vi.mock("./cache", () => ({
	cacheSession: vi.fn(async (signal: AbortSignal, incognito: boolean) => ({
		signal,
		epoch: incognito ? null : "epoch",
	})),
}));
