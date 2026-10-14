import * as v from "valibot";

import { browser } from "#imports";
import { CurrentDocumentSchema, FirefoxCurrentDocumentSchema } from "@/domain/current-document";
import { TranslateFailure } from "@/domain/failure";
import type { MessageCaller } from "@/domain/message-caller";

export async function currentDocument(caller: Extract<MessageCaller, { kind: "content" }>) {
	try {
		const frame = v.parse(
			import.meta.env.BROWSER === "firefox" ? FirefoxCurrentDocumentSchema : CurrentDocumentSchema,
			await browser.webNavigation.getFrame({
				tabId: caller.tabId,
				frameId: 0,
				...(import.meta.env.BROWSER === "firefox" ? {} : { documentId: caller.documentId }),
			}),
		);
		const url = new URL(frame.url);
		if (
			frame.documentId !== caller.documentId ||
			url.origin !== caller.origin ||
			url.username !== "" ||
			url.password !== ""
		)
			throw new Error("文書が変わりました");
		return { ...caller, url: url.href };
	} catch {
		throw new TranslateFailure(
			"other",
			"翻訳元の文書を確認できません。ページを再読み込みしてください。",
		);
	}
}
