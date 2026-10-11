import * as v from "valibot";

export const SignOutResultSchema = v.object({
	localCleared: v.literal(true),
	remote: v.picklist(["revoked", "failed", "not_needed"]),
});

export type SignOutResult = v.InferOutput<typeof SignOutResultSchema>;
