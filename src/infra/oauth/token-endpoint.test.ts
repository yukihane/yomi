import { afterEach, expect, it, vi } from "vitest";

import { revokeRefreshToken } from "./token-endpoint";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

it.each([200, 204])("失効APIの成功 %s を受け付ける", async (status) => {
	vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
	await expect(revokeRefreshToken("dummy-refresh", "dummy-client")).resolves.toBeUndefined();
});

it.each([400, 401, 429, 500, 503])("失効APIの失敗 %s を成功扱いしない", async (status) => {
	vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("dummy-secret", { status })));
	await expect(revokeRefreshToken("dummy-refresh", "dummy-client")).rejects.toThrow(
		"トークンの失効を確認できませんでした。",
	);
});

it("通信エラーに含まれる値をエラーとして公開しない", async () => {
	vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("dummy-secret")));
	await expect(revokeRefreshToken("dummy-refresh", "dummy-client")).rejects.toThrow(
		"トークンの失効を確認できませんでした。",
	);
});

it("失効要求が応答しなければ10秒で中断する", async () => {
	vi.useFakeTimers();
	let signal: AbortSignal | undefined | null;
	vi.stubGlobal(
		"fetch",
		vi.fn((_url: unknown, init: RequestInit) => {
			signal = init.signal;
			return new Promise<Response>((_resolve, reject) => {
				signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
			});
		}),
	);
	const result = revokeRefreshToken("dummy-refresh", "dummy-client").catch(
		(error: unknown) => error,
	);
	await vi.advanceTimersByTimeAsync(10_000);
	expect(signal?.aborted).toBe(true);
	expect(await result).toEqual(new Error("トークンの失効を確認できませんでした。"));
});
