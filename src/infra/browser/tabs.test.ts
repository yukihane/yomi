import { afterEach, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { openShortcutsPage } from "./tabs";

afterEach(() => {
	vi.unstubAllEnvs();
	Reflect.deleteProperty(fakeBrowser.commands, "openShortcutSettings");
	fakeBrowser.reset();
});

it("Chrome ではショートカットの設定 URL を開く", async () => {
	vi.stubEnv("BROWSER", "chrome");
	const create = vi.spyOn(fakeBrowser.tabs, "create");

	await openShortcutsPage();

	expect(create).toHaveBeenCalledWith({ url: "chrome://extensions/shortcuts" });
});

it("Firefox では専用 API でショートカットの設定を開く", async () => {
	vi.stubEnv("BROWSER", "firefox");
	const openShortcutSettings = vi.fn();
	Object.defineProperty(fakeBrowser.commands, "openShortcutSettings", {
		configurable: true,
		value: openShortcutSettings,
	});
	const create = vi.spyOn(fakeBrowser.tabs, "create");
	await openShortcutsPage();

	expect(openShortcutSettings).toHaveBeenCalledOnce();
	expect(create).not.toHaveBeenCalled();
});
