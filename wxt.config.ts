import solid from "vite-plugin-solid";
import { defineConfig } from "wxt";

export default defineConfig({
	srcDir: "src",
	manifestVersion: 3,
	vite: () => ({ plugins: [solid()] }),
	manifest: ({ browser }) => ({
		name: "Yomi",
		description: "ChatGPT サブスクリプションで Web ページ全体や選択テキストを翻訳します。",
		...(browser === "firefox"
			? {
					browser_specific_settings: {
						gecko: {
							id: "yomi@shun-shobon",
							strict_min_version: "153.0",
							data_collection_permissions: {
								required: ["websiteContent", "authenticationInfo", "personallyIdentifyingInfo"],
							},
						},
					},
				}
			: { minimum_chrome_version: "140" }),
		permissions: ["storage", "contextMenus", "webNavigation"],
		host_permissions: [
			"https://auth.openai.com/*",
			"https://api.openai.com/*",
			// 認可コードを受け取る loopback リダイレクトの URL を tabs.onUpdated で読むために必要
			"http://127.0.0.1/*",
		],
		commands: {
			"translate-page": {
				suggested_key: { default: "Alt+T" },
				description: "ページを翻訳 / 停止（テキスト選択中は選択範囲を翻訳）",
			},
			"toggle-original": {
				suggested_key: { default: "Alt+O" },
				description: "原文と訳文を切り替え",
			},
		},
	}),
});
