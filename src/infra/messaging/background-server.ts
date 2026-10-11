import * as v from "valibot";

import { browser } from "#imports";
import type { SerializedFailure } from "@/domain/failure";
import { TranslateFailure } from "@/domain/failure";
import { authorizeMessage } from "@/domain/message-caller";
import type { MessageCaller } from "@/domain/message-caller";
import type { TranslationOutput } from "@/domain/translation-request";

import { getMessageCaller } from "./caller";
import {
	BACKGROUND_API,
	BackgroundRequestSchema,
	TRANSLATE_PORT,
	TranslateRequestSchema,
} from "./protocol";
import type {
	BackgroundMethod,
	BackgroundResponse,
	ParamsOf,
	ResultOf,
	TranslateEvent,
	TranslateRequest,
} from "./protocol";

/** fetch のストリーム受信だけでは service worker の idle タイマーが延長されないため、拡張 API を定期的に呼ぶ */
const KEEP_ALIVE_INTERVAL_MS = 20_000;

export type BackgroundHandlers = {
	[K in BackgroundMethod]: (params: ParamsOf<K>, caller: MessageCaller) => Promise<ResultOf<K>>;
};

type ToFailure = (e: unknown) => SerializedFailure;

export function serveBackgroundApi(handlers: BackgroundHandlers, toFailure: ToFailure) {
	browser.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
		const respond = (response: BackgroundResponse) => sendResponse(response);
		dispatch(handlers, raw, sender).then(
			(value) => respond({ ok: true, value }),
			(e: unknown) => respond({ ok: false, failure: toFailure(e) }),
		);
		return true;
	});
}

async function dispatch(
	handlers: BackgroundHandlers,
	raw: unknown,
	sender: unknown,
): Promise<unknown> {
	const caller = getMessageCaller(sender);
	const { type, params } = v.parse(BackgroundRequestSchema, raw);
	authorizeMessage(caller, BACKGROUND_API[type].audience);
	return await call(handlers, type, params, caller);
}

function call<K extends BackgroundMethod>(
	handlers: BackgroundHandlers,
	type: K,
	params: unknown,
	caller: MessageCaller,
) {
	v.parse(BACKGROUND_API[type].params, params);
	return handlers[type](undefined, caller);
}

export type TranslateHandler = (
	req: TranslateRequest,
	signal: AbortSignal,
	onOutput: (event: TranslationOutput) => void,
	caller: MessageCaller,
) => Promise<void>;

export function serveTranslatePort(translate: TranslateHandler, toFailure: ToFailure) {
	browser.runtime.onConnect.addListener((port) => {
		if (port.name !== TRANSLATE_PORT) return;
		let caller: MessageCaller;
		try {
			caller = getMessageCaller(port.sender);
			authorizeMessage(caller, "content");
		} catch {
			port.disconnect();
			return;
		}
		const controller = new AbortController();
		let started = false;
		port.onDisconnect.addListener(() => controller.abort());
		port.onMessage.addListener((raw: unknown) => {
			if (started || controller.signal.aborted) {
				controller.abort();
				port.disconnect();
				return;
			}
			started = true;
			const post = (event: TranslateEvent) => {
				if (!controller.signal.aborted) port.postMessage(event);
			};
			const keepAlive = setInterval(
				() => void browser.runtime.getPlatformInfo(),
				KEEP_ALIVE_INTERVAL_MS,
			);
			const run = async () => {
				const parsed = v.safeParse(TranslateRequestSchema, raw);
				if (!parsed.success)
					throw new TranslateFailure(
						"extension_reloaded",
						"翻訳要求の形式が変わりました。ページを再読み込みしてください。",
					);
				await translate(parsed.output, controller.signal, post, caller);
			};
			void run()
				.then(
					() => post({ type: "done" }),
					(e: unknown) => post({ type: "error", failure: toFailure(e) }),
				)
				.finally(() => clearInterval(keepAlive));
		});
	});
}
