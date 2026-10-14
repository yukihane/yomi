type ResponsesRequest = {
	store: boolean;
	stream: boolean;
	reasoning?: { effort: string };
	service_tier?: string;
	input: { role: string; content: string }[];
};

export type MockedGlobal = typeof globalThis & {
	__requests: ResponsesRequest[];
	__completed: number;
	__aborted: number;
	__responseDelayMs: number;
	__failResponse: boolean;
};

// Firefox 用コピーに関数の文字列を埋め込むため、実行時の import や外側の変数を参照しない。
export function installApiMock() {
	const mocked = globalThis as MockedGlobal;
	mocked.__requests = [];
	mocked.__completed = 0;
	mocked.__aborted = 0;
	mocked.__responseDelayMs = 0;
	mocked.__failResponse = false;

	const fakeTranslate = (markup: string) =>
		markup.startsWith("Click ")
			? markup.replace(/^Click (<g(\d+)>)here(<\/g\2>) now$/u, "$1HERE$3 CLICK NOW")
			: "JA:" +
				markup.replaceAll(
					/(^|>)([^<]*)/gu,
					(_, gt: string, text: string) => gt + text.toUpperCase(),
				);

	const sse = (
		events: ({ type: string } & Record<string, unknown>)[],
		signal?: AbortSignal | null,
	) => {
		const encoder = new TextEncoder();
		return new ReadableStream<Uint8Array>({
			start(controller) {
				let index = 0;
				let timer: ReturnType<typeof setTimeout>;
				const abort = () => {
					clearTimeout(timer);
					mocked.__aborted++;
					controller.error(new DOMException("翻訳を中止しました", "AbortError"));
				};
				const next = () => {
					const event = events[index++]!;
					controller.enqueue(
						encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
					);
					if (index === events.length) {
						signal?.removeEventListener("abort", abort);
						mocked.__completed++;
						controller.close();
					} else timer = setTimeout(next, 5);
				};
				signal?.addEventListener("abort", abort, { once: true });
				timer = setTimeout(next, mocked.__responseDelayMs);
				if (signal?.aborted === true) abort();
			},
		});
	};

	globalThis.fetch = (url, init) => {
		const address = url instanceof Request ? url.url : String(url);
		if (address === "https://api.openai.com/v1/models") {
			return Promise.resolve(
				new Response(
					JSON.stringify({
						models: [
							{
								slug: "gpt-6-luna",
								display_name: "GPT-6 Luna",
								visibility: "list",
								default_reasoning_level: "medium",
								supported_reasoning_levels: [
									{ effort: "low", description: "速い応答" },
									{ effort: "medium", description: "標準の応答" },
									{ effort: "future-level", description: "未知の設定" },
								],
								service_tiers: [{ id: "priority", name: "高速", description: "1.5 倍速" }],
							},
							{
								slug: "gpt-6.1-sol",
								display_name: "GPT-6.1 Sol",
								visibility: "list",
								default_reasoning_level: "high",
								supported_reasoning_levels: [{ effort: "high", description: "深い推論" }],
								service_tiers: [],
							},
							{
								slug: "hidden",
								display_name: "Hidden",
								visibility: "hide",
								default_reasoning_level: "low",
								supported_reasoning_levels: [],
								service_tiers: [],
							},
						],
					}),
					{ headers: { "content-type": "application/json" } },
				),
			);
		}
		if (address === "https://api.openai.com/v1/responses") {
			const body = JSON.parse(init?.body as string) as ResponsesRequest;
			mocked.__requests.push(body);
			if (mocked.__failResponse) {
				return Promise.resolve(
					new Response(JSON.stringify({ error: { message: "テスト用の通信エラー" } }), {
						status: 503,
						headers: { "content-type": "application/json" },
					}),
				);
			}
			const input = body.input[0]!.content;
			const output = input.includes("<seg ")
				? input.replaceAll(
						/<seg id="(\d+)">([\s\S]*?)<\/seg>/gu,
						(_, id: string, markup: string) => `<seg id="${id}">${fakeTranslate(markup)}</seg>`,
					)
				: `訳: ${input}`;
			const chunks = output.match(/[\s\S]{1,7}/gu) ?? [];
			return Promise.resolve(
				new Response(
					sse(
						[
							...chunks.map((delta) => ({ type: "response.output_text.delta", delta })),
							{ type: "response.completed", response: {} },
						],
						init?.signal,
					),
					{ headers: { "content-type": "text/event-stream" } },
				),
			);
		}
		return Promise.reject(new Error(`モックされていない通信です: ${address}`));
	};
}
