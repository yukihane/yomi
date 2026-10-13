import * as v from "valibot";

export const SignOutResultSchema = v.object({
	localCleared: v.literal(true),
	cacheCleared: v.boolean(),
	remote: v.picklist(["revoked", "failed", "not_needed"]),
});

export type SignOutResult = v.InferOutput<typeof SignOutResultSchema>;
