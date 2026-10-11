import * as v from "valibot";

import type { LanguageCode } from "./languages";

export const CACHE_MAX_ENTRIES = 50_000;

export const CachedTranslationSchema = v.object({
	key: v.string(),
	translation: v.string(),
});

export type CachedTranslation = v.InferOutput<typeof CachedTranslationSchema>;

export function cacheKey(
	lang: LanguageCode,
	pageUrl: string,
	markup: string,
	options: {
		model: string;
		reasoningEffort: string;
		fastMode: boolean;
		instructions: string;
	},
): string {
	// クエリが違っても訳の文脈はほぼ変わらない
	const { origin, pathname } = new URL(pageUrl);
	return JSON.stringify([
		2,
		origin,
		pathname,
		lang,
		options.model,
		options.reasoningEffort,
		options.fastMode,
		options.instructions,
		markup,
	]);
}
