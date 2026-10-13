import * as v from "valibot";

import { browser, defineBackground } from "#imports";
import { toTranslateFailure } from "@/domain/api-error";
import { ContextMenuIdSchema, setUpContextMenus } from "@/infra/browser/context-menus";
import { activeTabId, openOptionsPage } from "@/infra/browser/tabs";
import { serveBackgroundApi, serveTranslatePort } from "@/infra/messaging/background-server";
import { sendToContent } from "@/infra/messaging/content-client";
import { CommandNameSchema } from "@/infra/messaging/protocol";
import type { CommandName, ContentMessage } from "@/infra/messaging/protocol";
import { protectAuthStorage } from "@/infra/storage/auth-access";
import {
	getAuthState,
	handleTabRemoved,
	handleTabUpdated,
	signOut,
	startSignIn,
} from "@/usecases/background/auth";
import {
	cacheStatus,
	enableCache,
	disableCache,
	clearCache,
	initializeCache,
} from "@/usecases/background/cache";
import { openOptions, openUsage, openShortcuts } from "@/usecases/background/open-page";
import { getPageOfferState } from "@/usecases/background/page-offer";
import { changeSiteRule, excludePageOffer, getSiteRules } from "@/usecases/background/site-rules";
import {
	commitNavigation,
	dismissOffer,
	forgetTab,
	setTranslating,
} from "@/usecases/background/tab-state";
import { listModels, translate } from "@/usecases/background/translate";

const COMMAND_MESSAGES: Record<CommandName, ContentMessage> = {
	"translate-page": { type: "command:translate" },
	"toggle-original": { type: "command:toggleOriginal" },
};

const serializeFailure = (e: unknown) => toTranslateFailure(e).serialize();

export default defineBackground(() => {
	// リスナー登録を初期化完了まで遅らせると、worker 復帰時のイベントを失う。
	void protectAuthStorage().catch(() => {});
	void initializeCache().catch(() => {});
	// service worker 再起動後もサインインを完了できるよう、リスナーはトップレベルで同期的に登録する
	browser.tabs.onUpdated.addListener((tabId, info) => {
		void handleTabUpdated(tabId, info.url).then(async (signedIn) => {
			if (signedIn) await openOptionsPage();
		});
	});
	browser.tabs.onRemoved.addListener((tabId) => {
		void handleTabRemoved(tabId);
		void forgetTab(tabId).catch(() => {});
	});
	browser.webNavigation.onCommitted.addListener((details) => {
		void commitNavigation(details).catch(() => {});
	});

	browser.runtime.onInstalled.addListener(({ reason }) => {
		void setUpContextMenus();
		if (reason === "install") void openOptionsPage();
	});

	browser.contextMenus.onClicked.addListener((info, tab) => {
		if (tab?.id == null || !v.is(ContextMenuIdSchema, info.menuItemId)) return;
		if (info.menuItemId === "translate-page") {
			notifyTab(tab.id, { type: "page:translate" });
		} else if (info.selectionText != null) {
			notifyTab(tab.id, { type: "selection:translate", text: info.selectionText });
		}
	});

	browser.commands.onCommand.addListener((command) => {
		if (!v.is(CommandNameSchema, command)) return;
		void activeTabId().then((tabId) => {
			if (tabId != null) notifyTab(tabId, COMMAND_MESSAGES[command]);
		});
	});

	serveBackgroundApi(
		{
			"siteRules:get": getSiteRules,
			"siteRules:change": changeSiteRule,
			"offer:getState": (_, caller) => getPageOfferState(caller),
			"offer:exclude": excludePageOffer,
			"offer:dismiss": (_, caller) => dismissOffer(caller),
			"tab:setTranslating": ({ translating }, caller) => setTranslating(caller, translating),
			"cache:status": cacheStatus,
			"cache:enable": enableCache,
			"cache:disable": disableCache,
			"cache:clear": clearCache,
			"auth:getState": getAuthState,
			"auth:signIn": startSignIn,
			"auth:signOut": signOut,
			"models:list": listModels,
			"open:options": openOptions,
			"open:usage": openUsage,
			"open:shortcuts": openShortcuts,
		},
		serializeFailure,
	);
	serveTranslatePort(translate, serializeFailure);
});

function notifyTab(tabId: number, message: ContentMessage) {
	sendToContent(tabId, message).catch(() => {
		// content script を注入できないページ（chrome:// など）では何もしない
	});
}
