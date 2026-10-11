import { TranslateFailure } from "@/domain/failure";
import { stopAllPageTranslations } from "@/infra/messaging/content-client";
import { protectAuthStorage } from "@/infra/storage/auth-access";
import { cachePolicyItem } from "@/infra/storage/cache-policy";
import { countTranslations, rotateCache } from "@/infra/storage/translation-cache";

let epoch: string | null = null;
let ready: Promise<void> | null = null;
let operations: Promise<unknown> = Promise.resolve();
let paused = 0;
export function pauseTranslations(): () => void {
	paused++;
	barrier.abort(
		new TranslateFailure(
			"translation_stopped",
			"保存設定または認証状態の変更により翻訳を停止しました。再開するには、もう一度翻訳してください。",
		),
	);
	barrier = new AbortController();
	return () => {
		paused--;
	};
}
let barrier = new AbortController();
export function initializeCache(): Promise<void> {
	ready ??= (async () => {
		await protectAuthStorage();
		const policy = await cachePolicyItem.getValue();
		epoch = await rotateCache(!policy.enabled || policy.blocked);
	})();
	return ready;
}
export async function cacheSession(signal: AbortSignal, incognito: boolean) {
	if (paused > 0)
		throw new TranslateFailure(
			"translation_stopped",
			"保存設定または認証状態を変更しています。完了後に再度翻訳してください。",
		);
	const current = barrier;
	const combined = AbortSignal.any([signal, current.signal]);
	await operations.catch(() => {});
	await initializeCache().catch(() => {});
	combined.throwIfAborted();
	const policy = await cachePolicyItem.getValue();
	combined.throwIfAborted();
	return {
		signal: combined,
		epoch: !incognito && policy.enabled && !policy.blocked ? epoch : null,
	};
}
async function changeCache(enabled?: boolean): Promise<void> {
	const resume = pauseTranslations();
	const operation = async () => {
		await stopAllPageTranslations();
		await initializeCache().catch(() => {});
		await protectAuthStorage();
		const previous = await cachePolicyItem.getValue();
		epoch = null;
		await cachePolicyItem.setValue({ enabled: enabled ?? previous.enabled, blocked: true });
		epoch = await rotateCache(true);
		await cachePolicyItem.setValue({ enabled: enabled ?? previous.enabled, blocked: false });
		ready = Promise.resolve();
	};
	const result = operations.then(operation, operation);
	operations = result;
	try {
		await result;
	} finally {
		resume();
	}
}
export async function cacheStatus() {
	await operations;
	await initializeCache();
	const policy = await cachePolicyItem.getValue();
	if (policy.blocked) throw new Error("キャッシュを利用できません。消去を再試行してください。");
	return { enabled: policy.enabled, count: await countTranslations() };
}
export const enableCache = () => changeCache(true);
export const disableCache = () => changeCache(false);
export const clearCache = () => changeCache();
