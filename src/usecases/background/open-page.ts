import { TranslateFailure } from "@/domain/failure";
import { openOptionsPage, openUsagePage, openShortcutsPage } from "@/infra/browser/tabs";

let nextAllowed = 0;
async function open(action: () => Promise<void>): Promise<void> {
	if (Date.now() < nextAllowed)
		throw new TranslateFailure(
			"unavailable",
			"画面を開く操作が続いています。少し待って再試行してください。",
		);
	nextAllowed = Date.now() + 1000;
	await action();
}
export const openOptions = () => open(openOptionsPage);
export const openUsage = () => open(openUsagePage);
export const openShortcuts = () => open(openShortcutsPage);
