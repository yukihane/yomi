import { createRemoteJWKSet, jwtVerify } from "jose";
import * as v from "valibot";

import { IdTokenClaimsSchema } from "@/domain/id-token";
import type { IdTokenClaims } from "@/domain/id-token";

const ISSUER = "https://auth.openai.com";
const keys = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`), {
	timeoutDuration: 5_000,
	cacheMaxAge: 10 * 60_000,
	cooldownDuration: 30_000,
});

export async function verifyIdToken(
	token: string,
	clientId: string,
	nonce?: string,
): Promise<IdTokenClaims> {
	try {
		const { payload } = await jwtVerify(token, keys, {
			issuer: ISSUER,
			audience: clientId,
			requiredClaims: ["sub", "exp", "iat"],
			clockTolerance: 5,
		});
		const claims = v.parse(IdTokenClaimsSchema, payload);
		if (nonce != null && claims.nonce !== nonce) throw new Error("nonce が一致しません");
		if (payload["azp"] != null && payload["azp"] !== clientId)
			throw new Error("認可先が一致しません");
		if (Array.isArray(payload.aud) && payload.aud.length > 1 && payload["azp"] !== clientId)
			throw new Error("認可先を確認できません");
		return claims;
	} catch {
		throw new Error("ID トークンを検証できませんでした。再度サインインしてください。");
	}
}
