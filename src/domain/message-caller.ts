import * as v from "valibot";

import { TranslateFailure } from "./failure";

const SenderSchema = v.object({
	id: v.string(),
	url: v.pipe(v.string(), v.url()),
	origin: v.optional(v.string()),
});

const ContentSenderSchema = v.object({
	...SenderSchema.entries,
	origin: v.string(),
	tab: v.object({
		id: v.pipe(v.number(), v.integer(), v.minValue(0)),
		incognito: v.optional(v.boolean(), false),
	}),
	frameId: v.literal(0),
	documentId: v.pipe(v.string(), v.minLength(1)),
	documentLifecycle: v.literal("active"),
});

const CallerSchema = v.variant("kind", [
	v.object({ kind: v.literal("extension"), page: v.picklist(["popup", "options"]) }),
	v.object({
		kind: v.literal("content"),
		url: v.string(),
		origin: v.string(),
		tabId: v.number(),
		documentId: v.string(),
		incognito: v.boolean(),
	}),
]);

export type MessageCaller = v.InferOutput<typeof CallerSchema>;

export type MessageAudience = "extension" | "content" | "either";

function denied(): TranslateFailure {
	return new TranslateFailure("other", "この画面からの操作は許可されていません。");
}

export function parseMessageCaller(
	raw: unknown,
	extensionId: string,
	extensionRoot: string,
): MessageCaller {
	const sender = v.safeParse(SenderSchema, raw);
	if (!sender.success || sender.output.id !== extensionId) throw denied();
	const url = new URL(sender.output.url);
	const extension = new URL(extensionRoot);
	if (url.username !== "" || url.password !== "") throw denied();
	if (url.protocol === extension.protocol && url.host === extension.host) {
		if (
			sender.output.origin != null &&
			sender.output.origin !== `${extension.protocol}//${extension.host}`
		)
			throw denied();
		if (url.pathname === "/popup.html") return { kind: "extension", page: "popup" };
		if (url.pathname === "/options.html") return { kind: "extension", page: "options" };
		throw denied();
	}
	const schema =
		extension.protocol === "moz-extension:"
			? v.object({
					...ContentSenderSchema.entries,
					documentLifecycle: v.optional(v.literal("active")),
				})
			: ContentSenderSchema;
	const content = v.safeParse(schema, raw);
	if (
		!content.success ||
		!["http:", "https:"].includes(url.protocol) ||
		url.origin !== content.output.origin
	)
		throw denied();
	return {
		kind: "content",
		url: url.href,
		origin: url.origin,
		tabId: content.output.tab.id,
		documentId: content.output.documentId,
		incognito: content.output.tab.incognito,
	};
}

export function authorizeMessage(caller: MessageCaller, audience: MessageAudience): void {
	if (audience !== "either" && caller.kind !== audience) throw denied();
}
