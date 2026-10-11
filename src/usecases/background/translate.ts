import * as v from "valibot";

import { ApiError } from "@/domain/api-error";
import { decodeCompleteBatch, encodeBatch } from "@/domain/batch-protocol";
import { TranslateFailure } from "@/domain/failure";
import type { MessageCaller } from "@/domain/message-caller";
import type { ModelInfo } from "@/domain/models";
import { pageInstructions, selectionInstructions } from "@/domain/prompts";
import { cacheKey } from "@/domain/translation-cache";
import { MAX_OUTPUT_LENGTH } from "@/domain/translation-limits";
import { TranslateRequestSchema } from "@/domain/translation-request";
import type { TranslationOutput } from "@/domain/translation-request";
import { currentDocument } from "@/infra/browser/current-document";
import type { TranslateRequest } from "@/infra/messaging/protocol";
import { listModels as fetchModels, streamResponse } from "@/infra/openai/client";
import { getSettings } from "@/infra/storage/settings";
import { lookupTranslations, storeTranslations } from "@/infra/storage/translation-cache";

import { getAccessToken } from "./auth";
import { cacheSession } from "./cache";

export function listModels(): Promise<ModelInfo[]> {
	return withAuthRetry(fetchModels);
}

export async function translate(
	req: TranslateRequest,
	signal: AbortSignal,
	onOutput: (event: TranslationOutput) => void,
	caller: MessageCaller,
): Promise<void> {
	v.parse(TranslateRequestSchema, req);
	if (caller.kind !== "content")
		throw new TranslateFailure("other", "この画面から翻訳できません。");
	const session = await cacheSession(signal, caller.incognito);
	signal = session.signal;
	const source = await currentDocument(caller);
	signal.throwIfAborted();
	const { model, reasoningEffort, fastMode } = await getSettings();
	if (model == null) throw new TranslateFailure("no_model", "翻訳に使うモデルを選択してください。");
	const instructions =
		req.kind === "page"
			? pageInstructions(req.targetLang, req.context)
			: selectionInstructions(req.targetLang);
	const stream = async (input: string, onDelta: (text: string) => void) => {
		let received = false;
		let outputLength = 0;
		await withAuthRetry(
			(token) => {
				signal.throwIfAborted();
				return streamResponse({
					token,
					model,
					reasoningEffort,
					fast: fastMode,
					instructions,
					input,
					signal,
					onDelta: (text) => {
						signal.throwIfAborted();
						outputLength += text.length;
						if (outputLength > MAX_OUTPUT_LENGTH)
							throw new TranslateFailure(
								"request_limit",
								"翻訳結果が上限を超えたため中断しました。",
							);
						received = true;
						onDelta(text);
					},
				});
			},
			// 訳文の一部を返した後に再試行すると、呼び出し側に同じ訳文が重複して届く
			() => !received,
		);
	};
	if (req.kind === "selection") {
		await stream(req.text, (text) => {
			if (!signal.aborted) onOutput({ type: "delta", text });
		});
		return;
	}
	await getAccessToken();
	signal.throwIfAborted();
	const keys = req.segments.map((markup) =>
		cacheKey(req.targetLang, source.url, markup, {
			model,
			reasoningEffort,
			fastMode,
			instructions,
		}),
	);
	const cached =
		session.epoch == null
			? keys.map(() => null)
			: await lookupTranslations(keys, session.epoch).catch(() => keys.map(() => null));
	signal.throwIfAborted();
	const missing: { index: number; markup: string; key: string }[] = [];
	req.segments.forEach((markup, index) => {
		const hit = cached[index];
		if (hit != null) onOutput({ type: "segment", index, markup: hit });
		else missing.push({ index, markup, key: keys[index]! });
	});
	if (missing.length === 0) return;
	let output = "";
	await stream(encodeBatch(missing.map(({ markup }) => markup)), (text) => {
		output += text;
	});
	signal.throwIfAborted();
	const translated = decodeCompleteBatch(output, missing.length);
	const current = await currentDocument(source);
	if (current.url !== source.url)
		throw new TranslateFailure("other", "翻訳中にページが移動したため処理を中断しました。");
	if (session.epoch != null) {
		await storeTranslations(
			missing.map(({ key }, index) => ({ key, translation: translated[index]! })),
			session.epoch,
			signal,
		).catch(() => {});
	}
	signal.throwIfAborted();
	missing.forEach(({ index }, i) => onOutput({ type: "segment", index, markup: translated[i]! }));
}

/** access token が期限前に失効していた場合に備え、401 は一度だけ refresh して再試行する */
async function withAuthRetry<T>(
	fn: (token: string) => Promise<T>,
	canRetry: () => boolean = () => true,
): Promise<T> {
	try {
		return await fn(await getAccessToken());
	} catch (e) {
		if (!(e instanceof ApiError && e.isAuthExpired && canRetry())) throw e;
		return await fn(await getAccessToken(true));
	}
}
