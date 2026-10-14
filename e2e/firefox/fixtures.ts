import { once } from "node:events";
import { cp, mkdir, mkdtempDisposable, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Builder } from "selenium-webdriver";
import type { WebDriver } from "selenium-webdriver";
import { Driver, Options, ServiceBuilder } from "selenium-webdriver/firefox.js";
import { Command } from "selenium-webdriver/lib/command.js";
import * as v from "valibot";
import { expect } from "vitest";
import type { Browser } from "wxt/browser";

import { TEST_PAGE } from "../fixtures";
import { installApiMock } from "../mock-api";
import type { MockedGlobal } from "../mock-api";

declare const browser: typeof Browser;

const ManifestSchema = v.looseObject({
	background: v.looseObject({ scripts: v.array(v.string()) }),
});

export interface FirefoxPage {
	handle: string;
	url: string;
}

interface MockStats {
	requests: MockedGlobal["__requests"];
	completed: number;
	aborted: number;
}

export type FirefoxExtension = Awaited<ReturnType<typeof launchFirefoxExtension>>;

export async function launchFirefoxExtension() {
	const executablePath = process.env["FIREFOX_PATH"];
	if (executablePath == null || executablePath === "")
		throw new Error("FIREFOX_PATH を指定してください");

	const copy = await mkdtempDisposable(join(tmpdir(), "yomi-firefox-"));
	const server = createServer((_request, response) => {
		response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
		response.end(TEST_PAGE);
	});
	let driver: Driver | undefined;
	const close = async () => {
		try {
			await driver?.quit();
		} finally {
			server.closeAllConnections();
			if (server.listening)
				await new Promise<void>((done) => {
					server.close(() => done());
				});
			await copy.remove();
		}
	};

	try {
		await cp(resolve(".output/firefox-mv3"), copy.path, { recursive: true });
		const manifestPath = join(copy.path, "manifest.json");
		const manifest = v.parse(ManifestSchema, JSON.parse(await readFile(manifestPath, "utf8")));
		manifest.background.scripts.unshift("e2e-mock.js");
		await writeFile(manifestPath, JSON.stringify(manifest));
		await writeFile(join(copy.path, "e2e-mock.js"), `(${installApiMock.toString()})();`);

		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		const address = server.address();
		if (address == null || typeof address === "string")
			throw new Error("テストページを起動できません");
		const origin = `http://127.0.0.1:${address.port}`;

		const instance = await new Builder()
			.forBrowser("firefox")
			.setFirefoxOptions(new Options().setBinary(executablePath).addArguments("-headless"))
			.setFirefoxService(new ServiceBuilder().addArguments("--allow-system-access"))
			.build();
		if (!(instance instanceof Driver)) {
			await instance.quit();
			throw new Error("Firefox の WebDriver を起動できません");
		}
		driver = instance;
		await instance.manage().window().setRect({ width: 1000, height: 900 });
		// installAddon() は zip 化するため、導入手順と同じディレクトリ読み込みを使う。
		await instance.execute(
			new Command("install addon").setParameter("path", copy.path).setParameter("temporary", true),
		);

		let controlHandle: string | undefined;
		await instance.wait(async () => {
			for (const handle of await instance.getAllWindowHandles()) {
				await instance.switchTo().window(handle);
				if ((await instance.getCurrentUrl()).startsWith("moz-extension://")) {
					controlHandle = handle;
					return true;
				}
			}
			return false;
		}, 10_000);
		if (controlHandle == null) throw new Error("拡張の設定ページが開きませんでした");
		const control = { handle: controlHandle, url: await instance.getCurrentUrl() };
		const extensionRoot = new URL("/", control.url).href;
		const evaluate = async <T>(
			page: FirefoxPage,
			script: Parameters<WebDriver["executeScript"]>[0],
			...args: unknown[]
		): Promise<T> => {
			await instance.switchTo().window(page.handle);
			return await instance.executeScript<T>(script, ...args);
		};
		const inControl = async <T>(
			script: Parameters<WebDriver["executeScript"]>[0],
			...args: unknown[]
		): Promise<T> => {
			const previous = await instance.getWindowHandle();
			try {
				return await evaluate<T>(control, script, ...args);
			} finally {
				await instance.switchTo().window(previous);
			}
		};
		await evaluate(control, async () => {
			await new Promise<void>((done, reject) => {
				const request = indexedDB.open("private-local", 1);
				request.addEventListener("upgradeneeded", () => request.result.createObjectStore("items"));
				request.addEventListener("error", () =>
					reject(request.error ?? new Error("DB を開けません")),
				);
				request.addEventListener("success", () => {
					const db = request.result;
					const tx = db.transaction("items", "readwrite");
					tx.objectStore("items").put(
						{
							clientId: "oaiapp_test",
							email: "tester@example.com",
							idToken: "fake-id-token",
							accessToken: "fake-access",
							refreshToken: "fake-refresh",
							expiresAt: Date.now() + 3600_000,
						},
						"credentials",
					);
					tx.addEventListener("complete", () => {
						db.close();
						done();
					});
					tx.addEventListener("error", () => {
						db.close();
						reject(tx.error ?? new Error("DB に保存できません"));
					});
				});
			});
			const notification = new BroadcastChannel("yomi-private:credentials");
			// oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel は同一オリジン内に限定される。
			notification.postMessage(null);
			notification.close();
			await browser.storage.sync.set({ settings: { model: "gpt-6-luna", targetLang: "ja" } });
		});

		const sendToTab = <T = unknown>(page: FirefoxPage, message: unknown) =>
			inControl<T>(
				async (url: string, msg: unknown): Promise<T> => {
					const tab = (await browser.tabs.query({})).find((candidate) => candidate.url === url);
					if (tab?.id == null) throw new Error("対象のタブが見つかりません");
					return await browser.tabs.sendMessage(tab.id, msg);
				},
				page.url,
				message,
			);
		const newPage = async (url: string) => {
			await instance.switchTo().newWindow("tab");
			await instance.get(url);
			return { handle: await instance.getWindowHandle(), url };
		};

		return {
			close,
			control,
			driver: instance,
			evaluate,
			sendToTab,
			newPage: (path: string) => newPage(new URL(path, extensionRoot).href),
			closePage: async (page: FirefoxPage) => {
				await instance.switchTo().window(page.handle);
				await instance.close();
				await instance.switchTo().window(control.handle);
			},
			openTestPage: async (path: string) => {
				const page = await newPage(`${origin}${path}`);
				await expect
					.poll(() => sendToTab(page, { type: "page:getState" }))
					.toMatchObject({ active: false });
				return page;
			},
			stats: () =>
				inControl<MockStats>(async () => {
					// oxlint-disable-next-line typescript/no-deprecated -- Firefox の MV3 は background page を使う。
					const background = (await browser.runtime.getBackgroundPage()) as unknown as MockedGlobal;
					return {
						requests: background.__requests,
						completed: background.__completed,
						aborted: background.__aborted,
					};
				}),
			withoutViews: async (page: FirefoxPage, action: () => Promise<void>) => {
				await instance.switchTo().window(control.handle);
				await instance.get("about:blank");
				await instance.switchTo().window(page.handle);
				try {
					await action();
				} finally {
					await instance.switchTo().window(control.handle);
					await instance.get(control.url);
					await instance.switchTo().window(page.handle);
				}
			},
			configureMock: (options: { delayMs?: number; fail?: boolean }) =>
				inControl(async ({ delayMs = 0, fail = false }: { delayMs?: number; fail?: boolean }) => {
					// oxlint-disable-next-line typescript/no-deprecated -- Firefox の MV3 は background page を使う。
					const background = (await browser.runtime.getBackgroundPage()) as unknown as MockedGlobal;
					background.__responseDelayMs = delayMs;
					background.__failResponse = fail;
				}, options),
			screenshot: async (page: FirefoxPage, name: string) => {
				const directory = process.env["E2E_SCREENSHOT_DIR"];
				if (directory != null) {
					await mkdir(directory, { recursive: true });
					await instance.switchTo().window(page.handle);
					await writeFile(
						join(directory, `firefox-${name}.png`),
						Buffer.from(
							name === "options"
								? await instance.takeFullPageScreenshot()
								: await instance.takeScreenshot(),
							"base64",
						),
					);
				}
			},
		};
	} catch (error) {
		await close();
		throw error;
	}
}
