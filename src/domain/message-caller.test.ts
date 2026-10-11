import { expect, it } from "vitest";

import { parseMessageCaller } from "./message-caller";

const id = "test-extension";
const root = `chrome-extension://${id}/`;
const sender = {
	id,
	url: "https://example.com/page",
	origin: "https://example.com",
	tab: { id: 4, incognito: true },
	frameId: 0,
	documentId: "document-1",
	documentLifecycle: "active",
};

it("ブラウザーの送信元情報からサイトと文書を導出する", () => {
	expect(parseMessageCaller(sender, id, root)).toEqual({
		kind: "content",
		url: sender.url,
		origin: sender.origin,
		tabId: 4,
		documentId: "document-1",
		incognito: true,
	});
});

it.each([
	{ id: "other" },
	{ frameId: 1 },
	{ documentId: "" },
	{ documentId: undefined },
	{ documentLifecycle: "prerender" },
	{ origin: "null" },
	{ origin: "https://other.example" },
	{ tab: undefined },
	{ tab: { id: -1 } },
	{ url: "https://user:password@example.com/page" },
	{ url: "about:blank" },
])("不正な文書情報 %o を拒否する", (patch) => {
	expect(() => parseMessageCaller({ ...sender, ...patch }, id, root)).toThrow(
		"この画面からの操作は許可されていません。",
	);
});

it.each(["popup", "options"])("%s 画面を許可する", (page) => {
	expect(
		parseMessageCaller({ id, url: `${root}${page}.html`, origin: root.slice(0, -1) }, id, root),
	).toEqual({ kind: "extension", page });
});

it.each(["other.html", "options.html/extra", "popup.html.other"])(
	"未許可の拡張パス %s を拒否する",
	(path) => {
		expect(() => parseMessageCaller({ id, url: root + path }, id, root)).toThrow(
			"この画面からの操作は許可されていません。",
		);
	},
);
