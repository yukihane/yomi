import { afterEach, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import type { MessageCaller } from "@/domain/message-caller";

import { currentDocument } from "./current-document";

const navigation = fakeBrowser.webNavigation as unknown as {
	getFrame: (details: unknown) => Promise<unknown>;
};

const caller: Extract<MessageCaller, { kind: "content" }> = {
	kind: "content",
	url: "https://a.example/old",
	origin: "https://a.example",
	tabId: 1,
	documentId: "doc",
	incognito: false,
};
const frame = {
	documentId: "doc",
	documentLifecycle: "active",
	parentFrameId: -1,
	errorOccurred: false,
	url: "https://a.example/new",
};

afterEach(() => vi.restoreAllMocks());

it("同じ文書の現在のURLをブラウザーから取得する", async () => {
	const getFrame = vi.spyOn(navigation, "getFrame").mockResolvedValue(frame);
	await expect(currentDocument(caller)).resolves.toEqual({ ...caller, url: frame.url });
	expect(getFrame).toHaveBeenCalledWith({ tabId: 1, frameId: 0, documentId: "doc" });
});

it.each([
	null,
	{ ...frame, documentId: "different" },
	{ ...frame, documentLifecycle: "cached" },
	{ ...frame, parentFrameId: 1 },
	{ ...frame, url: "https://b.example/page" },
	{ ...frame, errorOccurred: true },
])("不明または別の文書 %o を拒否する", async (value) => {
	vi.spyOn(navigation, "getFrame").mockResolvedValue(value);
	await expect(currentDocument(caller)).rejects.toThrow("翻訳元の文書を確認できません");
});
