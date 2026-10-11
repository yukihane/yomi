import * as v from "valibot";

import { browser } from "#imports";
import type { SerializedFailure } from "@/domain/failure";
import { TranslateFailure } from "@/domain/failure";
import { authorizeMessage } from "@/domain/message-caller";
import type { MessageCaller } from "@/domain/message-caller";
import {
	TranslationSlots,
	REQUEST_TIMEOUT_MS,
	IDLE_PORT_TIMEOUT_MS,
} from "@/domain/translation-limits";
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
	const slots = new TranslationSlots();
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
		if (caller.kind !== "content") {
			port.disconnect();
			return;
		}
		const release = slots.acquire(`${caller.tabId}:${caller.documentId}`);
		if (!release) {
			port.postMessage({
				type: "error",
				failure: {
					kind: "unavailable",
					message: "翻訳の同時実行数が上限に達しました。処理が終わってから再試行してください。",
				},
			});
			port.disconnect();
			return;
		}
		const controller = new AbortController();
		let started = false;
		let closed = false;
		let keepAlive: ReturnType<typeof setInterval> | undefined;
		const post = (event: TranslateEvent) => {
			if (!closed) port.postMessage(event);
		};
		const close = () => {
			if (closed) return;
			closed = true;
			controller.abort();
			release();
			clearTimeout(timer);
			clearInterval(keepAlive);
			browser.webNavigation.onCommitted.removeListener(onNavigation);
			browser.webNavigation.onHistoryStateUpdated.removeListener(onNavigation);
			port.disconnect();
		};
		const expire = () => {
			post({
				type: "error",
				failure: {
					kind: "unavailable",
					message: "翻訳の待機時間を超えました。再試行してください。",
				},
			});
			close();
		};
		let timer = setTimeout(expire, IDLE_PORT_TIMEOUT_MS);
		const onNavigation = (details: { tabId: number; frameId: number }) => {
			if (details.tabId === caller.tabId && details.frameId === 0) close();
		};
		browser.webNavigation.onCommitted.addListener(onNavigation);
		browser.webNavigation.onHistoryStateUpdated.addListener(onNavigation);
		port.onDisconnect.addListener(close);
		port.onMessage.addListener((raw: unknown) => {
			if (started || closed) {
				close();
				return;
			}
			started = true;
			clearTimeout(timer);
			timer = setTimeout(expire, REQUEST_TIMEOUT_MS);
			keepAlive = setInterval(() => void browser.runtime.getPlatformInfo(), KEEP_ALIVE_INTERVAL_MS);
			const run = async () => {
				const parsed = v.safeParse(TranslateRequestSchema, raw);
				if (!parsed.success) {
					const current = typeof raw === "object" && raw != null && "kind" in raw;
					throw new TranslateFailure(
						current ? "request_limit" : "extension_reloaded",
						current
							? "翻訳対象が上限を超えているか、形式が不正です。選択文・1セグメントは8,000文字、ページの1要求は20,000文字までです。"
							: "翻訳要求の形式が変わりました。ページを再読み込みしてください。",
					);
				}
				await translate(parsed.output, controller.signal, post, caller);
			};
			void run()
				.then(
					() => post({ type: "done" }),
					(e: unknown) => post({ type: "error", failure: toFailure(e) }),
				)
				.finally(close);
		});
	});
}
