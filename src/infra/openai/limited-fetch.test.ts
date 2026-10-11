import { afterEach, expect, it, vi } from "vitest";

import { MAX_RESPONSE_BYTES } from "@/domain/translation-limits";

import { limitedFetch } from "./limited-fetch";

afterEach(() => vi.unstubAllGlobals());
it("SSEの改行が来なくても転送量超過で読み込みを打ち切る", async () => {
	const cancel = vi.fn();
	vi.stubGlobal(
		"fetch",
		vi.fn(
			async () =>
				new Response(
					new ReadableStream({
						pull(controller) {
							controller.enqueue(new Uint8Array(MAX_RESPONSE_BYTES + 1));
						},
						cancel,
					}),
				),
		),
	);
	const response = await limitedFetch("https://example.invalid");
	await expect(response.text()).rejects.toThrow("応答量が上限");
	expect(cancel).toHaveBeenCalledOnce();
});
it("上限内の応答とヘッダーを維持する", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(
			async () => new Response("data: ok", { headers: { "content-type": "text/event-stream" } }),
		),
	);
	const response = await limitedFetch("https://example.invalid");
	expect(await response.text()).toBe("data: ok");
	expect(response.headers.get("content-type")).toBe("text/event-stream");
});
