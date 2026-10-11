import * as v from "valibot";

export const CurrentDocumentSchema = v.object({
	documentId: v.string(),
	documentLifecycle: v.literal("active"),
	parentFrameId: v.literal(-1),
	url: v.pipe(v.string(), v.url()),
	errorOccurred: v.literal(false),
});
