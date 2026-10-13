import * as v from "valibot";

import { TranslateFailure } from "@/domain/failure";
import type { MessageCaller } from "@/domain/message-caller";
import { continuesTranslation } from "@/domain/navigation";
import { NavigationCommitSchema } from "@/domain/tab-state";
import type { StoredTabState } from "@/domain/tab-state";
import { currentDocument } from "@/infra/browser/current-document";
import { protectAuthStorage } from "@/infra/storage/auth-access";
import { tabStatesItem } from "@/infra/storage/tab-state";

let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
	const run = queue.then(async () => {
		await protectAuthStorage();
		return await task();
	});
	queue = run.catch(() => {});
	return run;
}

async function access(caller: MessageCaller) {
	if (caller.kind !== "content")
		throw new TranslateFailure("other", "この画面からタブを操作できません。");
	const source = await currentDocument(caller);
	const states = await tabStatesItem.getValue();
	const stored = states[String(source.tabId)];
	const state: StoredTabState =
		stored?.documentId === source.documentId && stored.origin === source.origin
			? stored
			: {
					documentId: source.documentId,
					origin: source.origin,
					translating: false,
					offerDismissed: false,
				};
	return { source, states, state };
}

export function getTabPageState(caller: MessageCaller) {
	return serialize(async () => {
		const { state } = await access(caller);
		return { offerDismissed: state.offerDismissed, translating: state.translating };
	});
}

export function commitNavigation(raw: unknown) {
	const parsed = v.safeParse(NavigationCommitSchema, raw);
	if (!parsed.success) return Promise.resolve();
	const nav = parsed.output;
	return serialize(async () => {
		const states = await tabStatesItem.getValue();
		const previous = states[String(nav.tabId)];
		const origin = new URL(nav.url).origin;
		const translating =
			previous != null &&
			previous.translating &&
			continuesTranslation(nav, previous.origin, origin);
		await tabStatesItem.setValue({
			...states,
			[nav.tabId]: {
				documentId: nav.documentId,
				origin,
				translating,
				offerDismissed: nav.transitionType !== "reload" && (previous?.offerDismissed ?? false),
			},
		});
	});
}

async function update(
	caller: MessageCaller,
	patch: { translating?: boolean; offerDismissed?: boolean },
) {
	await serialize(async () => {
		const { source, states, state } = await access(caller);
		await tabStatesItem.setValue({ ...states, [source.tabId]: { ...state, ...patch } });
	});
}
export const dismissOffer = (caller: MessageCaller) => update(caller, { offerDismissed: true });
export const setTranslating = (caller: MessageCaller, translating: boolean) =>
	update(caller, { translating });

export function forgetTab(tabId: number) {
	return serialize(async () => {
		const states = await tabStatesItem.getValue();
		delete states[String(tabId)];
		await tabStatesItem.setValue(states);
	});
}

export function stopRememberedTranslations() {
	return serialize(async () => {
		const states = await tabStatesItem.getValue();
		for (const state of Object.values(states)) state.translating = false;
		await tabStatesItem.setValue(states);
	});
}
