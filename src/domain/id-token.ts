import * as v from "valibot";

export const IdTokenClaimsSchema = v.object({
	sub: v.pipe(v.string(), v.minLength(1)),
	nonce: v.optional(v.string()),
	email: v.nullish(v.string(), null),
});

export type IdTokenClaims = v.InferOutput<typeof IdTokenClaimsSchema>;
