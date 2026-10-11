import * as v from "valibot";

import { LanguageCodeSchema } from "./languages";
import { MAX_TEXT_LENGTH, MAX_PAGE_LENGTH } from "./translation-limits";

export const TranslateRequestSchema = v.variant("kind", [
	v.strictObject({
		kind: v.literal("selection"),
		targetLang: LanguageCodeSchema,
		text: v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_TEXT_LENGTH)),
	}),
	v.strictObject({
		kind: v.literal("page"),
		targetLang: LanguageCodeSchema,
		segments: v.pipe(
			v.array(v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_TEXT_LENGTH))),
			v.minLength(1),
			v.maxLength(25),
			v.check(
				(segments) => segments.reduce((sum, text) => sum + text.length, 0) <= MAX_PAGE_LENGTH,
			),
		),
		context: v.strictObject({
			title: v.pipe(v.string(), v.maxLength(1024)),
			description: v.pipe(v.string(), v.maxLength(2048)),
		}),
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
