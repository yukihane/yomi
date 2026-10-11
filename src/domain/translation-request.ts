import * as v from "valibot";

import { LanguageCodeSchema } from "./languages";

export const TranslateRequestSchema = v.variant("kind", [
	v.strictObject({
		kind: v.literal("selection"),
		targetLang: LanguageCodeSchema,
		text: v.string(),
	}),
	v.strictObject({
		kind: v.literal("page"),
		targetLang: LanguageCodeSchema,
		segments: v.pipe(v.array(v.string()), v.minLength(1), v.maxLength(25)),
		context: v.strictObject({ title: v.string(), description: v.string() }),
	}),
]);

export type TranslateRequest = v.InferOutput<typeof TranslateRequestSchema>;

export const TranslationOutputSchema = v.variant("type", [
	v.object({ type: v.literal("delta"), text: v.string() }),
	v.object({
		type: v.literal("segment"),
		index: v.pipe(v.number(), v.integer(), v.minValue(0)),
		markup: v.string(),
	}),
]);

export type TranslationOutput = v.InferOutput<typeof TranslationOutputSchema>;
