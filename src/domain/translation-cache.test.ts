import { describe, expect, it } from "vitest";

import type { LanguageCode } from "./languages";
import { cacheKey as buildCacheKey } from "./translation-cache";

const options = { model: "model", reasoningEffort: "low", fastMode: false, instructions: "prompt" };
const cacheKey = (lang: LanguageCode, url: string, markup: string) =>
	buildCacheKey(lang, url, markup, options);

describe("cacheKey", () => {
	it.each([
		{ model: "other" },
		{ reasoningEffort: "high" },
		{ fastMode: true },
		{ instructions: "other context" },
	])("翻訳条件 %o が変われば別のキーになる", (change) => {
		expect(buildCacheKey("ja", "https://a.example/doc", "x", { ...options, ...change })).not.toBe(
			cacheKey("ja", "https://a.example/doc", "x"),
		);
	});

	it("改行を含む文脈と原文の連結が衝突しない", () => {
		expect(buildCacheKey("ja", "https://a.example/doc", "x\ny", options)).not.toBe(
			buildCacheKey("ja", "https://a.example/doc", "y", { ...options, instructions: "prompt\nx" }),
		);
	});
	it("URL のクエリとハッシュは区別しない", () => {
		expect(cacheKey("ja", "https://a.example/doc?utm_source=x#intro", "x")).toBe(
			cacheKey("ja", "https://a.example/doc", "x"),
		);
	});

	it("オリジン・パス・翻訳先の言語・マークアップが違えば別のキーになる", () => {
		const base = cacheKey("ja", "https://a.example/doc", "x");
		expect(cacheKey("ja", "https://b.example/doc", "x")).not.toBe(base);
		expect(cacheKey("ja", "https://a.example/other", "x")).not.toBe(base);
		expect(cacheKey("en", "https://a.example/doc", "x")).not.toBe(base);
		expect(cacheKey("ja", "https://a.example/doc", "y")).not.toBe(base);
	});
});
