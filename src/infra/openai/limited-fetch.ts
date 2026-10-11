import { TranslateFailure } from "@/domain/failure";
import { MAX_RESPONSE_BYTES } from "@/domain/translation-limits";

export const limitedFetch: typeof fetch = async (input, init) => {
	const response = await fetch(input, init);
	if (response.body == null) return response;
	const reader = response.body.getReader();
	let received = 0;
	const body = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const { done, value } = await reader.read();
				if (done) {
					controller.close();
					return;
				}
				received += value.byteLength;
				if (received > MAX_RESPONSE_BYTES) {
					await reader.cancel();
					controller.error(
						new TranslateFailure("other", "APIの応答量が上限を超えたため中断しました。"),
					);
					return;
				}
				controller.enqueue(value);
			} catch (error) {
				controller.error(error);
			}
		},
		async cancel(reason: unknown) {
			await reader.cancel(reason);
		},
	});
	return new Response(body, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});
};
