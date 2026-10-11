import { afterEach, beforeEach, expect, test } from "vitest";

import { launchExtension } from "./fixtures";
import type { Extension } from "./fixtures";

let ext: Extension;

beforeEach(async () => {
	ext = await launchExtension();
});

afterEach(async () => {
	await ext.context.close();
});

async function waitUntilIdle() {
	await expect
		.poll(
			async () => {
				const state = await ext.sendToTab<{ busy: number }>({ type: "page:getState" });
				return state.busy;
			},
			{ timeout: 15000 },
		)
		.toBe(0);
}

async function sentText() {
	return (await ext.requests())
		.flatMap((request) => request.input.map((input) => input.content))
		.join("\n");
}

test("非表示の本文とインラインを送らず、表示される子と画面外の本文は訳す", async () => {
	const page = await ext.openTestPage();
	await page.bringToFront();
	await page.evaluate(() => {
		document.body.innerHTML = `
			<p style="visibility:hidden">SECRET_VISIBILITY</p>
			<p style="opacity:0">SECRET_OPACITY</p>
			<p style="display:none">SECRET_DISPLAY</p>
			<p hidden>SECRET_HIDDEN</p>
			<details>SECRET_DETAILS_TEXT<summary>More details</summary><div style="display:contents">SECRET_CLOSED_CONTENTS</div></details>
			<p>Public <span style="visibility:hidden">SECRET_INLINE</span> text</p>
			<div style="display:contents;opacity:0"><p>SECRET_CONTENTS</p></div>
			<div style="visibility:hidden">SECRET_PARENT<p id="override" style="visibility:visible">Visible child</p></div>
			<div style="display:contents"><p id="contents">Visible contents</p></div>
			<div id="direct-contents" style="display:contents">Visible direct contents</div>
			<p id="far" style="position:absolute;top:50000px">Offscreen text</p>`;
	});
	await ext.sendToTab({ type: "page:translate" });
	await expect.poll(() => page.textContent("#far"), { timeout: 10000 }).toContain("JA:");
	await waitUntilIdle();
	expect(await sentText()).not.toContain("SECRET_");
	expect(await page.textContent("#override")).toContain("JA:");
	expect(await page.textContent("#contents")).toContain("JA:");
	expect(await page.textContent("#direct-contents")).toContain("JA:");
	expect(await page.textContent("span")).toBe("SECRET_INLINE");
});

test("除外祖先内への動的追加と更新を送らず、除外を解除すると訳す", async () => {
	const page = await ext.openTestPage();
	await page.bringToFront();
	await page.evaluate(() => {
		document.body.innerHTML = `<p id="control">Initial control</p>
			<div id="class" class="notranslate"><p>Initial text</p></div>
			<div id="translate" translate="no"></div>
			<div id="editable" contenteditable="true"></div>
			<div id="hidden" aria-hidden="true"></div>`;
	});
	await ext.sendToTab({ type: "page:translate" });
	await expect.poll(() => page.textContent("#control"), { timeout: 10000 }).toContain("JA:");
	await waitUntilIdle();
	await page.evaluate(() => {
		for (const id of ["class", "translate", "editable", "hidden"]) {
			const p = document.createElement("p");
			p.textContent = `SECRET_DYNAMIC_${id}`;
			document.querySelector(`#${id}`)!.append(p);
		}
		document.querySelector("#class p")!.firstChild!.textContent = "SECRET_CHANGED";
		const p = document.createElement("p");
		p.id = "barrier";
		p.textContent = "Mutation control";
		document.body.append(p);
	});
	await expect.poll(() => page.textContent("#barrier"), { timeout: 10000 }).toContain("JA:");
	await waitUntilIdle();
	expect(await sentText()).not.toContain("SECRET_");
	await page.evaluate(() => {
		document.querySelector("#translate")!.removeAttribute("translate");
	});
	await expect.poll(() => page.textContent("#translate p"), { timeout: 10000 }).toContain("JA:");
});

test("待機中に CSS で非表示になった本文を送信直前に除外する", async () => {
	const page = await ext.openTestPage();
	await page.bringToFront();
	const worker = ext.context.serviceWorkers()[0]!;
	await worker.evaluate(() => {
		const mocked = globalThis as typeof globalThis & { waiting: number; release: () => void };
		mocked.waiting = 0;
		const gate = new Promise<void>((resolve) => {
			mocked.release = resolve;
		});
		const realFetch = globalThis.fetch;
		globalThis.fetch = async (url, init) => {
			const address = url instanceof Request ? url.url : String(url);
			if (address.endsWith("/v1/responses")) {
				mocked.waiting++;
				await gate;
			}
			return await realFetch(url, init);
		};
	});
	await page.evaluate(() => {
		document.body.innerHTML = `<style id="rules"></style>`;
		for (let i = 0; i < 10; i++) {
			const p = document.createElement("p");
			p.textContent = `${i < 4 ? "Public" : "SECRET_QUEUED"} ${"long text ".repeat(220)}`;
			if (i >= 4) p.className = "waiting";
			document.body.append(p);
		}
	});
	await ext.sendToTab({ type: "page:translate" });
	await expect
		.poll(() =>
			worker.evaluate(() => (globalThis as typeof globalThis & { waiting: number }).waiting),
		)
		.toBe(4);
	await page.evaluate(() => {
		document
			.querySelector<HTMLStyleElement>("#rules")!
			.sheet!.insertRule(".waiting { visibility: hidden; }");
	});
	await worker.evaluate(() =>
		(globalThis as typeof globalThis & { release: () => void }).release(),
	);
	await waitUntilIdle();
	expect(await sentText()).not.toContain("SECRET_QUEUED");
});
