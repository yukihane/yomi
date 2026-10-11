import * as v from "valibot";

import { browser } from "#imports";
import { PageStateSchema } from "@/domain/page";
import type { PageState } from "@/domain/page";

import type { ContentMessage } from "./protocol";

export async function sendToContent(tabId: number, message: ContentMessage): Promise<PageState> {
	const raw: unknown = await browser.tabs.sendMessage(tabId, message);
	return v.parse(PageStateSchema, raw);
}

export async function stopAllPageTranslations(): Promise<void> {
	const tabs = await browser.tabs.query({});
	// 拡張を注入できないタブや閉じられたタブには受信先がない。
	await Promise.allSettled(
		tabs.flatMap((tab) => (tab.id == null ? [] : [sendToContent(tab.id, { type: "page:stop" })])),
	);
}
