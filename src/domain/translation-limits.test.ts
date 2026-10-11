import { expect, it } from "vitest";

import { TranslationSlots } from "./translation-limits";

it("文書4件・全体16件の枠を超えず、解放は一度だけ行う", () => {
	const slots = new TranslationSlots();
	const releases = [];
	for (let doc = 0; doc < 4; doc++) {
		for (let i = 0; i < 4; i++) releases.push(slots.acquire(String(doc))!);
		expect(slots.acquire(String(doc))).toBeNull();
	}
	expect(slots.acquire("extra")).toBeNull();
	releases[0]!();
	releases[0]!();
	expect(slots.acquire("extra")).not.toBeNull();
	expect(slots.acquire("extra")).toBeNull();
});
