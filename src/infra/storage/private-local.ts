import { openDB } from "idb";
import type { DBSchema, IDBPDatabase } from "idb";
import * as v from "valibot";

import { browser } from "#imports";

interface PrivateDb extends DBSchema {
	items: { key: string; value: unknown };
}
let database: Promise<IDBPDatabase<PrivateDb>> | undefined;
function openPrivateStorage() {
	database ??= openDB<PrivateDb>("private-local", 1, {
		upgrade(db) {
			db.createObjectStore("items");
		},
		blocking() {
			void database?.then((db) => db.close());
			database = undefined;
		},
		terminated() {
			database = undefined;
		},
	});
	return database;
}

export async function migratePrivateStorage() {
	const db = await openPrivateStorage();
	const keys = ["credentials", "clientId", "extAgentHostId", "siteRules", "cachePolicy"];
	const previous = v.parse(
		v.record(v.string(), v.unknown()),
		await browser.storage.local.get(keys),
	);
	const tx = db.transaction("items", "readwrite");
	if ((await tx.store.get("__migrated")) !== true) {
		for (const key of keys) {
			if ((await tx.store.getKey(key)) === undefined && previous[key] !== undefined) {
				await tx.store.put(previous[key], key);
			}
		}
		await tx.store.put(true, "__migrated");
	}
	await tx.done;
}

// Firefox の storage.local は content script からの読み書きを禁止できない。
export function privateLocalItem(key: string) {
	const channelName = `yomi-private:${key}`;
	return {
		getValue: async (): Promise<unknown> => await (await openPrivateStorage()).get("items", key),
		setValue: async (value: unknown) => {
			await (await openPrivateStorage()).put("items", value, key);
			const channel = new BroadcastChannel(channelName);
			// oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel は同一オリジン内に限定される。
			channel.postMessage(null);
			channel.close();
		},
		watch: (callback: (value: unknown) => void) => {
			const channel = new BroadcastChannel(channelName);
			let closed = false;
			channel.addEventListener("message", () => {
				void openPrivateStorage()
					.then((db) => db.get("items", key))
					.then((value) => {
						if (!closed) callback(value);
					});
			});
			return () => {
				closed = true;
				channel.close();
			};
		},
	};
}
