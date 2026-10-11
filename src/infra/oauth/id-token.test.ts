import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const pair = generateKeyPair("RS256");
const issuer = "https://auth.openai.com";
const clientId = "oaiapp_test";
const failure = "ID トークンを検証できませんでした。再度サインインしてください。";

async function token(claims: Record<string, unknown> = {}) {
	const now = Math.floor(Date.now() / 1000);
	return await new SignJWT({
		iss: issuer,
		aud: clientId,
		sub: "subject",
		nonce: "nonce-1",
		iat: now,
		exp: now + 3600,
		email: "test@example.invalid",
		...claims,
	})
		.setProtectedHeader({ alg: "RS256", kid: "test-key" })
		.sign((await pair).privateKey);
}

beforeEach(async () => {
	vi.resetModules();
	const key = await exportJWK((await pair).publicKey);
	vi.stubGlobal(
		"fetch",
		vi
			.fn()
			.mockImplementation(
				async () => new Response(JSON.stringify({ keys: [{ ...key, kid: "test-key" }] })),
			),
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

it("固定のOpenAI公開鍵で署名と要求の情報を検証する", async () => {
	const { verifyIdToken } = await import("./id-token");
	await expect(verifyIdToken(await token(), clientId, "nonce-1")).resolves.toEqual({
		sub: "subject",
		nonce: "nonce-1",
		email: "test@example.invalid",
	});
	expect(fetch).toHaveBeenCalledWith(
		`${issuer}/.well-known/jwks.json`,
		expect.objectContaining({ method: "GET", redirect: "manual" }),
	);
});

it.each([
	{ iss: "https://other.example" },
	{ aud: "other-client" },
	{ exp: 0 },
	{ exp: undefined },
	{ iat: undefined },
	{ sub: "" },
	{ sub: undefined },
	{ nonce: "other" },
	{ nonce: undefined },
	{ email: 123 },
	{ azp: "other-client" },
	{ aud: [clientId, "other-client"] },
	{ nbf: 9_999_999_999 },
])("不正なクレーム %o を拒否する", async (claims) => {
	const { verifyIdToken } = await import("./id-token");
	await expect(verifyIdToken(await token(claims), clientId, "nonce-1")).rejects.toThrow(failure);
});

it("署名の改ざんを拒否する", async () => {
	const { verifyIdToken } = await import("./id-token");
	const jwt = await token();
	await expect(
		verifyIdToken(`${jwt.slice(0, jwt.lastIndexOf(".") + 1)}invalid`, clientId, "nonce-1"),
	).rejects.toThrow(failure);
});

it("JWT内の鍵URLへアクセスしない", async () => {
	const { verifyIdToken } = await import("./id-token");
	const forged = await new SignJWT({ nonce: "nonce-1" })
		.setProtectedHeader({ alg: "RS256", kid: "unknown", jku: "https://other.example/keys" })
		.sign((await pair).privateKey);
	await expect(verifyIdToken(forged, clientId, "nonce-1")).rejects.toThrow(failure);
	expect(fetch).toHaveBeenCalledTimes(1);
	expect(fetch).toHaveBeenCalledWith(`${issuer}/.well-known/jwks.json`, expect.anything());
});

it.each(["network", "invalid-keys", "redirect"])(
	"公開鍵取得の %s でも検証を省略しない",
	async (mode) => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockImplementation(async () => {
				if (mode === "network") throw new Error("dummy-secret");
				return new Response(mode === "invalid-keys" ? "{}" : null, {
					status: mode === "redirect" ? 302 : 200,
				});
			}),
		);
		const { verifyIdToken } = await import("./id-token");
		await expect(verifyIdToken(await token(), clientId, "nonce-1")).rejects.toThrow(failure);
	},
);

it("公開鍵をキャッシュし、期限後に再取得する", async () => {
	vi.useFakeTimers();
	const { verifyIdToken } = await import("./id-token");
	const jwt = await token();
	await verifyIdToken(jwt, clientId, "nonce-1");
	await verifyIdToken(jwt, clientId, "nonce-1");
	expect(fetch).toHaveBeenCalledTimes(1);
	vi.setSystemTime(Date.now() + 10 * 60_000 + 1);
	await verifyIdToken(jwt, clientId, "nonce-1");
	expect(fetch).toHaveBeenCalledTimes(2);
});

it("鍵取得が停止した場合は5秒の期限で拒否する", async () => {
	vi.useFakeTimers();
	const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
		const controller = new AbortController();
		setTimeout(() => controller.abort(), ms);
		return controller.signal;
	});
	vi.stubGlobal(
		"fetch",
		vi.fn(
			(_url: unknown, init: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init.signal?.addEventListener("abort", () => reject(new Error("timeout")), {
						once: true,
					});
				}),
		),
	);
	const { verifyIdToken } = await import("./id-token");
	const result = verifyIdToken(await token(), clientId, "nonce-1").catch((e: unknown) => e);
	await vi.advanceTimersByTimeAsync(5_000);
	expect(timeout).toHaveBeenCalledWith(5_000);
	expect(await result).toEqual(new Error(failure));
});
