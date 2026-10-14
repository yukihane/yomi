import { browser } from "#imports";

import { migratePrivateStorage } from "./private-local";

let protection: Promise<void> | null = null;

export function protectAuthStorage(): Promise<void> {
	protection ??= Promise.resolve()
		.then(async () => {
			if (import.meta.env.BROWSER === "firefox") {
				await migratePrivateStorage();
				return;
			}
			await Promise.all([
				browser.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
				browser.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
			]);
		})
		.then(
			() => {},
			() => {
				throw new Error("認証情報の保護を設定できませんでした。拡張機能を再読み込みしてください。");
			},
		);
	return protection;
}
