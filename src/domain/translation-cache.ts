import * as v from "valibot";

import type { LanguageCode } from "./languages";

export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const CachePolicySchema = v.object({ enabled: v.boolean(), blocked: v.boolean() });
export const CacheStatusSchema = v.object({ enabled: v.boolean(), count: v.number() });
export const CacheEpochSchema = v.string();
export const CacheRowSchema = v.object({
	key: v.string(),
	translation: v.string(),
	usedAt: v.number(),
	createdAt: v.number(),
	expiresAt: v.number(),
});
export function cacheExpired(row: v.InferOutput<typeof CacheRowSchema>, now: number): boolean {
	return (
		row.createdAt > now || row.expiresAt <= now || row.expiresAt - row.createdAt !== CACHE_TTL_MS
	);
}
export const CACHE_MAX_ENTRIES = 50_000;

const CachedTranslationSchema = v.object({
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
