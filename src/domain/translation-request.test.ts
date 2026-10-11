import * as v from "valibot";
import { expect, it } from "vitest";

import { TranslateRequestSchema } from "./translation-request";

it("選択文は8000文字まで受け付け、超過は拒否する", () => {
	const req = { kind: "selection", targetLang: "ja", text: "a".repeat(8000) };
	expect(v.safeParse(TranslateRequestSchema, req).success).toBe(true);
	expect(v.safeParse(TranslateRequestSchema, { ...req, text: req.text + "a" }).success).toBe(false);
});
it("巨大な単独セグメントと文脈を拒否する", () => {
	const req = {
		kind: "page",
		targetLang: "ja",
		segments: ["a".repeat(8001)],
		context: { title: "", description: "" },
	};
	expect(v.safeParse(TranslateRequestSchema, req).success).toBe(false);
	expect(
		v.safeParse(TranslateRequestSchema, {
			...req,
			segments: ["ok"],
			context: { title: "a".repeat(1025), description: "" },
		}).success,
	).toBe(false);
});
