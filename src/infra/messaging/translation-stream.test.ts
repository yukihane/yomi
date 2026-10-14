import { afterEach, expect, it, vi } from "vitest";
import type { Browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { requestTranslation } from "./translation-stream";

afterEach(() => {
	vi.useRealTimers();
	fakeBrowser.reset();
});

it.each(["done", "cancel", "disconnect", "error"])(
	"翻訳中だけ接続を維持し、%s 時に解除する",
	async (finish) => {
		vi.useFakeTimers();
		const message = vi.fn();
		const disconnected = vi.fn();
		const postMessage = vi.fn();
		const disconnect = vi.fn();
		vi.spyOn(fakeBrowser.runtime, "connect").mockReturnValue({
			onMessage: { addListener: message },
			onDisconnect: { addListener: disconnected },
			postMessage,
			disconnect,
		} as unknown as Browser.runtime.Port);
		const onDelta = vi.fn();
		const request = { kind: "selection", targetLang: "ja", text: "Hello" } as const;
		const handle = requestTranslation(request, onDelta);
		const settled = handle.done.catch(() => {});
		expect(postMessage).toHaveBeenCalledExactlyOnceWith(request);
		await vi.advanceTimersByTimeAsync(20_000);
		expect(postMessage).toHaveBeenLastCalledWith({ type: "ping" });
		expect(onDelta).not.toHaveBeenCalled();

		const onMessage = message.mock.calls[0]![0] as (raw: unknown) => void;
		const onDisconnect = disconnected.mock.calls[0]![0] as () => void;
		if (finish === "done") onMessage({ type: "done" });
		else if (finish === "cancel") handle.cancel();
		else if (finish === "disconnect") onDisconnect();
		else onMessage({ type: "error", failure: { kind: "other", message: "通信に失敗しました" } });
		await settled;
		expect(disconnect).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
		await vi.advanceTimersByTimeAsync(20_000);
		expect(postMessage).toHaveBeenCalledTimes(2);
	},
);
