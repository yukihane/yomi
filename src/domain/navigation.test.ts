import { describe, expect, it } from "vitest";

import { continuesTranslation } from "./navigation";

describe("continuesTranslation", () => {
	it("別オリジンへのリンクでは翻訳を引き継がない", () => {
		expect(
			continuesTranslation(
				{ transitionType: "link", transitionQualifiers: [] },
				"https://example.com",
				"https://other.example",
			),
		).toBe(false);
	});
	it("スキームやポートが異なる遷移では翻訳を引き継がない", () => {
		for (const origin of ["http://example.com", "https://example.com:8443"]) {
			expect(
				continuesTranslation(
					{ transitionType: "link", transitionQualifiers: [] },
					"https://example.com",
					origin,
				),
			).toBe(false);
		}
	});
	it.each(["link", "form_submit"])("ページ内の操作による遷移（%s）は翻訳を続ける", (type) => {
		expect(
			continuesTranslation(
				{ transitionType: type, transitionQualifiers: [] },
				"https://example.com",
				"https://example.com",
			),
		).toBe(true);
	});

	it.each(["typed", "generated", "keyword", "auto_bookmark", "reload"])(
		"アドレスバーやブックマーク、リロードによる遷移（%s）は翻訳を続けない",
		(type) => {
			expect(
				continuesTranslation(
					{ transitionType: type, transitionQualifiers: [] },
					"https://example.com",
					"https://example.com",
				),
			).toBe(false);
		},
	);

	it("アドレスバーから開いたページは、リンクとして報告されても翻訳を続けない", () => {
		expect(
			continuesTranslation(
				{ transitionType: "link", transitionQualifiers: ["from_address_bar"] },
				"https://example.com",
				"https://example.com",
			),
		).toBe(false);
	});

	it("戻る・進むは元の遷移の種類によらず翻訳を続ける", () => {
		expect(
			continuesTranslation(
				{ transitionType: "typed", transitionQualifiers: ["forward_back"] },
				"https://example.com",
				"https://example.com",
			),
		).toBe(true);
	});
});
