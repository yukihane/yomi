import type { MessageCaller } from "@/domain/message-caller";

import { getAuthState } from "./auth";
import { pageSiteRules } from "./site-rules";
import { getTabPageState } from "./tab-state";

export async function getPageOfferState(caller: MessageCaller) {
	const [auth, rules, tab] = await Promise.all([
		getAuthState(),
		pageSiteRules(caller),
		getTabPageState(caller),
	]);
	return { signedIn: auth.signedIn, rules, ...tab };
}
