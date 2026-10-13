import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { ApiError } from "@/domain/api-error";
import type { MessageCaller } from "@/domain/message-caller";
import { selectionInstructions } from "@/domain/prompts";
import type { TranslateRequest } from "@/domain/translation-request";
import { streamResponse } from "@/infra/openai/client";
import type { StreamOptions } from "@/infra/openai/client";
import { updateSettings } from "@/infra/storage/settings";

import { getAccessToken } from "./auth";
import { translate } from "./translate";

vi.mock("@/infra/openai/client", () => ({ listModels: vi.fn(), streamResponse: vi.fn() }));
vi.mock("./auth", () => ({ getAccessToken: vi.fn() }));
vi.mock("@/infra/browser/current-document", () => ({
	currentDocument: vi.fn(async (source: Extract<MessageCaller, { kind: "content" }>) => source),
}));

const req = { kind: "selection", targetLang: "ja", text: "Hello" } satisfies TranslateRequest;
const caller: MessageCaller = {
	kind: "content",
	url: "https://a.example/page",
	origin: "https://a.example",
	tabId: 1,
	documentId: "doc",
	incognito: false,
};

function run(onDelta: (text: string) => void = () => {}) {
	return translate(
		req,
		new AbortController().signal,
		(event) => {
			if (event.type === "delta") onDelta(event.text);
		},
		caller,
	);
}

describe("translate", () => {
	beforeEach(async () => {
		fakeBrowser.reset();
		vi.mocked(getAccessToken).mockReset();
		vi.mocked(streamResponse).mockReset();
		vi.mocked(getAccessToken).mockImplementation((force) =>
			Promise.resolve(force != null && force ? "refreshed-token" : "token"),
		);
		await updateSettings({ model: "gpt-test" });
	});

	it("設定のモデル・reasoningEffort・fastMode と訳文の入力を streamResponse に渡す", async () => {
		await updateSettings({ reasoningEffort: "high", fastMode: true });
		vi.mocked(streamResponse).mockResolvedValue();

		await run();

		expect(streamResponse).toHaveBeenCalledWith(
			expect.objectContaining({
				token: "token",
				model: "gpt-test",
				reasoningEffort: "high",
				fast: true,
				instructions: selectionInstructions(req.targetLang),
				input: req.text,
			}),
		);
	});

	it("受け取った訳文の断片を順に onDelta へ渡す", async () => {
		vi.mocked(streamResponse).mockImplementation((opts: StreamOptions) => {
			opts.onDelta("こん");
			opts.onDelta("にちは");
			return Promise.resolve();
		});
		const deltas: string[] = [];

		await run((text) => deltas.push(text));

		expect(deltas).toEqual(["こん", "にちは"]);
	});

	it("401 なら access token を強制 refresh して 1 回だけ再試行する", async () => {
		vi.mocked(streamResponse)
			.mockRejectedValueOnce(new ApiError(401, null, "expired"))
			.mockResolvedValueOnce();

		await run();

		expect(getAccessToken).toHaveBeenLastCalledWith(true);
		expect(vi.mocked(streamResponse).mock.calls.map(([opts]) => opts.token)).toEqual([
			"token",
			"refreshed-token",
		]);
	});

	it("再試行でも 401 なら、それ以上再試行せずに失敗する", async () => {
		vi.mocked(streamResponse).mockRejectedValue(new ApiError(401, null, "expired"));

		await expect(run()).rejects.toBeInstanceOf(ApiError);
		expect(streamResponse).toHaveBeenCalledTimes(2);
	});

	it.each([
		[
			"サブスクリプションの利用者が不正な 401",
			new ApiError(401, "subscription_sharing_invalid_user", "x"),
		],
		["403", new ApiError(403, null, "forbidden")],
		["status のない失敗", new ApiError(null, null, "network")],
	])("%s では refresh も再試行もしない", async (_, error) => {
		vi.mocked(streamResponse).mockRejectedValue(error);

		await expect(run()).rejects.toBe(error);
		expect(streamResponse).toHaveBeenCalledTimes(1);
		expect(getAccessToken).not.toHaveBeenCalledWith(true);
	});

	it("訳文の一部を受け取った後の 401 は再試行しない", async () => {
		const error = new ApiError(401, null, "expired");
		vi.mocked(streamResponse).mockImplementation((opts: StreamOptions) => {
			opts.onDelta("こん");
			return Promise.reject(error);
		});
		const deltas: string[] = [];

		await expect(run((text) => deltas.push(text))).rejects.toBe(error);
		expect(streamResponse).toHaveBeenCalledTimes(1);
		expect(deltas).toEqual(["こん"]);
	});
});

vi.mock("./cache", () => ({
	cacheSession: vi.fn(async (signal: AbortSignal, incognito: boolean) => ({
		signal,
		epoch: incognito ? null : "epoch",
	})),
}));
it("出力上限を超えるdeltaを表示せず中断する", async () => {
	await updateSettings({ model: "model" });
	vi.mocked(getAccessToken).mockResolvedValue("token");
	vi.mocked(streamResponse).mockImplementation(async ({ onDelta }) => onDelta("x".repeat(64001)));
	const output = vi.fn();
	await expect(run(output)).rejects.toThrow("翻訳結果が上限");
	expect(output).not.toHaveBeenCalled();
});
it("認証待ちの間に切断した要求はAPIへ送らない", async () => {
	await updateSettings({ model: "model" });
	const controller = new AbortController();
	vi.mocked(streamResponse).mockReset();
	vi.mocked(getAccessToken).mockImplementation(async () => {
		controller.abort();
		return "token";
	});
	await expect(translate(req, controller.signal, vi.fn(), caller)).rejects.toThrow("abort");
	expect(streamResponse).not.toHaveBeenCalled();
});
