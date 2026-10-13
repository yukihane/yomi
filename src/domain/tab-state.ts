import * as v from "valibot";

import { SiteRulesSchema } from "./site-rules";

const TabPageStateSchema = v.object({
	offerDismissed: v.boolean(),
	translating: v.boolean(),
});
const StoredTabStateSchema = v.object({
	...TabPageStateSchema.entries,
	documentId: v.string(),
	origin: v.string(),
});
export const TabStatesSchema = v.record(v.string(), StoredTabStateSchema);
export const NavigationCommitSchema = v.object({
	tabId: v.pipe(v.number(), v.integer(), v.minValue(0)),
	frameId: v.literal(0),
	documentId: v.pipe(v.string(), v.minLength(1)),
	url: v.pipe(v.string(), v.url()),
	transitionType: v.string(),
	transitionQualifiers: v.array(v.string()),
});
export type StoredTabState = v.InferOutput<typeof StoredTabStateSchema>;
export const TranslatingSchema = v.object({ translating: v.boolean() });
export const PageOfferStateSchema = v.object({
	...TabPageStateSchema.entries,
	signedIn: v.boolean(),
	rules: SiteRulesSchema,
});
